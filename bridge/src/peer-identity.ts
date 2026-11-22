// Mesh peers through z0bridge: one enrollment on this bridge replaces a per-peer token.
//
// The owner enrolls this bridge once with the z0bridge identity service on this computer:
//   z0bridge enroll-local --app dash --label dash-peer --scope dash:chat --out ~/.dash/z0bridge-peer.json
// and sets DASH_PEER_IDENTITY_FILE to that private file. The bridge then mints short-lived
// `aud: dash`, `dash:chat` access tokens and presents them to every other tailnet computer's
// bridge. A peer bridge that verifies the same z0bridge issuer and pinned key (DASH_IDENTITY=1)
// accepts them, so a new host joins Chats and Hosts with no second pairing code and no
// hand-copied token. Explicit entries in peer-roster-tokens.json still take precedence.
//
//   DASH_PEER_IDENTITY_FILE   private enrollment JSON (0600, app "dash", scope dash:chat, loopback url)
//   DASH_PEER_PORT            port of peer bridges reached this way (default 4747)
import { record } from "../../shared/z0bridge-identity";
import { readLocalCredential } from "./z0bridge-identity";

type Env = Record<string, string | undefined>;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface PeerIdentity {
  /** Port used for peers that have no explicit per-peer entry. */
  port: number;
  /** A current `dash:chat` access token, minted on demand. Rejects when z0bridge refuses. */
  token(): Promise<string>;
}

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Undefined unless the owner explicitly selected a valid private enrollment. Never falls back to the local token. */
export function configuredPeerIdentity(env: Env = process.env, fetchImpl: Fetch = fetch, now: () => number = Date.now): PeerIdentity | undefined {
  const path = env.DASH_PEER_IDENTITY_FILE;
  if (!path) return undefined;
  const port = env.DASH_PEER_PORT === undefined ? 4747 : Number(env.DASH_PEER_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  let cached: { token: string; until: number } | undefined;
  let pending: Promise<string> | undefined;
  const mint = async (): Promise<string> => {
    // Re-read every mint: rotating or deleting the file takes effect without a restart.
    const credential = readLocalCredential(path, ["dash:chat"]);
    if (!credential) throw new Error("Peer identity enrollment missing or unsafe");
    const started = now();
    const response = await fetchImpl(`${credential.url}/v1/token`, {
      method: "POST",
      headers: { authorization: `Bearer ${credential.credential}`, "content-type": "application/json" },
      body: JSON.stringify({ aud: "dash", scope: ["dash:chat"], ttl: 120 }),
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Peer identity token refused: HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!record(body) || body.aud !== "dash" || body.token_type !== "Bearer" || body.scope !== "dash:chat" ||
        typeof body.access_token !== "string" || body.access_token.length > 4096 || !JWT.test(body.access_token) ||
        typeof body.expires_in !== "number" || !Number.isInteger(body.expires_in) || body.expires_in < 30 || body.expires_in > 300) {
      throw new Error("Invalid peer identity token response");
    }
    cached = { token: body.access_token, until: started + body.expires_in * 1000 };
    return body.access_token;
  };
  return {
    port,
    async token() {
      // Keep a margin so a peer never sees a token that expires mid-request.
      if (cached && cached.until > now() + 20_000) return cached.token;
      cached = undefined;
      pending ??= mint().finally(() => { pending = undefined; });
      return pending;
    },
  };
}
