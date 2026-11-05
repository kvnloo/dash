import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { bearerToken, secretMatches } from "./bridge-security";
import { parseKevinBatch } from "../../shared/supervision";

export const DEFAULT_SUPERVISION_DIR = "/mnt/zer0models/workspace/zer0/data/operations/fsm/live";
export function createSupervisionHttpHandler(options: { token: string; directory?: string }) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  return async (request: Request): Promise<Response | null> => {
    if (new URL(request.url).pathname !== "/supervision") return null;
    if (!secretMatches(bearerToken(request), options.token)) return json({ error: "unauthorized" }, 401);
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    try {
      const directory = options.directory ?? DEFAULT_SUPERVISION_DIR;
      const [batchText, stateText] = await Promise.all([readFile(join(directory, "needs-kevin.json"), "utf8"), readFile(join(directory, "state.json"), "utf8")]);
      const raw: unknown = JSON.parse(batchText), state: unknown = JSON.parse(stateText);
      const needs_kevin = parseKevinBatch(raw);
      if (!needs_kevin || typeof state !== "object" || state === null || !("generated_at" in state) || state.generated_at !== needs_kevin.generated_at || !("workers" in state) || !Array.isArray(state.workers) || !("findings" in state) || !Array.isArray(state.findings)) return json({ error: "Supervision snapshot incomplete; retry after next tick" }, 503);
      return json({ needs_kevin, state });
    } catch {
      return json({ error: "Supervision unavailable; timer may not be enabled" }, 503);
    }
  };
}
