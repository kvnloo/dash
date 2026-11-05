import { executionToken } from "./bridge-auth";
import type { IdentityEnrollment } from "./identity-client";

/** Both pairing modes are accepted here; identity enrollment never uses the legacy secret. */
export interface BridgeRequestSettings {
  token: string;
  identity?: IdentityEnrollment;
}

export type BridgeAuthFailure = {
  ok: false;
  reason: "no-credential" | "identity-failed";
};

export type BridgeAuthResult =
  | { ok: true; headers: { Authorization: string } }
  | BridgeAuthFailure;

export interface BridgeAuthDependencies {
  executionToken?: (settings: BridgeRequestSettings) => Promise<string>;
}

export interface BridgeFetchDependencies extends BridgeAuthDependencies {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export type BridgeFetchResult =
  | { ok: true; response: Response }
  | BridgeAuthFailure;

/**
 * Resolve the bearer token before issuing HTTP calls to the paired bridge.
 * A failed identity grant must never silently downgrade to legacy pairing.
 */
export async function bridgeAuthHeaders(
  settings: BridgeRequestSettings,
  deps: BridgeAuthDependencies = {},
): Promise<BridgeAuthResult> {
  if (settings.identity) {
    try {
      const token = (await (deps.executionToken ?? executionToken)(settings)).trim();
      return token
        ? { ok: true, headers: { Authorization: "Bearer " + token } }
        : { ok: false, reason: "identity-failed" };
    } catch {
      return { ok: false, reason: "identity-failed" };
    }
  }

  const token = settings.token.trim();
  return token
    ? { ok: true, headers: { Authorization: "Bearer " + token } }
    : { ok: false, reason: "no-credential" };
}

/**
 * Never send an unauthenticated request. Preserve fetch options and caller
 * headers while replacing every previous Authorization spelling/value.
 * Network errors remain fetch errors, not misleading pairing failures.
 */
export async function authorizedBridgeFetch(
  settings: BridgeRequestSettings,
  url: string,
  init?: RequestInit,
  deps: BridgeFetchDependencies = {},
): Promise<BridgeFetchResult> {
  const auth = await bridgeAuthHeaders(settings, deps);
  if (!auth.ok) return auth;

  const headers = new Headers(init?.headers);
  headers.set("Authorization", auth.headers.Authorization);

  const response = await (deps.fetch ?? fetch)(url, { ...init, headers });
  return { ok: true, response };
}
