"""Read-only native Hermes context projection. Never instantiate SessionDB or an agent.

Only counts/allowlisted labels leave this process, never prompt text or credentials.
The source path is host configuration, not client input. No gateway/provider requests.
"""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import sys


def snapshot(home, session_id, source):
    sys.path.insert(0, source)
    from agent.model_metadata import DEFAULT_CONTEXT_LENGTHS, estimate_tokens_rough, estimate_messages_tokens_rough
    from agent.usage_anchor import anchored_context_tokens
    from agent.context_compressor import ContextCompressor, resolve_model_threshold
    from hermes_cli.config import load_config_readonly

    db = sqlite3.connect(f"file:{Path(home) / 'state.db'}?mode=ro", uri=True, timeout=.3)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    db.execute("BEGIN")
    row = db.execute("SELECT * FROM sessions WHERE id=? AND coalesce(hidden,0)=0 AND coalesce(archived,0)=0", (session_id,)).fetchone()
    if row is None:
        db.close()
        return None
    # Only follow compression children, not delegated workers. All reads share one snapshot.
    seen = set()
    while row['end_reason'] == 'compression' and row['id'] not in seen and len(seen) < 64:
        seen.add(row['id'])
        child = db.execute("SELECT * FROM sessions WHERE parent_session_id=? AND source=? AND coalesce(hidden,0)=0 AND coalesce(archived,0)=0 ORDER BY started_at DESC LIMIT 1", (row['id'], row['source'])).fetchone()
        if child is None:
            break
        row = child
    sid = row['id']
    def resolved(value):
        stored = db.execute('SELECT prompt FROM system_prompts WHERE hash=?', (value,)).fetchone() if value else None
        return stored[0] if stored else value or ''
    prompt = resolved(row['system_prompt_hash']) or row['system_prompt'] or ''
    pin = json.loads(resolved(row['tool_names']) or 'null')
    tools = pin.get('tools', []) if isinstance(pin, dict) else []
    notes = ['Category counts use Hermes’s rough tokenizer, not exact provider tokenization.']
    if not tools:
        notes.append('Pinned tool schemas unavailable; tools are not included in the fallback estimate.')
    messages = []
    summary_ids = []
    for r in db.execute("SELECT * FROM messages WHERE session_id=? AND active=1 AND role IN ('user','assistant','tool','system') ORDER BY id", (sid,)):
        if r['_compressed_summary']:
            summary_ids.append(r['id'])
        m = {k: r[k] for k in ['role','content','tool_calls','tool_call_id','api_content','reasoning','reasoning_content','reasoning_details','codex_reasoning_items'] if r[k] is not None}
        if isinstance(m.get('content'), str) and m['content'].startswith('\x00json:'):
            try:
                m['content'] = json.loads(m['content'][6:])
            except ValueError:
                pass
        for k in ['tool_calls','reasoning_details','codex_reasoning_items']:
            if isinstance(m.get(k), str):
                try:
                    m[k] = json.loads(m[k])
                except (ValueError, TypeError):
                    pass
        messages.append(m)
    config = json.loads(row['model_config'] or '{}')
    db.close()
    cfg = load_config_readonly()
    model = row['model'] or ''
    runtime = config.get('gateway_runtime') or {}
    provider = runtime.get('provider', '')
    model_cfg = cfg.get('model') or {}
    model_cfg = model_cfg if isinstance(model_cfg, dict) else {}
    # Offline catalog only: live metadata resolution can probe providers and write caches.
    maximum = config.get('context_length')
    if not isinstance(maximum, int) or maximum <= 0:
        maximum = model_cfg.get('context_length') if model_cfg.get('default') == model else None
    window_source = 'session configuration'
    if (not isinstance(maximum, int) or maximum <= 0) and provider == 'openai-codex':
        # Codex OAuth bounds differ from OpenAI API bounds (e.g. Sol: 500K vs 1.05M).
        # Read ONLY the CLI's model metadata, never its auth file or identity fields.
        try:
            catalog = json.loads((Path(os.environ.get('CODEX_HOME') or Path.home() / '.codex') / 'models_cache.json').read_text())
            entry = next((m for m in catalog.get('models', []) if isinstance(m, dict) and m.get('slug') == model), {})
            maximum = entry.get('context_window')
            window_source = 'cached Codex OAuth model catalog (account/runtime overrides may differ)'
        except (OSError, ValueError, StopIteration):
            pass
        if not isinstance(maximum, int) or maximum <= 0:
            from agent.model_metadata import _CODEX_OAUTH_CONTEXT_FALLBACK
            hits = sorted((k for k in _CODEX_OAUTH_CONTEXT_FALLBACK if k in model.lower()), key=len, reverse=True)
            maximum = _CODEX_OAUTH_CONTEXT_FALLBACK[hits[0]] if hits else 0
            window_source = 'conservative offline Hermes Codex bound (runtime window unavailable)'
    if not isinstance(maximum, int) or maximum <= 0:
        hits = sorted((k for k in DEFAULT_CONTEXT_LENGTHS if k in model.lower()), key=len, reverse=True)
        maximum = DEFAULT_CONTEXT_LENGTHS[hits[0]] if hits else 0
        window_source = 'offline Hermes model catalog (runtime overrides may differ)'
    notes.append('Window/trigger: ' + window_source + '; runtime auxiliary ceilings are not persisted.')
    cc = cfg.get('compression') or {}
    ratio = float(cc.get('threshold', .5))
    from agent.auxiliary_client import _compression_threshold_for_model
    override = _compression_threshold_for_model(model, provider, allow_codex_gpt55_autoraise=cc.get('codex_gpt55_autoraise', True))
    if override is not None:
        ratio = max(ratio, override) if provider == 'openai-codex' else override
    ratio = resolve_model_threshold(model, cc.get('model_thresholds') or {}, ratio, provider)
    ratio = ContextCompressor._effective_threshold_percent(maximum, ratio)
    output = model_cfg.get('max_tokens')
    output = output if isinstance(output, int) and output > 0 else None
    threshold = ContextCompressor._compute_threshold_tokens(maximum, ratio, output) if maximum else 0
    cap = cc.get('threshold_tokens')
    if isinstance(cap, int) and cap > 0:
        threshold = min(threshold, cap, maximum)
    if cc.get('enabled') is False:
        threshold = 0
        notes.append('Automatic compression is disabled in profile configuration.')
    categories = []
    def category(key, label, tokens, details=None, note=None, estimated=True):
        categories.append(dict(id=key, label=label, tokens=max(0, tokens), estimated=estimated, details=details or [], **({'note':note} if note else {})))
    skills = '\n'.join(re.findall(r'<available_skills>.*?</available_skills>', prompt, re.S))
    rest = re.sub(r'<available_skills>.*?</available_skills>', '', prompt, flags=re.S)
    # Memory/profile blocks have explicit delimiters in the pinned system prompt.
    memory_pattern = r'(?s)═+\n(?:MEMORY|USER PROFILE)[^\n]*\n═+\n.*?(?=\n═+\n|\n<!--|\nConversation started:|\Z)'
    memory = '\n'.join(re.findall(memory_pattern, rest))
    rest = re.sub(memory_pattern, '', rest)
    category('system', 'System prompt', estimate_tokens_rough(rest))
    groups = {}
    for tool in tools:
        fn = tool.get('function', tool)
        name = fn.get('name', '')
        # Current MCP uses mcp__server__tool; older pins use mcp_server_tool.
        server = name.split('__')[1] if name.startswith('mcp__') and '__' in name[5:] else name[4:].split('_')[0] if name.startswith('mcp_') else 'Built-in tools'
        server = re.sub(r'[^\w .:-]', '', server)[:80]
        groups.setdefault(server, []).append(tool)
    details = [dict(label=k, tokens=estimate_tokens_rough(json.dumps(v, ensure_ascii=False))) for k,v in groups.items()]
    category('tools', 'Tools / MCP', sum(d['tokens'] for d in details), details, None if tools else 'Pinned schemas unavailable')
    category('skills', 'Skills index', estimate_tokens_rough(skills))
    category('memory', 'Memory', estimate_tokens_rough(memory))
    category('messages', 'Messages', estimate_messages_tokens_rough(messages))
    estimated_total = sum(c['tokens'] for c in categories)
    anchored = anchored_context_tokens(messages, config.get('_usage_anchor'))
    used = anchored if anchored is not None else estimated_total
    source_label = 'provider anchor + estimated delta' if anchored is not None else 'local estimate'
    # Preserve category estimates (never scale and pretend the counts were measured).
    if anchored is not None and estimated_total != used:
        notes.append('Category estimates may not sum to the provider-anchored total.')
    reserved = max(0, maximum - threshold) if threshold else 0
    category('reserved', 'Reserved', reserved, note='Kept free so compacting has room to run. Estimated from profile configuration and the offline window; includes output reservation.', estimated=True)
    category('free', 'Free', max(0, maximum - used - reserved), estimated=True)
    revision = hashlib.sha256(json.dumps([sid, summary_ids]).encode()).hexdigest()
    return dict(sessionId=sid, model=model, used=used, maximum=maximum, threshold=threshold, estimated=True, source=source_label, categories=categories, revision=revision, notes=notes)


if __name__ == '__main__':
    try:
        # Some native imports emit diagnostics; never forward those or raw exception values.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = snapshot(os.environ['HERMES_HOME'], sys.argv[1], os.environ['DASH_HERMES_SOURCE'])
        print(json.dumps(result))
    except Exception:
        print('null')
        sys.exit(1)
