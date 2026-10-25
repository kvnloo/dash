/**
 * Additive ACP permission messages. Shared protocol v1 is unchanged until Hermes
 * wires these parsers into the bridge and app. Unknown fields never cross the
 * boundary, particularly ACP tool arguments, credentials, or raw tool-call data.
 */
export const PERMISSION_WIRE_VERSION = 1;
export const MAX_PERMISSION_ID_LENGTH = 160;
export const MAX_PERMISSION_OPTION_NAME_LENGTH = 160;
export const MAX_PERMISSION_OPTIONS = 16;
export const MAX_PERMISSION_DISPLAY_CONTEXT_LENGTH = 240;

export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

export interface PermissionRequest {
  type: "permission_request";
  requestId: string;
  turnId: string;
  sessionId: string;
  options: PermissionOption[];
  /** Optional display-only summary; never raw ACP tool arguments or credentials. */
  displayContext?: string;
  /** Absolute Unix epoch milliseconds. An expired request still parses so it can be denied. */
  deadlineAt: number;
}

export interface PermissionDecision {
  type: "permission_decision";
  requestId: string;
  turnId: string;
  optionId: string;
}

export interface PermissionResolution {
  type: "permission_resolved";
  requestId: string;
  turnId: string;
  outcome: "allowed" | "denied" | "timeout";
  optionId?: string;
}

export type PermissionWireMessage = PermissionRequest | PermissionDecision | PermissionResolution;

/**
 * Optional hello.capabilities extension. Existing peers need not send or
 * understand it; absence never authorizes a permission decision.
 */
export interface PermissionCapability {
  permissionRequests: 1;
}

export const PERMISSION_CAPABILITY: PermissionCapability = { permissionRequests: PERMISSION_WIRE_VERSION };

/** Legacy status text for a bridge to emit when the peer cannot show a blocker. */
export const UNSUPPORTED_PERMISSION_MESSAGE = "Permission denied: this peer cannot handle approval requests.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CREDENTIAL_HINT = /\b(?:authorization|bearer|password|passwd|secret|token|api[_-]?key|cookie)\b|(?:sk-[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{8,})/i;

function boundedId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PERMISSION_ID_LENGTH &&
    IDENTIFIER.test(value);
}

function boundedOptionName(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PERMISSION_OPTION_NAME_LENGTH &&
    value.trim() === value &&
    !CONTROL.test(value);
}

function optionKind(value: unknown): value is PermissionOptionKind {
  return value === "allow_once" || value === "allow_always" ||
    value === "reject_once" || value === "reject_always";
}

/**
 * This is a display-only allowlist, not a serialization of ACP toolCall.
 * Unbounded, control-character, or credential-like content is omitted instead
 * of copying an arbitrary provider string to the phone.
 */
export function sanitizePermissionDisplayContext(value: unknown): string | undefined {
  if (typeof value !== "string" || CONTROL.test(value)) return undefined;
  const summary = value.replace(/\s+/g, " ").trim();
  if (!summary || summary.length > MAX_PERMISSION_DISPLAY_CONTEXT_LENGTH || CREDENTIAL_HINT.test(summary)) return undefined;
  return summary;
}

export function parsePermissionOption(raw: unknown): PermissionOption | null {
  if (!isRecord(raw) || !boundedId(raw.optionId) || !boundedOptionName(raw.name) || !optionKind(raw.kind)) return null;
  return { optionId: raw.optionId, name: raw.name, kind: raw.kind };
}

export function parsePermissionRequest(raw: unknown): PermissionRequest | null {
  if (!isRecord(raw) || raw.type !== "permission_request" ||
      !boundedId(raw.requestId) || !boundedId(raw.turnId) || !boundedId(raw.sessionId) ||
      typeof raw.deadlineAt !== "number" || !Number.isFinite(raw.deadlineAt) ||
      raw.deadlineAt <= 0 || raw.deadlineAt > Number.MAX_SAFE_INTEGER ||
      !Array.isArray(raw.options) || raw.options.length === 0 ||
      raw.options.length > MAX_PERMISSION_OPTIONS) return null;

  const options: PermissionOption[] = [];
  const ids = new Set<string>();
  for (const candidate of raw.options) {
    const option = parsePermissionOption(candidate);
    if (!option || ids.has(option.optionId)) return null;
    ids.add(option.optionId);
    options.push(option);
  }

  const displayContext = sanitizePermissionDisplayContext(raw.displayContext);
  return {
    type: "permission_request",
    requestId: raw.requestId,
    turnId: raw.turnId,
    sessionId: raw.sessionId,
    options,
    deadlineAt: raw.deadlineAt,
    ...(displayContext === undefined ? {} : { displayContext }),
  };
}

export function parsePermissionDecision(raw: unknown): PermissionDecision | null {
  if (!isRecord(raw) || raw.type !== "permission_decision" ||
      !boundedId(raw.requestId) || !boundedId(raw.turnId) || !boundedId(raw.optionId)) return null;
  return {
    type: "permission_decision",
    requestId: raw.requestId,
    turnId: raw.turnId,
    optionId: raw.optionId,
  };
}

/** Validate both correlation ids and the exact offered option, not its label. */
export function parsePermissionDecisionForRequest(raw: unknown, request: unknown): PermissionDecision | null {
  const decision = parsePermissionDecision(raw);
  const offered = parsePermissionRequest(request);
  if (!decision || !offered ||
      decision.requestId !== offered.requestId || decision.turnId !== offered.turnId ||
      !offered.options.some(option => option.optionId === decision.optionId)) return null;
  return decision;
}

export function parsePermissionResolution(raw: unknown): PermissionResolution | null {
  if (!isRecord(raw) || raw.type !== "permission_resolved" ||
      !boundedId(raw.requestId) || !boundedId(raw.turnId) ||
      (raw.outcome !== "allowed" && raw.outcome !== "denied" && raw.outcome !== "timeout") ||
      (raw.optionId !== undefined && !boundedId(raw.optionId)) ||
      (raw.outcome === "allowed" && raw.optionId === undefined) ||
      (raw.outcome === "timeout" && raw.optionId !== undefined)) return null;

  return {
    type: "permission_resolved",
    requestId: raw.requestId,
    turnId: raw.turnId,
    outcome: raw.outcome,
    ...(raw.optionId === undefined ? {} : { optionId: raw.optionId }),
  };
}

export function parsePermissionMessage(raw: unknown): PermissionWireMessage | null {
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case "permission_request": return parsePermissionRequest(raw);
    case "permission_decision": return parsePermissionDecision(raw);
    case "permission_resolved": return parsePermissionResolution(raw);
    default: return null;
  }
}

export function parsePermissionCapability(raw: unknown): PermissionCapability | null {
  return isRecord(raw) && raw.permissionRequests === PERMISSION_WIRE_VERSION
    ? { permissionRequests: PERMISSION_WIRE_VERSION }
    : null;
}

/** A legacy hello, or a malformed capability declaration, means no approval UI. */
export function peerSupportsPermissionRequests(hello: unknown): boolean {
  return isRecord(hello) && hello.type === "hello" &&
    parsePermissionCapability(hello.capabilities) !== null;
}

/** Bridge fail-closed outcome; also emit UNSUPPORTED_PERMISSION_MESSAGE as legacy status. */
export function unsupportedPeerPermissionResolution(request: PermissionRequest): PermissionResolution {
  return {
    type: "permission_resolved",
    requestId: request.requestId,
    turnId: request.turnId,
    outcome: "denied",
  };
}
