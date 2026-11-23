// DA-075: read-only `GET /council/run`. Serves the newest council snapshot a recorder wrote to disk
// (`DASH_COUNCIL_RUN`, else `$DASH_CREDENTIAL_DIR/council-run.json`). The bridge never dispatches a
// council or writes one; it parses the file so the phone only ever sees a well-formed run.
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseCouncilRun } from "../../shared/council-run";

/** The wire reply: the recorded JSON as written (seats named by id), only after it parsed. */
export type CouncilRunWire = { run: unknown; from: string } | { run: null; reason: string };

const MAX_BYTES = 256 * 1024;

export function councilRunPath(env: Record<string, string | undefined> = process.env): string {
  return env.DASH_COUNCIL_RUN || join(env.DASH_CREDENTIAL_DIR ?? join(homedir(), ".dash"), "council-run.json");
}

export function readCouncilRun(path = councilRunPath()): CouncilRunWire {
  let raw: string;
  try {
    if (statSync(path).size > MAX_BYTES) return { run: null, reason: "the recorded council run is too large" };
    raw = readFileSync(path, "utf8");
  } catch { return { run: null, reason: "no council run recorded on this computer" }; }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { run: null, reason: "the recorded council run is not JSON" }; }
  const run = parseCouncilRun(value);
  if ("error" in run) return { run: null, reason: run.error };
  return { run: value, from: "this computer" };
}

export function councilRunHttp(request: Request, authorized: boolean, read: () => CouncilRunWire = readCouncilRun): Response | undefined {
  if (new URL(request.url).pathname !== "/council/run") return undefined;
  if (!authorized) return new Response("unauthorized", { status: 401 });
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
  return Response.json(read(), { headers: { "Cache-Control": "no-store" } });
}
