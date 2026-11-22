import { fileURLToPath } from "node:url";
import { record } from "../../shared/context";
import { councilId, councilRevision, parseCouncilPosition } from "../../shared/council-session";
import { withHermesSource } from "./hermes-source";

export async function councilSessionHttp(
  request: Request, authorize: () => Promise<boolean>,
  homeFor: (profile: string, session: string) => string | undefined,
  isLocal: (host: string | undefined) => Promise<boolean>,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== "/council/session") return;
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!await authorize()) return json({ error: "unauthorized" }, 401);
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const session = url.searchParams.get("session");
  const profile = url.searchParams.get("profile");
  if (!session || session.length > 256 || !profile || profile.length > 1024) return json({ error: "invalid session" }, 400);
  if (!await isLocal(url.searchParams.get("host") ?? undefined)) return json({ error: "pair with the session host" }, 404);
  const home = homeFor(profile, session);
  if (!home) return json({ error: "session not found" }, 404);
  const body = await request.json().catch(() => null);
  if (!record(body)) return json({ error: "invalid request" }, 400);
  const { verb, council_id, base_revision } = body;
  const position = parseCouncilPosition(body.position);
  let params;
  if (verb === "list") params = {};
  else if (verb === "load" && councilId(council_id)) params = { council_id };
  else if (verb === "position" && councilId(council_id) && councilRevision(base_revision) && position) {
    params = { council_id, client: "dash", base_revision, position };
  } else return json({ error: "invalid council request" }, 400);

  const env = withHermesSource({ ...process.env, HERMES_HOME: home, PYTHONDONTWRITEBYTECODE: "1" });
  delete env.HERMES_TUI_GATEWAY_URL;
  try {
    const process = Bun.spawn(["python3", fileURLToPath(new URL("./council-session.py", import.meta.url))], {
      env, stdin: "pipe", stdout: "pipe", stderr: "ignore", timeout: 20_000,
    });
    process.stdin.write(JSON.stringify({ session, verb, params }));
    process.stdin.end();
    const raw: unknown = await new Response(process.stdout).json();
    if (await process.exited !== 0 || !record(raw)) throw new Error("Unavailable");
    if (raw.code === 4090) return json({ error: "Council continued on another device. Reopen it to sync again." }, 409);
    if ("error" in raw) return json({ error: "Glide council unavailable in this Hermes session." }, 503);
    return json(raw);
  } catch {
    return json({ error: "Could not reach the Hermes council gateway." }, 503);
  }
}
