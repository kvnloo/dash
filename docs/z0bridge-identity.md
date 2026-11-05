# Dash identity migration (opt-in, issue #79)

Nothing in this change deploys a service, enrolls a credential, consumes a live
pairing code, or changes an existing phone's pairing. The bootstrap/code/sonic
flow and `~/.dash/token` remain the defaults. Do not switch the live services
without Kevin's explicit decision.

## Contract

Reference: kvnloo/z0bridge PR #2, commit
`7d9f5ad1300b0b322a55f7cf0dc0d6cfa183e6f7`, `docs/PAIRING.md`.
The CLI actually emits `dash://pair?v=2&url=…&code=z0bp_…&kid=…&app=dash`;
Dash accepts both that route and the issue's `dash://connect` spelling. Codes
are case-sensitive opaque values, not six-character Dash codes. Opening a link
only prefills the Pair screen. An explicit confirmation is required to claim it.

The native app checks the public key's RFC 7638 thumbprint before claiming,
stores the returned client credential in `expo-secure-store`, and persists only
identity URL, issuer, key id and credential id in ordinary settings. Access
tokens (`aud: dash`, `scope: [dash:chat]`, 120 seconds) are cached in memory and
refreshed on demand, including reconnects. Roster, attachments and native
WebSocket upgrades use Authorization headers. A mint failure never falls back
to an old token. Forgetting the bridge deletes the selected secure credential
and clears the in-memory token cache. Re-pairing does not revoke other enrollments.

Browser WebSockets cannot set Authorization headers. Identity pairing and
identity WebSockets deliberately refuse web rather than putting a JWT in a URL.
Legacy web pairing is unchanged. Native hardware/runtime verification is still
required before switching a phone; host tests are not device evidence.

The bridge checks ES256 signature, pinned key, issuer, exact `aud == dash`,
`dash:chat`, token type, and bounded validity. HTTP requests verify offline
(after the initial pinned JWKS fetch). WebSocket admission additionally requires
successful online introspection. Open identity sockets are introspected every
60 seconds by default, and close with 1008 on revocation, scope removal,
identity outage, or token expiry. Expiry is enforced independently of that poll
and checked before accepting another socket message. Disconnect only detaches
the socket, following the existing replay/turn lifetime policy; it does not
launch, cancel or retry an agent turn. Identity JWTs are never accepted from
`?token=`. Legacy query tokens on `/ws` and `/roster` remain compatible.

## Owner-only switch, not executed by this PR

Identity-only z0bridge currently listens at loopback `http://127.0.0.1:4789`
and tailnet `http://100.113.138.100:4788`. It does not provide Hermes ACP on
`:4787`. Enabling full z0bridge there is a separate owner decision.

When ready, the owner would create a separate least-privilege verifier enrollment
with the existing z0bridge CLI. These commands mutate the live registry and must
NOT be run as part of host verification:

```sh
z0bridge enroll-local --app dash --label dash-verifier \
  --scope z0bridge:introspect --out ~/.dash/z0bridge-verifier.json
```

The bridge's explicitly selected environment would then contain:

```text
DASH_IDENTITY=1
DASH_IDENTITY_URL=http://127.0.0.1:4789
DASH_IDENTITY_ISSUER=z0bridge:host-b
DASH_IDENTITY_KID=<RFC-7638 kid checked privately against the identity service>
DASH_IDENTITY_CREDENTIAL_FILE=/absolute/path/to/.dash/z0bridge-verifier.json
```

`DASH_IDENTITY_RECHECK_SECONDS` can bound the poll between 1 and 300 seconds
(default 60). Opt-in startup refuses missing/malformed configuration or an
unprotected credential file. No owner credential is used for introspection.
Keep `DASH_LEGACY_TOKEN` unset (or `1`) throughout migration. Only the owner may
set `DASH_LEGACY_TOKEN=0`; that refuses the legacy execution token AND all legacy
bootstrap/pair endpoints, so the bootstrap flow cannot reissue a disabled token.

To switch an app later, the owner generates a new private delivery link, using
`--name` for the intended device and the CLI's private QR/link/file delivery:

```sh
z0bridge pair --app dash --kind client --name <device-name> \
  --scope dash:chat --scheme dash --deeplink-file <new-private-file>
```

Do not print that file or its code. Open it privately in native Dash, enter the
Dash bridge's address (normally `100.113.138.100:4747`, NOT the identity port),
and press Confirm z0bridge pairing. No automatic discovery/port switch occurs.
The existing pairing continues working on every other client.

### Bridge-to-z0bridge enrollment (independent opt-in)

The owner may eventually replace the pre-existing owner-token transport:

```sh
z0bridge enroll-local --app dash --label dash-bridge \
  --scope hermes:sessions.read --scope hermes:turns \
  --out ~/.dash/z0bridge-credential.json
```

Set `DASH_Z0BRIDGE_CREDENTIAL_FILE` to that private JSON file; optionally select
`DASH_Z0BRIDGE_URL` (loopback only, default `http://127.0.0.1:4787`). The enrollment
file's identity listener URL is not silently used as the ACP URL. With an explicit
credential selection, invalid files/scopes never fall back to the owner token.
Without that selection, the existing owner-token configuration is unchanged.
With identity-only service or unavailable ACP, the existing native Hermes route
remains the fallback. Once a turn has been accepted/refused it is never retried
on another transport. This change does not enable full z0bridge or gateway sends.

### Rollback

Leave legacy acceptance on. Remove only the new `DASH_IDENTITY*` settings and/or
`DASH_Z0BRIDGE_CREDENTIAL_FILE` from an owner-controlled future deployment.
Identity clients would then need an explicit legacy pairing or settings change;
there is no silent downgrade. Do not stop z0bridge-identity or alter unrelated
services as a rollback shortcut. This PR does not edit unit files or live config.

## Cheap, isolated host verification

From this worktree, with Bun on PATH:

```sh
bun test shared/z0bridge-identity.test.ts \
  app/src/lib/identity-client.test.ts app/src/lib/identity-transport.test.ts \
  bridge/src/bridge-security.test.ts bridge/src/bridge-security-entry.test.ts \
  bridge/src/bridge-security-identity.test.ts \
  bridge/src/bridge-security-identity-entry.test.ts \
  bridge/src/z0bridge-hermes-enrollment.test.ts
```

All authority keys, codes, credentials, listeners, uploads and registries in these
tests are disposable fixtures. The canonical entrypoint is exercised in a child
with a scratch HOME/PATH/credential directory, disabled speech and random
loopback ports. Only that child is terminated. The tests do not reach a phone,
perform input, run agents, install packages, or contact live identity admin APIs.
No service is left running. Tests assert that secrets do not appear in logs.

Recovery verification also ran each of the 75 `app/src`, `bridge/src`, and
`shared` test files in a separate Bun process, plus the five root-script test
files: 619 passed across 80 files. This is not a green claim for the single-process
suite: the unchanged base's `hermes-live.test.ts` cancellation fixture leaves a
five-second termination timer that can close an already-closed stream when the
process stays alive. A separate baseline reproduction confirms that failure.
The app typecheck is also blocked by pre-existing missing installed font, gradient,
and picker packages (identical diagnostics on the base); bridge typecheck and
lint pass. No packages were installed to hide that environment limitation.

Host transport tests check the React Native constructor's third-argument header
contract and exercise real authenticated Bun sockets at the bridge entrypoint.
They do not prove that a particular phone's React Native runtime transmits those
headers, nor do they exercise Keychain/Keystore hardware. Keep rollout blocked on
an owner-approved native-runtime check; no phone migration is performed here.
