// Loopback-only z0bridge identity authority for real-bridge army journeys.
// Everything is ephemeral: keys, introspection credential and minted access tokens.
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { record } from '../../shared/z0bridge-identity';

export interface IdentityTokenOptions { scope?: string; aud?: string }
export interface FixtureZ0bridge {
  env: Record<string, string>;
  identityToken(options?: IdentityTokenOptions): string;
  stop(): Promise<void>;
}

type MintedToken = { sub: string; aud: string; scope: string; exp: number };
const issuer = 'urn:dash:army:z0bridge';
const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
};

export async function startFixtureZ0bridge(dir: string): Promise<FixtureZ0bridge> {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const exported = publicKey.export({ format: 'jwk' });
  if (typeof exported.x !== 'string' || typeof exported.y !== 'string') throw Error('Fixture P-256 public key is missing coordinates');
  // RFC 7638 canonical member order: crv, kty, x, y.
  const kid = createHash('sha256').update(JSON.stringify({ crv: 'P-256', kty: 'EC', x: exported.x, y: exported.y })).digest('base64url');
  const jwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' };
  const credential = `z0bc.cred_${randomBytes(8).toString('hex')}.${randomBytes(32).toString('base64url')}`;
  const minted = new Map<string, MintedToken>();

  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/.well-known/jwks.json') {
        json(response, 200, { keys: [jwk] });
        return;
      }
      if (request.method !== 'POST' || request.url !== '/v1/introspect') {
        json(response, 404, { error: 'not found' });
        return;
      }
      if (request.headers.authorization !== `Bearer ${credential}`) {
        json(response, 401, { error: 'unauthorized' });
        return;
      }
      request.setEncoding('utf8');
      let raw = '';
      for await (const chunk of request) {
        if (typeof chunk !== 'string') { json(response, 400, { error: 'invalid body' }); return; }
        raw += chunk;
        if (raw.length > 8192) { json(response, 413, { error: 'body too large' }); return; }
      }
      let body: unknown;
      try { body = JSON.parse(raw); } catch { json(response, 400, { error: 'invalid JSON' }); return; }
      if (!record(body) || typeof body.token !== 'string') {
        json(response, 400, { error: 'token required' });
        return;
      }
      const entry = minted.get(body.token);
      if (!entry || entry.exp <= Math.floor(Date.now() / 1000)) {
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
  const credentialFile = join(dir, 'z0bridge-introspection.json');
  try {
    await writeFile(credentialFile, JSON.stringify({
      app: 'dash', credential, scopes: ['z0bridge:introspect'], url,
    }), { mode: 0o600, flag: 'wx' });
  } catch (error) {
    server.close();
    throw error;
  }

  return {
    env: {
      DASH_IDENTITY: '1',
      DASH_IDENTITY_URL: url,
      DASH_IDENTITY_ISSUER: issuer,
      DASH_IDENTITY_KID: kid,
      DASH_IDENTITY_CREDENTIAL_FILE: credentialFile,
    },
    identityToken(options = {}) {
      const iat = Math.floor(Date.now() / 1000);
      const claims = {
        iss: issuer, aud: options.aud ?? 'dash', scope: options.scope ?? 'dash:chat',
        sub: 'cred_army', dev: 'dev_army', app: 'dash', jti: randomUUID(),
        iat, nbf: iat, exp: iat + 120,
      };
      const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'at+jwt', kid })).toString('base64url');
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const signingInput = `${header}.${payload}`;
      const signature = sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      const token = `${signingInput}.${signature}`;
      minted.set(token, { sub: claims.sub, aud: claims.aud, scope: claims.scope, exp: claims.exp });
      return token;
    },
    async stop() {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
