import type { CardStyle } from "../store/card-style";
import { ephemeralCardTheme } from "./ephemeral-card-theme";
import type { ThemeMode } from "./theme-mode";
import type { LiveIntent } from "../../../shared/live";
import { EPHEMERAL_APPS_BY_KIND, EPHEMERAL_DATA_BY_KIND, EPHEMERAL_KINDS, type EphemeralKind } from "../vendor/ephemeral-ui/kinds.generated";
import { EPHEMERAL_KIT_PARTS as parts } from "../vendor/ephemeral-ui/kit-html.generated";

/**
 * kvnloo/ephemeral-ui cards (every kind the kit exports). The model names a kind and a catalog app; the host draws the
 * repo's own card from the pinned, vendored kit with its synthetic public fixtures. No model input,
 * code or URL reaches the page.
 */
export type EphemeralCardSpec = { kind: EphemeralKind; app: string; fixture?: EphemeralFixtureMount };
/**
 * Mount one shared-catalog fixture (lib/ephemeral-catalog.ts) exactly as the kit's catalog generator does: its
 * seed and card.input, the clock frozen at the catalog's generatedAt. The page then reports the card's props.
 */
export type EphemeralFixtureMount = { id: string; seed: string; input?: unknown; at: string };

const KIND_SET: ReadonlySet<string> = new Set(EPHEMERAL_KINDS);
export const isEphemeralKind = (kind: unknown): kind is EphemeralKind => typeof kind === "string" && KIND_SET.has(kind);

/** Validate a kind and optional app id; the app must list the kind in the kit catalog. */
export function ephemeralCardSpec(kind: unknown, app?: unknown): EphemeralCardSpec | null {
  if (!isEphemeralKind(kind)) return null;
  const apps = EPHEMERAL_APPS_BY_KIND[kind];
  if (app === undefined || app === null || app === "") return apps[0] ? { kind, app: apps[0] } : null;
  return typeof app === "string" && apps.includes(app) ? { kind, app } : null;
}

const dataFor = (kind: EphemeralKind): ("apps" | "themes" | "trace" | "intent" | "ops")[] => {
  const extra = EPHEMERAL_DATA_BY_KIND[kind];
  return extra ? ["apps", "themes", extra] : ["apps", "themes"];
};

/** One self-contained card page: the kit plus only the fixtures its kind reads. */
export function ephemeralCardDocument(spec: EphemeralCardSpec, mode: ThemeMode, style: CardStyle): string {
  const theme = ephemeralCardTheme(spec.app, mode, style);
  const hostedThemes = `"themes.json":${JSON.stringify(theme.data).replace(/</g, "\\u003c")}`;
  const head = parts.head.replace("</head>", () => `<style>${theme.css}</style></head>`);
  const page = head + dataFor(spec.kind).map(key => key === "themes" ? hostedThemes : parts.data[key]).join(",") + parts.tail;
  const json = JSON.stringify({ kind: spec.kind, app: spec.app, scheme: "dark", fixture: spec.fixture }).replace(/</g, "\\u003c");
  const html = page.replace("/*EUI_SPEC*/null", () => json);
  if (spec.kind !== "inbox" || spec.app !== "gmail") return html;
  return html.replace(/<\/body><\/html>$/, () => `<script>
    const root = document.getElementById("eui-root");
    function decorateInbox() {
      const results = root.querySelector(".inbox");
      const query = root.querySelector(".eu-verb");
      if (!results || !query) return false;
      query.textContent = query.textContent.replace(/^Searched Gmail · "(.*)"$/, ${JSON.stringify(theme.gmailApp ? "$1" : "“$1”")});
      if (${theme.gmailApp}) {
        const heading = document.createElement("h2");
        heading.className = "gmail-top-results";
        heading.textContent = "Top results";
        results.before(heading);
      }
      return true;
    }
    if (!decorateInbox()) {
      const observer = new MutationObserver(() => {
        if (decorateInbox()) observer.disconnect();
      });
      observer.observe(root, { childList: true });
    }
  </script></body></html>`);
}

export type EphemeralMessage =
  | { type: "eui:ready"; props: string | null }
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
  // props: the drawn card's spec as key-sorted JSON (host-entry.js), compared with the catalog fixture's props.
  if (v.type === "eui:ready") return { type: "eui:ready", props: typeof v.props === "string" && v.props.length <= 524_288 ? v.props : null };
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
