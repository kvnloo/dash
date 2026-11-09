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

export type UiControlRoute = "Lab" | "Trace" | "Orchestra" | "Settings" | "Bots" | "Hosts" | "Chat";

/** The deep-link AppRoute names (including the legacy Bots alias) plus the Chat screen, with exact case. */
export const UI_CONTROL_ROUTES: readonly UiControlRoute[] = [
  "Lab", "Trace", "Orchestra", "Settings", "Bots", "Hosts", "Chat",
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
  | { type: "navigate"; id: string; route: UiControlRoute; conversationId?: string }
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
      return {
        ok: true,
        command: {
          type: "navigate", id, route: command.route,
          ...(command.conversationId !== undefined ? { conversationId: command.conversationId } : {}),
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
