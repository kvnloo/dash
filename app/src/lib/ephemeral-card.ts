import type { LiveIntent } from "../../../shared/live";
import { EPHEMERAL_APPS_BY_KIND, EPHEMERAL_KINDS, type EphemeralKind } from "../vendor/ephemeral-ui/kinds.generated";
import { EPHEMERAL_KIT_PARTS as parts } from "../vendor/ephemeral-ui/kit-html.generated";

/**
 * kvnloo/ephemeral-ui cards (card.v0). The model names a kind and a catalog app; the host draws the
 * repo's own card from the pinned, vendored kit with its synthetic public fixtures. No model input,
 * code or URL reaches the page.
 */
export type EphemeralCardSpec = { kind: EphemeralKind; app: string };

const KIND_SET: ReadonlySet<string> = new Set(EPHEMERAL_KINDS);
export const isEphemeralKind = (kind: unknown): kind is EphemeralKind => typeof kind === "string" && KIND_SET.has(kind);

/** Validate a kind and optional app id; the app must list the kind in the kit catalog. */
export function ephemeralCardSpec(kind: unknown, app?: unknown): EphemeralCardSpec | null {
  if (!isEphemeralKind(kind)) return null;
  const apps = EPHEMERAL_APPS_BY_KIND[kind];
  if (app === undefined || app === null || app === "") return apps[0] ? { kind, app: apps[0] } : null;
  return typeof app === "string" && apps.includes(app) ? { kind, app } : null;
}

const dataFor = (kind: EphemeralKind): ("apps" | "themes" | "trace" | "intent")[] =>
  kind.startsWith("trace") ? ["apps", "themes", "trace"]
    : kind.startsWith("intent-") || kind.startsWith("intel-") ? ["apps", "themes", "intent"]
      : ["apps", "themes"];

/** One self-contained card page: the kit plus only the fixtures its kind reads. */
export function ephemeralCardDocument(spec: EphemeralCardSpec, scheme: "light" | "dark"): string {
  const page = parts.head + dataFor(spec.kind).map(key => parts.data[key]).join(",") + parts.tail;
  const json = JSON.stringify({ kind: spec.kind, app: spec.app, scheme }).replace(/</g, "\\u003c");
  return page.replace("/*EUI_SPEC*/null", () => json);
}

export type EphemeralMessage =
  | { type: "eui:ready" }
  | { type: "eui:error"; reason: string }
  | { type: "eui:size"; height: number }
  | { type: "eui:intent"; action: string; label: string; ids: string[]; at: number };

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ID = /^[a-z][a-z0-9-]*:[\w.:\-@#/ ]{1,120}$/i;

/** Parse one message from the card page. Anything else is dropped. */
export function parseEphemeralMessage(raw: unknown): EphemeralMessage | null {
  let v: unknown = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { return null; } }
  if (!record(v)) return null;
  if (v.type === "eui:ready") return { type: "eui:ready" };
  if (v.type === "eui:error") return { type: "eui:error", reason: typeof v.reason === "string" ? v.reason.slice(0, 200) : "" };
  if (v.type === "eui:size") return typeof v.height === "number" && Number.isFinite(v.height) && v.height > 0 ? { type: "eui:size", height: Math.min(Math.round(v.height), 2400) } : null;
  if (v.type === "eui:intent" && record(v.detail)) {
    const d = v.detail;
    if (typeof d.action !== "string" || !/^[a-z0-9_-]{1,40}$/i.test(d.action)) return null;
    const label = typeof d.label === "string" ? d.label.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    const ids = Array.isArray(d.ids) ? d.ids.filter((id): id is string => typeof id === "string" && ID.test(id)).slice(0, 8) : [];
    // The kit mirrors tell() to a parent frame and the host page forwards the DOM event too; `at` dedupes.
    const at = typeof d.at === "number" && Number.isFinite(d.at) ? d.at : 0;
    return label ? { type: "eui:intent", action: d.action, label, ids, at } : null;
  }
  return null;
}

/** The agent-bound context for one card action: controlId names card and action, value holds type:id ids. */
export function ephemeralIntent(spec: EphemeralCardSpec, message: Extract<EphemeralMessage, { type: "eui:intent" }>): LiveIntent {
  return {
    controlId: `eui.${spec.kind}.${message.action}`.slice(0, 64),
    value: message.ids.length ? message.ids : [`card:${spec.kind}`],
    label: message.label,
    surface: `ephemeral-ui:${spec.app}`.slice(0, 40),
  };
}
