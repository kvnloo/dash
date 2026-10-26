// GET /posture (CIRCADIAN-SPEC WP1c, R4): the owner's interaction posture for the app.
// Reads circadiand's posture.json (DASH_POSTURE_FILE) and recomputes the policy at
// request time. Missing, malformed or older than 15 min -> the clock-only state
// (quality "default"), so Dash works without the service or any wearable (DF-121).
// Only phase, posture and budgets cross the bridge: no times of day, no anchors.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { bearerToken, secretMatches } from "./bridge-security";
import { evaluateHumanPosture, fmt, parseTs, type HumanState, type PostureConfig } from "../../shared/human-posture";
import { policy, type Decision } from "../../shared/interaction-policy";

export const POSTURE_STALE_MS = 15 * 60_000;
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const defaultPostureFile = () => join(homedir(), ".local/state/circadian/posture.json");
/** The owner's anchors are private host config (R4); only these keys are read. */
export const defaultPostureConfigFile = () => join(homedir(), ".config/circadian/config.json");

export async function readAnchors(file: string): Promise<Partial<PostureConfig>> {
  try {
    const raw: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!record(raw)) return {};
    const out: Partial<PostureConfig> = {};
    if (typeof raw.tz === "string") out.tz = raw.tz;
    if (typeof raw.wakeTarget === "string" && /^\d{1,2}:\d{2}$/.test(raw.wakeTarget)) out.wakeTarget = raw.wakeTarget;
    if (typeof raw.bedTarget === "string" && /^\d{1,2}:\d{2}$/.test(raw.bedTarget)) out.bedTarget = raw.bedTarget;
    if (typeof raw.nightModeAt === "string" && /^\d{1,2}:\d{2}$/.test(raw.nightModeAt)) out.nightModeAt = raw.nightModeAt;
    return out;
  } catch { return {}; }
}

export interface PostureView {
  schema: "dash.posture_view/v1";
  source: "circadiand" | "clock";
  phase: Decision["phase"];
  posture: Decision["posture"];
  allowDecisions: Decision["allowDecisions"];
  batchWindow: Decision["batchWindow"];
  verbosity: Decision["verbosity"];
  channel: Decision["channel"];
  captureMode: boolean;
  notifyBudgetPerHour: number;
  interruptCapPerBlock: number;
  capRemaining: number;
  quality: string;
}

const isState = (v: unknown): v is HumanState => {
  if (!record(v) || v.schema !== "dash.human_state/v1" || !record(v.anchors)) return false;
  const a = v.anchors;
  return ["wakeAt", "freezeAt", "bedTarget", "nightModeAt", "wakeTarget"].every((k) => typeof a[k] === "string")
    && (v.lastActivityAt === null || typeof v.lastActivityAt === "string")
    && (v.disengagedUntil === null || typeof v.disengagedUntil === "string");
};

export function postureView(decision: Decision, source: PostureView["source"]): PostureView {
  return {
    schema: "dash.posture_view/v1", source,
    phase: decision.phase, posture: decision.posture, allowDecisions: decision.allowDecisions,
    batchWindow: decision.batchWindow, verbosity: decision.verbosity, channel: decision.channel,
    captureMode: decision.captureMode, notifyBudgetPerHour: decision.notifyBudgetPerHour,
    interruptCapPerBlock: decision.interruptCapPerBlock, capRemaining: decision.capRemaining, quality: decision.quality,
  };
}

/** The current decision: from circadiand when fresh, else clock-only. Never throws. */
export async function readPosture(file: string, nowMs: number, anchors: Partial<PostureConfig> = {}): Promise<{ decision: Decision; source: PostureView["source"] }> {
  const nowIso = fmt(nowMs);
  try {
    const raw: unknown = JSON.parse(await readFile(file, "utf8"));
    if (record(raw) && typeof raw.generatedAt === "string" && isState(raw.state)) {
      const age = nowMs - parseTs(raw.generatedAt);
      if (age >= 0 && age <= POSTURE_STALE_MS) return { decision: policy(raw.state, nowIso), source: "circadiand" };
    }
  } catch { /* missing or malformed: fall through to the clock */ }
  try {
    return { decision: policy(evaluateHumanPosture({}, nowIso, anchors), nowIso), source: "clock" };
  } catch {
    return { decision: policy(evaluateHumanPosture({}, nowIso), nowIso), source: "clock" }; // bad tz or anchors in the host config
  }
}

export function createPostureHttpHandler(options: { token: string; file?: string; configFile?: string; now?: () => number }) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  return async (request: Request): Promise<Response | null> => {
    if (new URL(request.url).pathname !== "/posture") return null;
    if (!secretMatches(bearerToken(request), options.token)) return json({ error: "unauthorized" }, 401);
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    const anchors = await readAnchors(options.configFile ?? defaultPostureConfigFile());
    const { decision, source } = await readPosture(options.file ?? defaultPostureFile(), (options.now ?? Date.now)(), anchors);
    return json(postureView(decision, source));
  };
}
