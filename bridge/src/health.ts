// Authenticated bridge lifecycle probes. The bridge owns admission and turn cleanup.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const DRAIN_MESSAGE = "This computer is restarting for an update; try again in a minute.";

type HealthOptions = {
  authorize(request: Request): Promise<boolean>;
  running(): number;
  voiceSessions(): number;
  onDrain(): void;
};

function releaseSha(): string | null {
  const configured = process.env.DASH_RELEASE_SHA?.trim();
  if (configured) return configured;
  try {
    // bridge/src -> repository root = <bridge dir>/../.dash-release-ready
    return readFileSync(resolve(import.meta.dir, "../..", ".dash-release-ready"), "utf8")
      .trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

export function createBridgeHealthHttpHandler(options: HealthOptions) {
  const release = releaseSha();
  const startedAtMs = Date.now();
  let draining = false;

  const drain = (): void => {
    if (draining) return;
    draining = true;
    options.onDrain();
  };

  const handle = async (request: Request): Promise<Response | null> => {
    const path = new URL(request.url).pathname;
    if (path !== "/health" && path !== "/drain") return null;
    if (!await options.authorize(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (path === "/health") {
      if (request.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 });
      return Response.json({
        release,
        startedAtMs,
        running: options.running(),
        waiting: 0,
        voiceSessions: options.voiceSessions(),
        draining,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    drain();
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  };

  return { handle, drain, get draining() { return draining; } };
}
