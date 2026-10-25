import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION, parseClientMessage, parseServerMessage } from "./protocol";
import {
  MAX_PERMISSION_DISPLAY_CONTEXT_LENGTH,
  MAX_PERMISSION_ID_LENGTH,
  MAX_PERMISSION_OPTION_NAME_LENGTH,
  MAX_PERMISSION_OPTIONS,
  PERMISSION_CAPABILITY,
  UNSUPPORTED_PERMISSION_MESSAGE,
  parsePermissionCapability,
  parsePermissionDecision,
  parsePermissionDecisionForRequest,
  parsePermissionMessage,
  parsePermissionOption,
  parsePermissionRequest,
  parsePermissionResolution,
  peerSupportsPermissionRequests,
  sanitizePermissionDisplayContext,
  unsupportedPeerPermissionResolution,
  type PermissionDecision,
  type PermissionRequest,
  type PermissionResolution,
} from "./permission";

const offered: PermissionRequest = {
  type: "permission_request",
  requestId: "request-01",
  turnId: "turn:abc/123",
  sessionId: "session_01",
  options: [
    { optionId: "yes.once", name: "Allow once", kind: "allow_once" },
    { optionId: "yes.always", name: "Always allow", kind: "allow_always" },
    { optionId: "no.once", name: "Deny once", kind: "reject_once" },
    { optionId: "no.always", name: "Always deny", kind: "reject_always" },
  ],
  deadlineAt: 1_800_000_000_000,
  displayContext: "Run tests in workspace",
};

const approved: PermissionDecision = {
  type: "permission_decision",
  requestId: offered.requestId,
  turnId: offered.turnId,
  optionId: "yes.once",
};

const resolved: PermissionResolution = {
  type: "permission_resolved",
  requestId: offered.requestId,
  turnId: offered.turnId,
  outcome: "allowed",
  optionId: "yes.once",
};

describe("additive ACP permission wire", () => {
  test("round-trips request, decision, and resolution through JSON with no extra fields", () => {
    for (const message of [offered, approved, resolved]) {
      const raw = JSON.parse(JSON.stringify(message));
      expect(parsePermissionMessage(raw)).toEqual(message);
      expect(parsePermissionMessage(parsePermissionMessage(raw))).toEqual(message);
    }
    expect(parsePermissionRequest(offered)).toEqual(offered);
    expect(parsePermissionDecision(approved)).toEqual(approved);
    expect(parsePermissionResolution(resolved)).toEqual(resolved);
  });

  test("accepts every ACP option kind and rejects unexpected kinds", () => {
    for (const option of offered.options) {
      expect(parsePermissionOption(option)).toEqual(option);
    }
    expect(parsePermissionOption({ optionId: "not-kind", name: "Unknown", kind: "approve" })).toBeNull();
    expect(parsePermissionOption({ optionId: "nope", name: "Deny", kind: "reject" })).toBeNull();
    expect(parsePermissionOption({ optionId: "yes", name: "Approve", kind: true })).toBeNull();
    expect(parsePermissionOption({ optionId: "yes", name: "", kind: "allow_once" })).toBeNull();
    expect(parsePermissionOption({ optionId: "yes", name: " Deny", kind: "reject_once" })).toBeNull();
    expect(parsePermissionOption({ optionId: "yes", name: "Deny\nnow", kind: "reject_once" })).toBeNull();
    expect(parsePermissionOption({ optionId: "yes", name: "Authorization: Bearer abc123", kind: "allow_once" })).toBeNull();
  });

  test("rejects empty, whitespace, malformed and oversize correlation ids", () => {
    const invalidIds: unknown[] = ["", " ", " a", "a ", "a\nb", "a\u0000b", "a@b?", "/starts-with-slash", "x".repeat(MAX_PERMISSION_ID_LENGTH + 1), 3, null];
    for (const invalid of invalidIds) {
      expect(parsePermissionRequest({ ...offered, requestId: invalid })).toBeNull();
      expect(parsePermissionRequest({ ...offered, turnId: invalid })).toBeNull();
      expect(parsePermissionRequest({ ...offered, sessionId: invalid })).toBeNull();
      expect(parsePermissionDecision({ ...approved, optionId: invalid })).toBeNull();
      expect(parsePermissionResolution({ ...resolved, optionId: invalid })).toBeNull();
    }
    expect(parsePermissionRequest({ ...offered, requestId: "a".repeat(MAX_PERMISSION_ID_LENGTH) })).not.toBeNull();
    expect(parsePermissionOption({ optionId: "id", name: "x".repeat(MAX_PERMISSION_OPTION_NAME_LENGTH), kind: "allow_once" })).not.toBeNull();
    expect(parsePermissionOption({ optionId: "id", name: "x".repeat(MAX_PERMISSION_OPTION_NAME_LENGTH + 1), kind: "allow_once" })).toBeNull();
  });

  test("rejects malformed options, duplicate optionIds, and invalid deadlines", () => {
    expect(parsePermissionRequest(null)).toBeNull();
    expect(parsePermissionRequest("permission_request")).toBeNull();
    expect(parsePermissionRequest({ ...offered, type: "chat" })).toBeNull();
    expect(parsePermissionRequest({ ...offered, options: [] })).toBeNull();
    expect(parsePermissionRequest({ ...offered, options: "yes" })).toBeNull();
    expect(parsePermissionRequest({ ...offered, options: [offered.options[0], offered.options[0]] })).toBeNull();
    expect(parsePermissionRequest({ ...offered, options: [{ ...offered.options[0], name: "" }] })).toBeNull();
    expect(parsePermissionRequest({ ...offered, options: [{ ...offered.options[0], kind: "allow" }] })).toBeNull();
    expect(parsePermissionRequest({
      ...offered,
      options: Array.from({ length: MAX_PERMISSION_OPTIONS + 1 }, (_, index) => ({
        optionId: "opt" + index, name: "Allow once", kind: "allow_once",
      })),
    })).toBeNull();

    for (const deadlineAt of [undefined, null, "1800000000000", NaN, Infinity, -Infinity, 0, -1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parsePermissionRequest({ ...offered, deadlineAt })).toBeNull();
    }
    // An expired request must still parse, so the broker can emit a timeout denial.
    expect(parsePermissionRequest({ ...offered, deadlineAt: 1 })).not.toBeNull();
    expect(parsePermissionRequest({ ...offered, deadlineAt: Number.MAX_SAFE_INTEGER })).not.toBeNull();
  });

  test("passes only bounded, credential-free display context to the phone", () => {
    const raw = {
      ...offered,
      displayContext: "   Run   tests   for user  ",
      token: "DO_NOT_TRANSMIT",
      toolCall: { input: { password: "VERY_PRIVATE" } },
    };
    const cleaned = parsePermissionRequest(raw);
    expect(cleaned?.displayContext).toBe("Run tests for user");
    expect(JSON.stringify(cleaned)).not.toContain("DO_NOT_TRANSMIT");
    expect(JSON.stringify(cleaned)).not.toContain("VERY_PRIVATE");

    for (const context of [
      "Authorization: Bearer abcdef", "token=abc123", "ghp_abcdefghi",
      "sk-abcdefghi", "Line one\nLine two",
      "x".repeat(MAX_PERMISSION_DISPLAY_CONTEXT_LENGTH + 1),
      "", null, { title: "Secret payload" },
    ]) {
      expect(sanitizePermissionDisplayContext(context)).toBeUndefined();
      const parsed = parsePermissionRequest({ ...offered, displayContext: context });
      expect(parsed).not.toBeNull();
      expect(parsed?.displayContext).toBeUndefined();
    }
    expect(sanitizePermissionDisplayContext("x".repeat(MAX_PERMISSION_DISPLAY_CONTEXT_LENGTH))).toHaveLength(MAX_PERMISSION_DISPLAY_CONTEXT_LENGTH);
  });

  test("rejects wrong request, turn, and nonoffered option even when option kind sounds safe", () => {
    expect(parsePermissionDecisionForRequest(approved, offered)).toEqual(approved);
    expect(parsePermissionDecisionForRequest({ ...approved, optionId: "no.once" }, offered)).toEqual({ ...approved, optionId: "no.once" });
    expect(parsePermissionDecisionForRequest({ ...approved, requestId: "other" }, offered)).toBeNull();
    expect(parsePermissionDecisionForRequest({ ...approved, turnId: "other" }, offered)).toBeNull();
    expect(parsePermissionDecisionForRequest({ ...approved, optionId: "allow_once" }, offered)).toBeNull();
    expect(parsePermissionDecisionForRequest({ ...approved, optionId: "yes" }, offered)).toBeNull();
    expect(parsePermissionDecisionForRequest(approved, { ...offered, options: [] })).toBeNull();
    expect(parsePermissionDecisionForRequest(null, offered)).toBeNull();
    expect(parsePermissionDecision({ ...approved, requestId: 42 })).toBeNull();
    expect(parsePermissionDecision({ ...approved, type: "permission_resolved" })).toBeNull();
  });

  test("parses denial/timeout without invented option and rejects ambiguous approvals", () => {
    const denied: PermissionResolution = {
      type: "permission_resolved", requestId: offered.requestId, turnId: offered.turnId,
      outcome: "denied", optionId: "no.once",
    };
    const timedOut: PermissionResolution = {
      type: "permission_resolved", requestId: offered.requestId, turnId: offered.turnId,
      outcome: "timeout",
    };
    expect(parsePermissionResolution(denied)).toEqual(denied);
    expect(parsePermissionResolution({ ...denied, optionId: undefined })).toEqual({
      type: "permission_resolved", requestId: offered.requestId, turnId: offered.turnId, outcome: "denied",
    });
    expect(parsePermissionResolution(timedOut)).toEqual(timedOut);
    expect(parsePermissionResolution({ ...resolved, optionId: undefined })).toBeNull();
    expect(parsePermissionResolution({ ...timedOut, optionId: "yes.once" })).toBeNull();
    expect(parsePermissionResolution({ ...timedOut, outcome: "selected" })).toBeNull();
    expect(parsePermissionResolution({ ...timedOut, turnId: "" })).toBeNull();
    expect(parsePermissionMessage({ type: "gate_decide", id: "unrelated" })).toBeNull();
  });

  test("capability negotiation is opt-in, old messages still parse, and unsupported peers fail closed", () => {
    const legacyHello = {
      type: "hello", version: PROTOCOL_VERSION, host: "mbp", cwd: "/repo",
      harnesses: [{ id: "omp", name: "OMP", available: true }],
    };
    const legacyChat = { type: "chat", id: "t1", harness: "omp", text: "hello" };
    expect(PROTOCOL_VERSION).toBe(1);
    expect(parseServerMessage(legacyHello)?.type).toBe("hello");
    expect(parseClientMessage(legacyChat)?.type).toBe("chat");
    expect(peerSupportsPermissionRequests(legacyHello)).toBe(false);
    expect(parsePermissionCapability(undefined)).toBeNull();
    expect(parsePermissionCapability({ permissionRequests: true })).toBeNull();
    expect(parsePermissionCapability({ permissionRequests: 2 })).toBeNull();
    expect(parsePermissionCapability(PERMISSION_CAPABILITY)).toEqual({ permissionRequests: 1 });
    expect(peerSupportsPermissionRequests({ ...legacyHello, capabilities: PERMISSION_CAPABILITY })).toBe(true);
    // Legacy server parser continues accepting the additive hello field unchanged.
    expect(parseServerMessage({ ...legacyHello, capabilities: PERMISSION_CAPABILITY })?.type).toBe("hello");

    const denial = unsupportedPeerPermissionResolution(offered);
    expect(denial).toEqual({
      type: "permission_resolved",
      requestId: "request-01",
      turnId: "turn:abc/123",
      outcome: "denied",
    });
    expect(parsePermissionResolution(denial)).toEqual(denial);
    expect(parseServerMessage({
      type: "status", id: offered.turnId, seq: 1, text: UNSUPPORTED_PERMISSION_MESSAGE,
    })?.type).toBe("status");
    expect(JSON.stringify(denial)).not.toContain("allowed");
  });
});
