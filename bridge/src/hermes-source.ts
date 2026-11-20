import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Hermes source checkout for the bridge's Python helpers (hermes-live.py, hermes-steer.py,
 * context-compact.py). They fell back to groot's `/workspace/hermes-home/hermes-agent`, so on any
 * other host every gateway follow-up failed with "Hermes runtime unavailable" (#498).
 * Order: explicit DASH_HERMES_SOURCE, then `~/.hermes/hermes-agent` (groot links ~/.hermes there),
 * then the old groot path.
 */
export function hermesSourceDir(env: Record<string, string | undefined> = process.env, exists: (path: string) => boolean = existsSync): string | undefined {
  const explicit = env.DASH_HERMES_SOURCE?.trim();
  if (explicit) return explicit;
  const home = env.HOME?.trim() || homedir();
  for (const dir of [join(home, ".hermes", "hermes-agent"), "/workspace/hermes-home/hermes-agent"]) {
    if (exists(join(dir, "hermes_bootstrap.py"))) return dir;
  }
  return undefined;
}

/** Copy of `env` with DASH_HERMES_SOURCE resolved for a Python helper. */
export function withHermesSource(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const source = hermesSourceDir(env);
  return source ? { ...env, DASH_HERMES_SOURCE: source } : env;
}
