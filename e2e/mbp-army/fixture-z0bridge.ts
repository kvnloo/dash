// Loopback-only z0bridge identity authority for real-bridge army journeys.
// Everything is ephemeral: keys, enrolled credentials and minted access tokens.
// One authority can serve several bridges (a mesh): each bridge gets its own
// introspection credential (`bridgeEnv`), and a bridge may also hold a `dash:chat`
// client credential to mint access tokens for its peers (`enroll` + POST /v1/token).
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { record } from '../../shared/z0bridge-identity';

export interface IdentityTokenOptions { scope?: string; aud?: string }
export interface FixtureZ0bridge {
  /** Verifier settings for the bridge directory the authority was started for. */
  env: Record<string, string>;
  /** Verifier settings for another bridge directory on the same authority. */
  bridgeEnv(dir: string): Promise<Record<string, string>>;
  /** Enroll a client credential with `scopes`, written 0600 to `file`. Returns its credential id. */
  enroll(file: string, scopes: string[]): Promise<string>;
  /** Revoke an enrolled credential: it can no longer mint, and its tokens stop introspecting active. */
  revoke(credentialId: string): void;
  /** Access tokens minted through POST /v1/token by one credential. */
  mintedBy(credentialId: string): number;
  identityToken(options?: IdentityTokenOptions): string;
  stop(): Promise<void>;
}

type MintedToken = { sub: string; aud: string; scope: string; exp: number };
type Enrolled = { id: string; scopes: string[]; revoked: boolean; minted: number };
const issuer = 'urn:dash:army:z0bridge';
const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
};

async function readJson(request: IncomingMessage): Promise<unknown> {
  request.setEncoding('utf8');
  let raw = '';
  for await (const chunk of request) {
    if (typeof chunk !== 'string') return undefined;
    raw += chunk;
    if (raw.length > 8192) return undefined;
  }
  try { return JSON.parse(raw); } catch { return undefined; }
}

export async function startFixtureZ0bridge(dir: string): Promise<FixtureZ0bridge> {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const exported = publicKey.export({ format: 'jwk' });
  if (typeof exported.x !== 'string' || typeof exported.y !== 'string') throw Error('Fixture P-256 public key is missing coordinates');
  // RFC 7638 canonical member order: crv, kty, x, y.
  const kid = createHash('sha256').update(JSON.stringify({ crv: 'P-256', kty: 'EC', x: exported.x, y: exported.y })).digest('base64url');
  const jwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' };
  const minted = new Map<string, MintedToken>();
  const credentials = new Map<string, Enrolled>();
  const bearer = (request: IncomingMessage): Enrolled | undefined => {
    const header = request.headers.authorization ?? '';
    const entry = header.startsWith('Bearer ') ? credentials.get(header.slice(7)) : undefined;
    return entry && !entry.revoked ? entry : undefined;
  };

  const mint = (sub: string, options: IdentityTokenOptions = {}, ttl = 120): string => {
    const iat = Math.floor(Date.now() / 1000);
    const claims = {
      iss: issuer, aud: options.aud ?? 'dash', scope: options.scope ?? 'dash:chat',
      sub, dev: 'dev_army', app: 'dash', jti: randomUUID(),
      iat, nbf: iat, exp: iat + ttl,
    };
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'at+jwt', kid })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const signature = sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const token = `${signingInput}.${signature}`;
    minted.set(token, { sub: claims.sub, aud: claims.aud, scope: claims.scope, exp: claims.exp });
    return token;
  };

  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/.well-known/jwks.json') {
        json(response, 200, { keys: [jwk] });
        return;
      }
      if (request.method === 'POST' && request.url === '/v1/token') {
        const entry = bearer(request);
        if (!entry) { json(response, 401, { error: 'unauthorized' }); return; }
        const body = await readJson(request);
        if (!record(body) || body.aud !== 'dash' || !Array.isArray(body.scope) || body.scope.length !== 1 || body.scope[0] !== 'dash:chat') {
          json(response, 400, { error: 'invalid token request' });
          return;
        }
        if (!entry.scopes.includes('dash:chat')) { json(response, 403, { error: 'scope refused' }); return; }
        const ttl = typeof body.ttl === 'number' && Number.isInteger(body.ttl) ? Math.min(300, Math.max(30, body.ttl)) : 120;
        entry.minted += 1;
        json(response, 200, { access_token: mint(entry.id, {}, ttl), token_type: 'Bearer', aud: 'dash', scope: 'dash:chat', expires_in: ttl });
        return;
      }
      if (request.method !== 'POST' || request.url !== '/v1/introspect') {
        json(response, 404, { error: 'not found' });
        return;
      }
      if (!bearer(request)?.scopes.includes('z0bridge:introspect')) {
        json(response, 401, { error: 'unauthorized' });
        return;
      }
      const body = await readJson(request);
      if (!record(body) || typeof body.token !== 'string') {
        json(response, 400, { error: 'token required' });
        return;
      }
      const entry = minted.get(body.token);
      const owner = entry ? [...credentials.values()].find(c => c.id === entry.sub) : undefined;
      if (!entry || entry.exp <= Math.floor(Date.now() / 1000) || owner?.revoked) {
        json(response, 200, { active: false });
        return;
      }
      json(response, 200, { active: true, token_type: 'access', ...entry });
    } catch {
      if (!response.headersSent) json(response, 500, { error: 'fixture identity error' });
      else response.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw Error('Fixture identity listener has no TCP port');
  }
  const url = `http://127.0.0.1:${address.port}`;

  const enroll = async (file: string, scopes: string[]): Promise<string> => {
    const id = `cred_${randomBytes(8).toString('hex')}`;
    const credential = `z0bc.${id}.${randomBytes(32).toString('base64url')}`;
    await writeFile(file, JSON.stringify({ app: 'dash', credential, scopes, url }), { mode: 0o600, flag: 'wx' });
    credentials.set(credential, { id, scopes, revoked: false, minted: 0 });
    return id;
  };
  const bridgeEnv = async (bridgeDir: string): Promise<Record<string, string>> => {
    const credentialFile = join(bridgeDir, 'z0bridge-introspection.json');
    await enroll(credentialFile, ['z0bridge:introspect']);
    return {
      DASH_IDENTITY: '1',
      DASH_IDENTITY_URL: url,
      DASH_IDENTITY_ISSUER: issuer,
      DASH_IDENTITY_KID: kid,
      DASH_IDENTITY_CREDENTIAL_FILE: credentialFile,
    };
  };

  let env: Record<string, string>;
  try { env = await bridgeEnv(dir); } catch (error) { server.close(); throw error; }

  return {
    env,
    bridgeEnv,
    enroll,
    revoke(credentialId) { for (const entry of credentials.values()) if (entry.id === credentialId) entry.revoked = true; },
    mintedBy(credentialId) { return [...credentials.values()].find(c => c.id === credentialId)?.minted ?? 0; },
    identityToken(options = {}) { return mint('cred_army', options); },
    async stop() {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
