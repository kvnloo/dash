/**
 * Live preview: which build this bundle is, which build the Metro it came from serves now, and
 * when to reload. Pure logic; the chip (components/ServedBuildChip.tsx) owns the side effects.
 *
 * Identity flow: the groot follower (scripts/channels/dash-channel) writes {sha, builtAtMs} into
 * src/lib/build-info.json of an immutable release before Metro starts. The bundle bakes that file
 * in (what this app RUNS) and app.config.js republishes it in the manifest (what Metro SERVES).
 * Both come from one file, so they cannot disagree about the same release.
 */
import buildInfoJson from "./build-info.json";

export interface LiveBuild {
  sha: string;
  builtAtMs: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SHA = /^[0-9a-f]{7,64}$/;

export function parseLiveBuild(value: unknown): LiveBuild | null {
  if (!isRecord(value)) return null;
  const sha = typeof value.sha === "string" ? value.sha.trim().toLowerCase() : "";
  if (!SHA.test(sha)) return null;
  const at = value.builtAtMs;
  return { sha, builtAtMs: typeof at === "number" && Number.isFinite(at) && at > 0 ? at : null };
}

/** What this JavaScript bundle is. Null in a local checkout or a release build. */
export const RUNNING_BUILD: LiveBuild | null = parseLiveBuild(buildInfoJson);

/** The build an Expo manifest advertises: manifest.extra.expoClient.extra.dashBuild. */
export function manifestBuild(manifest: unknown): LiveBuild | null {
  if (!isRecord(manifest) || !isRecord(manifest.extra)) return null;
  const client = manifest.extra.expoClient;
  if (!isRecord(client) || !isRecord(client.extra)) return null;
  return parseLiveBuild(client.extra.dashBuild);
}

export function sameBuild(a: LiveBuild | null, b: LiveBuild | null): boolean {
  return a !== null && b !== null && a.sha === b.sha;
}

/** `host:port` (manifest hostUri) or a full http(s) URL to an origin; anything else is rejected. */
export function metroOrigin(hostUri: unknown): string | null {
  if (typeof hostUri !== "string") return null;
  const raw = hostUri.trim();
  const match = /^(?:https?:\/\/)?([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(?::(\d{1,5}))?(?:\/.*)?$/.exec(raw);
  const host = match?.[1];
  if (!host) return null;
  const port = match[2];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;
  const scheme = raw.startsWith("https://") ? "https" : "http";
  return scheme + "://" + host + (port ? ":" + port : "");
}

/** Origin of the bundle URL the app was loaded from (SourceCode.scriptURL); null for embedded bundles. */
export function scriptUrlOrigin(scriptUrl: unknown): string | null {
  return typeof scriptUrl === "string" && /^https?:\/\//.test(scriptUrl.trim()) ? metroOrigin(scriptUrl) : null;
}

export interface MetroEndpoint {
  id: "turbo" | "channel";
  label: string;
  port: number;
}

/** The two Metro servers on the dev host: live-follow turbo (:8213) and the release channel (:8214). */
export const METRO_ENDPOINTS: readonly MetroEndpoint[] = [
  { id: "turbo", label: "Turbo (live)", port: 8213 },
  { id: "channel", label: "RC3 channel", port: 8214 },
];

export function endpointOrigin(origin: string, port: number): string | null {
  const parsed = /^(https?):\/\/([^/:]+|\[[^\]]+\])(?::\d+)?$/.exec(origin);
  return parsed ? parsed[1] + "://" + parsed[2] + ":" + port : null;
}

export function originPort(origin: string): number | null {
  const port = /:(\d{1,5})$/.exec(origin)?.[1];
  return port === undefined ? null : Number(port);
}

/** Deep link the dev client uses to load a Metro server (same URL `dash-channel open` sends). */
export function developmentClientLink(scheme: string, metroUrl: string): string {
  return scheme + "://expo-development-client/?url=" + encodeURIComponent(metroUrl);
}

export const MANIFEST_HEADERS = {
  "expo-platform": "android",
  accept: "application/expo+json,application/json",
} as const;

/** The build the Metro at `origin` serves right now; null when unreachable or not a live-follow release. */
export async function fetchServedBuild(origin: string, fetcher: typeof fetch, timeoutMs = 6_000): Promise<LiveBuild | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(origin + "/", { headers: MANIFEST_HEADERS, signal: controller.signal });
    if (!response.ok) return null;
    return manifestBuild(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Something that must not be interrupted by a reload (a live voice call, an upload). */
const guards = new Map<string, () => boolean>();

export function registerReloadGuard(name: string, isBusy: () => boolean): () => void {
  guards.set(name, isBusy);
  return () => {
    if (guards.get(name) === isBusy) guards.delete(name);
  };
}

export function reloadBlockedBy(): string | null {
  for (const [name, isBusy] of guards) {
    try {
      if (isBusy()) return name;
    } catch {
      return name;
    }
  }
  return null;
}

/** Foreground return reloads at once; otherwise wait for this long without a touch. */
export const IDLE_RELOAD_MS = 30_000;
export const POLL_MS = 20_000;
/** After coming back to the foreground the owner has not started anything yet. */
export const FOREGROUND_GRACE_MS = 5_000;

export interface ReloadInput {
  running: LiveBuild | null;
  served: LiveBuild | null;
  autoReload: boolean;
  /** Milliseconds since the app returned to the foreground. */
  sinceForegroundMs: number;
  /** Milliseconds since the last touch. */
  idleMs: number;
  keyboardVisible: boolean;
  blockedBy: string | null;
  /** The served sha an automatic reload was already attempted for (never loop on one build). */
  lastAutoFor: string | null;
}

export type ReloadDecision =
  | { kind: "current" }
  | { kind: "reload" }
  | { kind: "ready"; why: "manual" | "retried" | "blocked" | "keyboard" | "busy" };

export function decideReload(input: ReloadInput): ReloadDecision {
  const { running, served } = input;
  if (running === null || served === null || sameBuild(running, served)) return { kind: "current" };
  if (!input.autoReload) return { kind: "ready", why: "manual" };
  if (input.lastAutoFor === served.sha) return { kind: "ready", why: "retried" };
  if (input.blockedBy !== null) return { kind: "ready", why: "blocked" };
  if (input.sinceForegroundMs <= FOREGROUND_GRACE_MS) return { kind: "reload" };
  if (input.keyboardVisible) return { kind: "ready", why: "keyboard" };
  if (input.idleMs >= IDLE_RELOAD_MS) return { kind: "reload" };
  return { kind: "ready", why: "busy" };
}

export function shortSha(build: LiveBuild | null): string {
  return build === null ? "?" : build.sha.slice(0, 7);
}

/** One line for the chip: `abc1234 · 3m old`, or `abc1234 → def5678` when the server moved on. */
export function liveChipLabel(running: LiveBuild | null, served: LiveBuild | null, nowMs: number, ageLabel: (atMs: number | null, nowMs: number) => string): string {
  if (running !== null && served !== null && !sameBuild(running, served)) return shortSha(running) + " → " + shortSha(served);
  return shortSha(running) + " · " + ageLabel(running?.builtAtMs ?? null, nowMs);
}
