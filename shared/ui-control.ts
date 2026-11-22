/**
 * Agent-to-app UI presentation commands. This module defines a versioned bridge-to-app
 * frame and validates untrusted JSON; it does not authorize or execute commands.
 * Imported by both bridge and app without native or third-party dependencies.
 */
export const UI_CONTROL_SCHEMA = "dash.ui_control/v1";

export const UI_CONTROL_LIMITS = {
  idMaxLength: 128,
  testIdMaxLength: 64,
  labelMaxLength: 120,
  strokeMaxCount: 16,
  pointMaxCountPerStroke: 512,
  ttlMinMs: 250,
  ttlMaxMs: 30_000,
};

export type UiControlRoute = "Lab" | "Trace" | "Orchestra" | "Settings" | "Bots" | "Hosts" | "Chats" | "Chat";

/** The deep-link AppRoute names (including the legacy Bots alias and the Chats list) plus the Chat screen, with exact case. */
export const UI_CONTROL_ROUTES: readonly UiControlRoute[] = [
  "Lab", "Trace", "Orchestra", "Settings", "Bots", "Hosts", "Chats", "Chat",
];

export type UiControlTarget = { testID: string } | { x: number; y: number };
export type UiControlPoint = [x: number, y: number];
export interface UiControlStroke {
  points: UiControlPoint[];
}

/** Commands describe presentation intent; they cannot perform arbitrary taps or URL navigation. */
export type UiControlCommand =
  | { type: "point"; id: string; target: UiControlTarget; label?: string; ttlMs: number }
  | { type: "draw"; id: string; strokes: UiControlStroke[]; color?: "gold" | "cream"; ttlMs: number }
  /**
   * chatTitle (Chat only): open the phone's chat with this title (exact, case-insensitive) when the
   * agent does not know the phone-side conversation id. annotate (Chat only): enter annotation mode
   * once the chat is showing. Both are additive v1 fields; an older app ignores them.
   */
  | { type: "navigate"; id: string; route: UiControlRoute; conversationId?: string; chatTitle?: string; annotate?: true }
  | { type: "highlight"; id: string; testID: string; ttlMs: number }
  | { type: "clear"; id?: string };

/** Additive server frame. Legacy peers can ignore its unknown type. */
export interface UiControlWireMessage {
  type: "ui_control";
  schema: typeof UI_CONTROL_SCHEMA;
  command: UiControlCommand;
}

export type UiControlParseResult =
  | { ok: true; command: UiControlCommand }
  | { ok: false; error: string };

const TEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 && value.length <= UI_CONTROL_LIMITS.idMaxLength &&
    value.trim().length > 0;
}

function isTestId(value: unknown): value is string {
  return typeof value === "string" && TEST_ID.test(value);
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isTtl(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= UI_CONTROL_LIMITS.ttlMinMs && value <= UI_CONTROL_LIMITS.ttlMaxMs;
}

function isLabel(value: unknown): value is string {
  return typeof value === "string" && value.length <= UI_CONTROL_LIMITS.labelMaxLength;
}

function isRoute(value: unknown): value is UiControlRoute {
  return typeof value === "string" && UI_CONTROL_ROUTES.some((route) => route === value);
}

/** No selector syntax, arbitrary URLs, or partially specified coordinates. */
function parseTarget(raw: unknown): UiControlTarget | null {
  if (!isRecord(raw)) return null;
  if ("testID" in raw) {
    // Two different destinations are ambiguous, even though other unknown fields are ignored.
    if ("x" in raw || "y" in raw) return null;
    return isTestId(raw.testID) ? { testID: raw.testID } : null;
  }
  return isCoordinate(raw.x) && isCoordinate(raw.y)
    ? { x: raw.x, y: raw.y }
    : null;
}

function parseStrokes(raw: unknown): UiControlStroke[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > UI_CONTROL_LIMITS.strokeMaxCount) return null;
  const strokes: UiControlStroke[] = [];
  for (const stroke of raw) {
    if (!isRecord(stroke) || !Array.isArray(stroke.points) ||
        stroke.points.length < 1 || stroke.points.length > UI_CONTROL_LIMITS.pointMaxCountPerStroke) return null;
    const points: UiControlPoint[] = [];
    for (const point of stroke.points) {
      if (!Array.isArray(point) || point.length !== 2 ||
          !isCoordinate(point[0]) || !isCoordinate(point[1])) return null;
      points.push([point[0], point[1]]);
    }
    strokes.push({ points });
  }
  return strokes;
}

function reject(error: string): UiControlParseResult {
  return { ok: false, error };
}

/**
 * Accepts only the v1 ui_control envelope and returns a freshly constructed command.
 * Discards unknown properties at every level. Consent, session checks, and overlay
 * expiration are responsibilities of the bridge/app integration, not of parsing.
 */
export function parseUiControl(raw: unknown): UiControlParseResult {
  if (!isRecord(raw) || raw.type !== "ui_control") return reject("invalid message type");
  if (raw.schema !== UI_CONTROL_SCHEMA) return reject("unsupported ui_control schema");
  if (!isRecord(raw.command)) return reject("invalid command");
  const command = raw.command;
  const id = isBoundedId(command.id) ? command.id : null;

  switch (command.type) {
    case "point": {
      if (id === null) return reject("invalid point.id");
      const target = parseTarget(command.target);
      if (target === null) return reject("invalid point.target");
      if (!isTtl(command.ttlMs)) return reject("invalid point.ttlMs");
      if (command.label !== undefined && !isLabel(command.label)) return reject("invalid point.label");
      return {
        ok: true,
        command: {
          type: "point", id, target, ttlMs: command.ttlMs,
          ...(command.label !== undefined ? { label: command.label } : {}),
        },
      };
    }
    case "draw": {
      if (id === null) return reject("invalid draw.id");
      const strokes = parseStrokes(command.strokes);
      if (strokes === null) return reject("invalid draw.strokes");
      if (!isTtl(command.ttlMs)) return reject("invalid draw.ttlMs");
      if (command.color !== undefined && command.color !== "gold" && command.color !== "cream") {
        return reject("invalid draw.color");
      }
      return {
        ok: true,
        command: {
          type: "draw", id, strokes, ttlMs: command.ttlMs,
          ...(command.color !== undefined ? { color: command.color } : {}),
        },
      };
    }
    case "navigate":
      if (id === null) return reject("invalid navigate.id");
      if (!isRoute(command.route)) return reject("invalid navigate.route");
      if (command.conversationId !== undefined && !isBoundedId(command.conversationId)) {
        return reject("invalid navigate.conversationId");
      }
      if (command.chatTitle !== undefined && !isBoundedId(command.chatTitle)) return reject("invalid navigate.chatTitle");
      if (command.annotate !== undefined && command.annotate !== true) return reject("invalid navigate.annotate");
      // A chat target or annotation only means something on the Chat screen; one target at a time.
      if (command.route !== "Chat" && (command.conversationId !== undefined || command.chatTitle !== undefined || command.annotate !== undefined)) {
        return reject("navigate.conversationId, chatTitle and annotate need route Chat");
      }
      if (command.conversationId !== undefined && command.chatTitle !== undefined) return reject("navigate takes conversationId or chatTitle, not both");
      return {
        ok: true,
        command: {
          type: "navigate", id, route: command.route,
          ...(command.conversationId !== undefined ? { conversationId: command.conversationId } : {}),
          ...(command.chatTitle !== undefined ? { chatTitle: command.chatTitle } : {}),
          ...(command.annotate === true ? { annotate: true } : {}),
        },
      };
    case "highlight":
      if (id === null) return reject("invalid highlight.id");
      if (!isTestId(command.testID)) return reject("invalid highlight.testID");
      if (!isTtl(command.ttlMs)) return reject("invalid highlight.ttlMs");
      return {
        ok: true,
        command: { type: "highlight", id, testID: command.testID, ttlMs: command.ttlMs },
      };
    case "clear":
      if (command.id !== undefined && id === null) return reject("invalid clear.id");
      return { ok: true, command: { type: "clear", ...(id !== null ? { id } : {}) } };
    default:
      return reject("unknown ui_control command type");
  }
}

/** Bridge-assigned correlation for one delivered frame; echoed by the app's ack. */
const REF = /^[A-Za-z0-9_-]{1,64}$/;

/** The delivered frame: the v1 envelope plus the bridge's correlation ref. */
export interface UiControlFrame extends UiControlWireMessage {
  ref: string;
}

export function parseUiControlFrame(raw: unknown): UiControlFrame | null {
  if (!isRecord(raw) || typeof raw.ref !== "string" || !REF.test(raw.ref)) return null;
  const parsed = parseUiControl(raw);
  return parsed.ok ? { type: "ui_control", schema: UI_CONTROL_SCHEMA, ref: raw.ref, command: parsed.command } : null;
}

/**
 * App -> bridge. `hello` advertises that this app understands ui_control and whether the owner
 * has agent control switched on; `ack` reports what happened to one delivered frame.
 * done: performed. skipped: understood but not possible now (unknown chat, stale target).
 * refused: agent control is off, or the owner dismissed agent control moments ago.
 */
export type UiControlAckStatus = "done" | "skipped" | "refused";
export type UiControlClientMessage =
  | { type: "ui_control_hello"; enabled: boolean }
  | { type: "ui_control_ack"; ref: string; status: UiControlAckStatus; detail?: string; screen?: string; ms?: number };

export const UI_CONTROL_DETAIL_MAX = 200;

export function parseUiControlClientMessage(raw: unknown): UiControlClientMessage | null {
  if (!isRecord(raw)) return null;
  if (raw.type === "ui_control_hello") return typeof raw.enabled === "boolean" ? { type: "ui_control_hello", enabled: raw.enabled } : null;
  if (raw.type !== "ui_control_ack" || typeof raw.ref !== "string" || !REF.test(raw.ref)) return null;
  if (raw.status !== "done" && raw.status !== "skipped" && raw.status !== "refused") return null;
  if (raw.detail !== undefined && (typeof raw.detail !== "string" || raw.detail.length > UI_CONTROL_DETAIL_MAX)) return null;
  if (raw.screen !== undefined && (typeof raw.screen !== "string" || !TEST_ID.test(raw.screen))) return null;
  if (raw.ms !== undefined && (typeof raw.ms !== "number" || !Number.isFinite(raw.ms) || raw.ms < 0 || raw.ms > 600_000)) return null;
  return {
    type: "ui_control_ack", ref: raw.ref, status: raw.status,
    ...(raw.detail !== undefined ? { detail: raw.detail } : {}),
    ...(raw.screen !== undefined ? { screen: raw.screen } : {}),
    ...(raw.ms !== undefined ? { ms: raw.ms } : {}),
  };
}

const PATH_ROUTES: Readonly<Record<string, UiControlRoute>> = {
  lab: "Lab", trace: "Trace", orchestra: "Orchestra", settings: "Settings",
  bots: "Hosts", hosts: "Hosts", chats: "Chats", chat: "Chat",
};

/**
 * The agent-facing path syntax, e.g. "Chats > Release notes > Annotate", "Settings", "Chat".
 * "Chats > <title>" opens that chat; a trailing "Annotate" enters annotation mode there.
 * "Chats > id:<conversationId>" names the phone conversation id instead of a title.
 */
export function parseUiControlPath(path: string, id: string): UiControlParseResult {
  const parts = path.split(">").map(part => part.trim());
  if (parts.some(part => part.length === 0)) return reject("empty path segment");
  const [head, ...rest] = parts;
  const route = head === undefined ? undefined : PATH_ROUTES[head.toLowerCase()];
  if (!route) return reject(`unknown screen "${head ?? ""}" (use ${Object.keys(PATH_ROUTES).join(", ")})`);
  const annotate = rest.length > 0 && rest[rest.length - 1]?.toLowerCase() === "annotate";
  if (annotate) rest.pop();
  if (route !== "Chats" && route !== "Chat" && (rest.length > 0 || annotate)) return reject(`${route} takes no further path`);
  if (rest.length > 1) return reject("a chat path is Chats > <chat> [> Annotate]");
  const chat = rest[0];
  if (chat === undefined && route === "Chats" && annotate) return reject("Annotate needs a chat: Chats > <chat> > Annotate");
  const target = chat === undefined ? {} : chat.toLowerCase().startsWith("id:") ? { conversationId: chat.slice(3).trim() } : { chatTitle: chat };
  return parseUiControl({
    type: "ui_control", schema: UI_CONTROL_SCHEMA,
    command: { type: "navigate", id, route: chat === undefined ? route : "Chat", ...target, ...(annotate ? { annotate: true } : {}) },
  });
}
