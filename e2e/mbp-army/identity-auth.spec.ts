// Real authenticated bridge routes with an ephemeral ES256 z0bridge authority.
// The fixture issues tokens and introspects only its own minted access tokens.
import { test, expect, type Bridge } from './fixtures';
import { record } from '../../shared/z0bridge-identity';

test.use({ bridgeOptions: { identity: true, env: { DASH_NATIVE_VOICE: '1' } } });

const roster = (bridge: Bridge, token: string) =>
  fetch(`http://127.0.0.1:${bridge.port}/roster`, { headers: { Authorization: `Bearer ${token}` } });

function changeSignature(token: string): string {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) throw Error('Fixture did not mint a compact JWT');
  const bytes = Buffer.from(signature, 'base64url');
  if (bytes.length !== 64) throw Error('Fixture did not sign ES256 in P1363 format');
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return `${header}.${payload}.${bytes.toString('base64url')}`;
}

function changeKid(token: string): string {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) throw Error('Fixture did not mint a compact JWT');
  const decoded: unknown = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  if (!record(decoded) || typeof decoded.kid !== 'string' || decoded.kid.length !== 43) throw Error('Fixture kid missing');
  const kid = `${decoded.kid[0] === 'A' ? 'B' : 'A'}${decoded.kid.slice(1)}`;
  const changed = Buffer.from(JSON.stringify({ ...decoded, kid })).toString('base64url');
  return `${changed}.${payload}.${signature}`;
}

test('identity token gets 200 from authenticated roster and passes online voice authentication', async ({ bridge }) => {
  const token = bridge.identityToken();
  const response = await roster(bridge, token);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ host: expect.any(String), hosts: expect.any(Array) });

  // /voice/bootstrap requests introspection (unlike /roster). The invalid target
  // reaches request validation (400) only if the minted identity is active.
  const voice = await fetch(`http://127.0.0.1:${bridge.port}/voice/bootstrap`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(voice.status).toBe(400);
});

test('identity token with one flipped signature byte gets 401', async ({ bridge }) => {
  expect((await roster(bridge, changeSignature(bridge.identityToken()))).status).toBe(401);
});

test('identity token with wrong kid gets 401', async ({ bridge }) => {
  expect((await roster(bridge, changeKid(bridge.identityToken()))).status).toBe(401);
});

test('identity token with aud z0live gets 401', async ({ bridge }) => {
  expect((await roster(bridge, bridge.identityToken({ aud: 'z0live' }))).status).toBe(401);
});

test('identity token missing dash:chat scope gets 401', async ({ bridge }) => {
  expect((await roster(bridge, bridge.identityToken({ scope: 'z0live:voice' }))).status).toBe(401);
});
