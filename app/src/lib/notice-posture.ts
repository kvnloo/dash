import { evaluateHumanPosture, fmt, PHASES, QUIET } from "../../../shared/human-posture";
import { policy, publicView, ROWS, type Channel, type Decision, type NoticeRoute } from "../../../shared/interaction-policy";
import type { AuthSettings } from "./bridge-auth";

type PairedPostureSettings = AuthSettings & { address: string };
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function parseView(raw: unknown, fallback: Decision): Decision | null {
  if (!record(raw) || raw.schema !== "dash.posture_view/v1") return null;
  const phase = PHASES.find(p => p === raw.phase);
  const allow = raw.allowDecisions;
  if (!phase || (allow !== "all" && allow !== "none" && allow !== "bulk_only" && allow !== "tonight_plans_only")) return null;
  if (raw.channel !== ROWS[phase].channel || typeof raw.capRemaining !== "number" || !Number.isInteger(raw.capRemaining) || raw.capRemaining < 0) return null;
  return { ...fallback, ...ROWS[phase], phase, allowDecisions: allow, capRemaining: raw.capRemaining,
    notifyBudgetPerHour: ROWS[phase].notify, interruptCapPerBlock: ROWS[phase].cap, captureMode: QUIET.has(phase) };
}
export function createNoticePostureReader(deps: {
  now: () => number;
  token: (settings: PairedPostureSettings) => Promise<string>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}) {
  let cached: { key: string; at: number; value: Decision } | undefined;
  let pending: { key: string; value: Promise<Decision> } | undefined;
  return async (settings: PairedPostureSettings | null): Promise<Decision> => {
    const now = deps.now(), iso = fmt(now);
    const fallback = policy(evaluateHumanPosture({}, iso), iso);
    if (!settings) { cached = undefined; return fallback; }
    const key = JSON.stringify(settings);
    if (cached?.key === key && now >= cached.at && now - cached.at < 300_000) return cached.value;
    if (pending?.key === key) return pending.value;
    const value = (async () => {
      try {
        const response = await deps.fetch(`http://${settings.address}/posture`, { method: "GET",
          headers: { Authorization: `Bearer ${await deps.token(settings)}` }, signal: AbortSignal.timeout(5000), redirect: "error" });
        if (!response.ok) throw new Error("posture unavailable");
        const raw: unknown = await response.json();
        const decision = parseView(raw, fallback);
        if (!decision) throw new Error("invalid posture");
        cached = { key, at: now, value: decision };
        return decision;
      } catch { cached = undefined; return fallback; }
    })();
    pending = { key, value };
    try { return await value; } finally { if (pending?.value === value) pending = undefined; }
  };
}
export function nativeNoticeAllowed(decision: Decision, routed: NoticeRoute): boolean {
  if (QUIET.has(decision.phase) || routed.action !== "deliver") return false;
  return routed.cls !== "decision" || publicView(decision).allowDecisions !== "none";
}
export function notificationChannels(importance: { LOW: number; DEFAULT: number }, visibility: number) {
  const quiet = { importance: importance.LOW, sound: null, enableVibrate: false, showBadge: false, lockscreenVisibility: visibility };
  return {
    "dash-quiet": { ...quiet, id: "dash-quiet", name: "Quiet notices" },
    "dash-updates": { ...quiet, id: "dash-updates-low-v1", name: "Silent updates" },
    "dash-focus": { ...quiet, id: "dash-focus", name: "Focus notices", importance: importance.DEFAULT, sound: "default" },
  } satisfies Record<Channel, unknown>;
}
