"""Static/privacy/cohort regression checks. No model or credential access."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('exporter',ROOT/'tools/export_trace.py')
assert spec is not None and spec.loader is not None
exporter=importlib.util.module_from_spec(spec);spec.loader.exec_module(exporter)

class TraceR2Tests(unittest.TestCase):
    def test_allowlisted_labels(self):
        for goal,path,expected in [
            ('Improve the double-tap ring interaction for NOOP.','/repo/products/noop/app.py',('NOOP','ring double-tap')),
            ('Build Dash agent-trace prototypes.','/repo/products/dash/.worktrees/agent-trace',('Dash','trace prototypes')),
            ('Check physics during string conversion.','/repo/products/ace/x',('Sim','simulation checks')),
            ('Private unrelated text x7secret','',('Research','workflow study')),
            ('Integrate relay','/repo/products/z0live/relay.py',('z0live','voice relay')),
        ]:
            label=exporter.public_labels(goal,path)
            self.assertEqual((label['project'],label['short_goal']),expected)
            self.assertNotIn('x7secret',label['label']);self.assertNotIn('/',label['label'])

    def test_frozen_cohort_only_labels_changed(self):
        original=json.loads((ROOT/'data/trace-20261020.json').read_text());current=json.loads((ROOT/'data/trace-r2.json').read_text())
        self.assertEqual(len(current['tasks']),82);self.assertEqual(len(current['runs']),51)
        self.assertEqual(sum(t['tool_calls'] for t in current['tasks']),11307)
        for old,new in zip(original['tasks'],current['tasks'],strict=True):
            self.assertEqual({k:v for k,v in old.items() if k!='label'},{k:v for k,v in new.items() if k not in ('label','project','short_goal')})
        for old,new in zip(original['runs'],current['runs'],strict=True):
            self.assertEqual(old,{k:v for k,v in new.items() if k not in ('label','project','short_goal')})
        for key in ('generated','window','lanes','lanes_at','omp','owner_turns'):
            self.assertEqual(original[key],current[key])

    def test_real_cache_coverage_and_hash(self):
        data=(ROOT/'data/trace-r2.json').read_bytes();cache=json.loads((ROOT/'data/interpretations-r2.json').read_text())
        self.assertEqual(cache['source_sha256'],hashlib.sha256(data).hexdigest());self.assertEqual(cache['model'],'gpt-6.1-sol');self.assertEqual(cache['content_sha256'],hashlib.sha256(json.dumps(cache['insights'],sort_keys=True,separators=(',',':')).encode()).hexdigest())
        self.assertEqual(set(cache['insights']['runs']),{r['id'] for r in json.loads(data)['runs']})
        self.assertEqual(len(cache['insights']['sections']),6)
        for v in cache['insights']['views'].values():self.assertEqual(len(v['actions']),3)
        for item in list(cache['insights']['runs'].values())+list(cache['insights']['sections'].values()):
            self.assertTrue(item['read']);self.assertTrue(item['action']);self.assertIn(item['confidence'],('high','medium','low'))

    def test_r1_byte_preservation_and_self_containment(self):
        for slug in ['index','a-trace','b-lanes','c-stats','d-pocket']:
            original=subprocess.check_output(['git','show',f'7a9b0bb:docs/design/agent-trace/out/{slug}.html'],cwd=ROOT)
            self.assertEqual(original,(ROOT/'out'/f'{slug}-r1.html').read_bytes())
            html=(ROOT/'out'/f'{slug}.html').read_text()
            self.assertNotIn('<script src=',html);self.assertNotIn('<link rel="stylesheet"',html)
            self.assertNotIn('__TRACE_DATA__',html);self.assertNotIn('__FONT_',html)
        for file in ['trace-r2.json','interpretations-r2.json']:
            text=(ROOT/'data'/file).read_text()
            for private in ('/home/','/mnt/','"_goal"','"title": "Subagent:'):
                self.assertFalse(private in text, f'Private field/path marker in {file}: {private}')

if __name__=='__main__':unittest.main()
