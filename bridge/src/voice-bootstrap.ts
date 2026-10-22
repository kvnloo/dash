import { record } from "../../shared/z0bridge-identity";

/** Metadata only: no broker bearer or provider credential crosses this endpoint.
 * The existing Dash session authorizes target discovery, NOT voice. z0bridge
 * separately requires z0live:voice when the app mints the broker access token.
 */
export async function voiceBootstrap(request: Request, identityAuthorized: boolean, knownTarget: (profile: string, session: string) => boolean, enabled = process.env.DASH_NATIVE_VOICE === "1"): Promise<Response | undefined> {
  if (new URL(request.url).pathname !== "/voice/bootstrap") return undefined;
  const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!identityAuthorized || request.headers.has("origin")) return json({ error: "z0bridge-authenticated native Dash required" }, 401);
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!enabled) return json({ error: "native voice deployment not enabled" }, 503);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return json({ error: "JSON required" }, 415);
  const raw = await request.text();
  if (raw.length > 2048) return json({ error: "bootstrap too large" }, 413);
  let body: unknown; try { body = JSON.parse(raw); } catch { return json({ error: "invalid JSON" }, 400); }
  if (!record(body) || Object.keys(body).some(k => k !== "profile" && k !== "session") || typeof body.profile !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body.profile) || typeof body.session !== "string" || !/^[A-Za-z0-9_-]{8,200}$/.test(body.session) || !knownTarget(body.profile, body.session)) return json({ error: "Attach an exact known Hermes profile/session" }, 400);
  return json({ ready: true, profile: body.profile, session: body.session, broker: "https://0.taila30dc.ts.net:8791", audience: "z0live", requiredScope: "z0live:voice", backgroundMicrophone: false });
}
