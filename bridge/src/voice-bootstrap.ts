import { record } from "../../shared/z0bridge-identity";

/** Metadata only: no broker bearer or provider credential crosses this endpoint.
 * The existing Dash session authorizes target discovery, NOT voice. z0bridge
 * separately requires z0live:voice when the app mints the broker access token.
 */
export async function voiceBootstrap(request: Request, identityAuthorized: boolean, resolveTarget: (profile: string, session: string) => { profile: string } | undefined, enabled = process.env.DASH_NATIVE_VOICE !== "0"): Promise<Response | undefined> {
  if (new URL(request.url).pathname !== "/voice/bootstrap") return undefined;
  const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  // A browser Origin is prohibited outside an explicit loopback-only army run.
  // This is not native voice authorization: the bridge still verifies identity.
  const origin = request.headers.get("origin");
  const armyWeb = process.env.DASH_ARMY_VOICE_WEB === "1" &&
    /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.DASH_Z0LIVE_BROKER ?? "") &&
    origin !== null && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) &&
    (process.env.DASH_ALLOWED_ORIGINS ?? "").split(",").includes(origin);
  if (!identityAuthorized || (origin !== null && !armyWeb)) return json({ error: "z0bridge-authenticated native Dash required" }, 401);
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!enabled) return json({ error: "native voice deployment not enabled" }, 503);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return json({ error: "JSON required" }, 415);
  const raw = await request.text();
  if (raw.length > 2048) return json({ error: "bootstrap too large" }, 413);
  let body: unknown; try { body = JSON.parse(raw); } catch { return json({ error: "invalid JSON" }, 400); }
  if (!record(body) || Object.keys(body).some(k => k !== "profile" && k !== "session") || typeof body.profile !== "string" || body.profile.length > 300 || !/^(hermes:session:[^:]+:[^:]+|hermes:[A-Za-z0-9_-]{1,64}|[A-Za-z0-9_-]{1,64})$/.test(body.profile) || typeof body.session !== "string" || !/^[A-Za-z0-9_-]{8,200}$/.test(body.session)) return json({ error: "Attach an exact known Hermes profile/session" }, 400);
  const target = resolveTarget(body.profile, body.session);
  if (!target) return json({ error: "Attach an exact known Hermes profile/session" }, 400);
  return json({ ready: true, profile: body.profile, canonicalProfile: target.profile, session: body.session, broker: process.env.DASH_Z0LIVE_BROKER ?? "https://0.taila30dc.ts.net:8791", audience: "z0live", requiredScope: "z0live:voice", backgroundMicrophone: false });
}
