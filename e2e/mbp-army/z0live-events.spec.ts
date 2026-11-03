// The real bridge's GET /z0live/events SSE stream: what the native over-any-app orb service
// holds while Dash is backgrounded. Drives a fixture z0live session JSONL (the broker's file
// format, in DASH_Z0LIVE_SESSIONS) through a whole call and reads the pushed snapshots.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';

test.use({ bridgeOptions: { identity: true } });

const line = (type: string, data: Record<string, unknown>, text = '') =>
  `${JSON.stringify({ type, ts: Date.now() / 1000, text, data })}\n`;

function snapshots(body: ReadableStream<Uint8Array>): () => Promise<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return async () => {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (event === 'z0live' && data) return JSON.parse(data);
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw Error('z0live events stream ended');
      buffer += decoder.decode(value, { stream: true });
    }
  };
}

test('z0live events stream pushes orb phases for a live call and its end', async ({ bridge }) => {
  const url = `http://127.0.0.1:${bridge.port}/z0live/events`;
  expect((await fetch(url)).status).toBe(401);

  const dir = join(bridge.dir, 'z0live');
  mkdirSync(dir, { recursive: true });
  const session = join(dir, 'army-orb-call.jsonl');
  writeFileSync(session, line('app_state', { source: 'connected' }));

  const controller = new AbortController();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${bridge.identityToken()}` }, signal: controller.signal });
  try {
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    if (!response.body) throw Error('no SSE body');
    const next = snapshots(response.body);

    expect(await next()).toEqual({ live: true, orb: 'listening', muted: false, sessionId: 'army-orb-call' });
    appendFileSync(session, line('floor', { state: 'user' }));
    expect(await next()).toMatchObject({ live: true, orb: 'user' });
    appendFileSync(session, line('user_transcript', {}, 'what time is it') + line('floor', { state: 'quiet' }));
    expect(await next()).toMatchObject({ live: true, orb: 'thinking' });
    appendFileSync(session, line('tool_call', { name: 'clock', call_id: 'c1' }));
    expect(await next()).toMatchObject({ live: true, orb: 'working' });
    appendFileSync(session, line('tool_result', { name: 'clock', call_id: 'c1' }) + line('app_state', { source: 'output_audio_buffer.started' }));
    expect(await next()).toMatchObject({ live: true, orb: 'speaking' });
    appendFileSync(session, line('app_state', { source: 'mute', muted: true }));
    expect(await next()).toMatchObject({ live: true, orb: 'speaking', muted: true });
    appendFileSync(session, line('app_state', { source: 'session_end' }));
    expect(await next()).toEqual({ live: false, orb: 'idle', muted: false });
  } finally {
    controller.abort();
  }
});
