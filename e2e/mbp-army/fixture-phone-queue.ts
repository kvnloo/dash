// Loopback-only stand-in for the k3s phone queue (`/v1/devices`, `/v1/jobs`) that the real bridge
// reads for desk mode. It serves fixed rows in the queue's loose shape (snake_case, seconds) so the
// bridge's normalization is exercised; no phone, adb or model is involved.
import { once } from 'node:events';
import { createServer } from 'node:http';

export interface FixturePhoneQueue { url: string; hits(): readonly string[]; stop(): Promise<void> }

export async function startFixturePhoneQueue(): Promise<FixturePhoneQueue> {
  const hits: string[] = [];
  const now = Math.floor(Date.now() / 1000);
  const devices = { devices: [
    { id: 's22', name: 'Galaxy S22+', serial: 'ARMYS22', status: 'busy', owner_active: false, battery: 81, foreground_app: 'com.openai.chatgpt', queue_depth: 2 },
    { id: 's25', name: 'S25 Ultra', serial: 'ARMYS25', status: 'held', owner_active: true, battery: { percent: 0.47 }, reason: 'owner using phone' },
  ] };
  const jobs = { jobs: [
    { job_id: 'job-1', status: 'running', device: 's22', type: 'chatgpt', prompt: 'ARMY phone job one: summarize issue 554', submitter: 'omp', created_at: now - 120, started_at: now - 60 },
    { job_id: 'job-2', status: 'queued', device: 's22', type: 'chatgpt', prompt: 'ARMY phone job two', submitter: 'hermes', created_at: now - 30 },
    { job_id: 'job-3', status: 'queued', device: 's25', type: 'deepseek', prompt: 'ARMY phone job three waits for owner', submitter: 'claude-code', created_at: now - 10 },
  ] };
  const server = createServer((request, response) => {
    hits.push(request.url ?? '');
    const body = request.url === '/v1/devices' ? devices : request.url === '/v1/jobs' ? jobs : null;
    response.writeHead(body ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body ?? { error: 'not found' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('phone queue fixture has no port');
  return { url: `http://127.0.0.1:${address.port}`, hits: () => hits, async stop() { server.close(); await once(server, 'close').catch(() => {}); } };
}
