"""Native-source integration test. Uses ONLY a disposable SQLite store."""
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from unittest.mock import patch
import unittest

spec = importlib.util.spec_from_file_location('context_snapshot', Path(__file__).with_name('context-snapshot.py'))
assert spec is not None and spec.loader is not None
projection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(projection)


class NativeSnapshotTest(unittest.TestCase):
    def test_pinned_categories_budget_and_readonly(self):
        with tempfile.TemporaryDirectory(prefix='dash-context-native-') as home:
            os.environ['HERMES_HOME'] = home
            Path(home, 'config.yaml').write_text('model:\n  default: test-model\n  context_length: 1000000\n  max_tokens: 10000\ncompression:\n  threshold: 0.85\n  threshold_tokens: 800000\n')
            db = sqlite3.connect(Path(home, 'state.db'))
            db.executescript('''CREATE TABLE sessions(id TEXT, hidden INT DEFAULT 0, archived INT DEFAULT 0, end_reason TEXT, parent_session_id TEXT, started_at REAL, system_prompt_hash TEXT, system_prompt TEXT, tool_names TEXT, model_config TEXT, model TEXT);
CREATE TABLE system_prompts(hash TEXT,prompt TEXT);
CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,active INT,role TEXT,content TEXT,tool_calls TEXT,tool_call_id TEXT,api_content TEXT,reasoning TEXT,reasoning_content TEXT,reasoning_details TEXT,codex_reasoning_items TEXT,_compressed_summary INT DEFAULT 0);''')
            prompt = 'System rules\n<available_skills>one skill</available_skills>\n════════\nMEMORY (notes)\n════════\nremember this\n════════\nUSER PROFILE (who)\n════════\nprofile text\n<!-- end -->'
            tools = [{'type':'function','function':{'name':'mcp__github__search','description':'Search repositories','parameters':{'type':'object'}}}, {'type':'function','function':{'name':'terminal','description':'Run commands','parameters':{'type':'object'}}}]
            db.execute('INSERT INTO system_prompts VALUES(?,?)', ('prompt-hash', prompt))
            db.execute('INSERT INTO system_prompts VALUES(?,?)', ('tools-hash', json.dumps({'version':'v1','tools':tools})))
            db.execute("INSERT INTO sessions(id,system_prompt_hash,tool_names,model_config,model) VALUES('s','prompt-hash','tools-hash','{}','test-model')")
            db.execute("INSERT INTO messages(session_id,active,role,content) VALUES('s',1,'user','hello there')")
            db.execute("INSERT INTO messages(session_id,active,role,content) VALUES('s',0,'tool','" + 'x' * 10000 + "')")
            db.commit(); db.close()
            before = Path(home, 'state.db').read_bytes()
            result = projection.snapshot(home, 's', os.environ['DASH_HERMES_SOURCE'])
            self.assertEqual(before, Path(home, 'state.db').read_bytes())
            self.assertEqual(result['maximum'], 1000000)
            self.assertEqual(result['model'], 'test-model')
            self.assertIsNone(result['provider'])
            self.assertIsNone(result['parentSessionId'])
            self.assertEqual(result['threshold'], 800000)
            categories = {c['id']:c for c in result['categories']}
            self.assertEqual(categories['reserved']['tokens'], 200000)
            self.assertGreater(categories['memory']['tokens'], 5)
            self.assertGreater(categories['skills']['tokens'], 0)
            self.assertEqual({d['label'] for d in categories['tools']['details']}, {'Built-in tools','github'})
            self.assertEqual(result['used'], sum(c['tokens'] for c in result['categories'] if c['id'] not in {'reserved','free'}))
            self.assertEqual(categories['free']['tokens'], 800000 - result['used'])
            self.assertLess(categories['messages']['tokens'], 100)
            self.assertIsNone(projection.snapshot(home, 'missing', os.environ['DASH_HERMES_SOURCE']))
            # Normal appends must not report compaction. A new summary must.
            db = sqlite3.connect(Path(home, 'state.db'))
            db.execute("INSERT INTO messages(session_id,active,role,content) VALUES('s',1,'assistant','a reply')"); db.commit()
            appended = projection.snapshot(home, 's', os.environ['DASH_HERMES_SOURCE'])
            self.assertEqual(result['revision'], appended['revision'])
            db.execute("INSERT INTO messages(session_id,active,role,content,_compressed_summary) VALUES('s',1,'user','summary',1)"); db.commit(); db.close()
            summarized = projection.snapshot(home, 's', os.environ['DASH_HERMES_SOURCE'])
            self.assertNotEqual(result['revision'], summarized['revision'])
            catalog_home = Path(home, 'codex-metadata'); catalog_home.mkdir()
            (catalog_home / 'models_cache.json').write_text(json.dumps({'models':[{'slug':'gpt-6.1-sol','context_window':500000}]}))
            db = sqlite3.connect(Path(home, 'state.db'))
            db.execute('UPDATE sessions SET model=?,model_config=? WHERE id=?', ('gpt-6.1-sol', json.dumps({'gateway_runtime':{'provider':'openai-codex'}}), 's')); db.commit(); db.close()
            with patch.dict(os.environ, {'CODEX_HOME':str(catalog_home)}):
                codex = projection.snapshot(home, 's', os.environ['DASH_HERMES_SOURCE'])
            self.assertEqual(codex['maximum'], 500000)  # not the 1.05M OpenAI API limit
            self.assertEqual(codex['threshold'], 416500)


if __name__ == '__main__':
    unittest.main()
