import { expect, test } from "bun:test";
import {
  ACP_PERMISSION_TIMEOUT_MS,
  AcpPermissionAdapter,
  type AcpPermissionAdapterOptions,
  type AcpPermissionBrokerPort,
  type AcpPermissionBrokerRequest,
  type AcpPermissionResolution,
  type AcpPermissionResponse,
} from "./permission-adapter";

const SESSION = "session-owned";
const OPTIONS = [
  { optionId: "allow-once", name: "Approve", kind: "allow_once" },
  { optionId: "deny-once", name: "Reject", kind: "reject_once" },
];

function permission(id: unknown, options: unknown = OPTIONS, sessionId = SESSION): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/request_permission",
    params: { sessionId, options },
  };
}

function controlledBroker() {
  const requests: AcpPermissionBrokerRequest[] = [];
  const pending = new Map<string, (decision: unknown) => void>();
  const unregisters: string[] = [];
  const port: AcpPermissionBrokerPort = {
    register(request, settle) {
      requests.push(request);
      pending.set(request.requestId, settle);
      return () => {
        unregisters.push(request.requestId);
        pending.delete(request.requestId);
      };
    },
  };
  return { port, requests, pending, unregisters };
}

function fixture(broker?: AcpPermissionBrokerPort, overrides: Partial<AcpPermissionAdapterOptions> = {}) {
  const replies: AcpPermissionResponse[] = [];
  const resolutions: AcpPermissionResolution[] = [];
  const timers = new Map<() => void, number>();
  const adapter = new AcpPermissionAdapter({
    activeSessionId: () => SESSION,
    turnId: "turn-owned",
    principalId: "authenticated-controller",
    broker,
    send: reply => { replies.push(reply); },
    resolved: resolution => { resolutions.push(resolution); },
    schedule: (callback, delay) => {
      timers.set(callback, delay);
      return () => { timers.delete(callback); };
    },
    ...overrides,
  });
  const expire = () => {
    for (const callback of [...timers.keys()]) callback();
  };
  return { adapter, replies, resolutions, timers, expire };
}

const cancelled = { jsonrpc: "2.0", result: { outcome: { outcome: "cancelled" } } };

test("preserves both numeric and string JSON-RPC ids while uniquely correlating them", () => {
  const broker = controlledBroker();
  const f = fixture(broker.port);
  expect(f.adapter.receive(permission("7"))).toBe(true);
  expect(f.adapter.receive(permission(7))).toBe(true);
  expect(broker.requests).toHaveLength(2);
  const first = broker.requests[0];
  const second = broker.requests[1];
  expect(first?.requestId).not.toBe(second?.requestId);
  expect(first?.turnId).toBe("turn-owned");
  expect(first?.sessionId).toBe(SESSION);
  expect(first?.principalId).toBe("authenticated-controller");
  broker.pending.get(first?.requestId ?? "")?.({ outcome: "selected", optionId: "allow-once" });
  broker.pending.get(second?.requestId ?? "")?.({ outcome: "selected", optionId: "deny-once" });
  expect(f.replies).toEqual([
    { jsonrpc: "2.0", id: "7", result: { outcome: { outcome: "selected", optionId: "allow-once" } } },
    { jsonrpc: "2.0", id: 7, result: { outcome: { outcome: "selected", optionId: "deny-once" } } },
  ]);
  expect(f.resolutions.map(resolution => resolution.outcome)).toEqual(["allowed", "denied"]);
  expect(f.resolutions.map(resolution => resolution.optionId)).toEqual(["allow-once", "deny-once"]);
  expect(f.timers.size).toBe(0);
  expect(broker.unregisters).toHaveLength(2);
});

test("does not intercept filesystem, terminal or nonrequest frames", () => {
  const broker = controlledBroker();
  const f = fixture(broker.port);
  expect(f.adapter.receive({ jsonrpc: "2.0", id: "fs", method: "fs/read_text_file", params: { path: "/etc/passwd" } })).toBe(false);
  expect(f.adapter.receive({ jsonrpc: "2.0", id: "terminal", method: "terminal/create", params: { command: "cat secrets" } })).toBe(false);
  expect(f.adapter.receive({ jsonrpc: "2.0", method: "session/update", params: {} })).toBe(false);
  expect(f.adapter.receive({ jsonrpc: "2.0", id: "reply", result: {} })).toBe(false);
  expect(f.replies).toEqual([]);
  expect(f.resolutions).toEqual([]);
  expect(broker.requests).toEqual([]);
});

test("wrong session and missing active session deny without touching the broker", () => {
  const broker = controlledBroker();
  const f = fixture(broker.port);
  expect(f.adapter.receive(permission("wrong", OPTIONS, "session-another"))).toBe(true);
  const noSession = fixture(broker.port, { activeSessionId: () => undefined });
  expect(noSession.adapter.receive(permission("none"))).toBe(true);
  expect(f.replies).toEqual([{ ...cancelled, id: "wrong" }]);
  expect(noSession.replies).toEqual([{ ...cancelled, id: "none" }]);
  expect(f.resolutions[0]?.outcome).toBe("denied");
  expect(noSession.resolutions[0]?.outcome).toBe("denied");
  expect(broker.requests).toHaveLength(0);
});

test("exact reject option is selected and reported as denied, not cancelled or allowed", () => {
  const broker = controlledBroker();
  const f = fixture(broker.port);
  f.adapter.receive(permission(21));
  const requestId = broker.requests[0]?.requestId ?? "";
  broker.pending.get(requestId)?.({ outcome: "selected", optionId: "deny-once" });
  expect(f.replies).toEqual([{
    jsonrpc: "2.0", id: 21, result: { outcome: { outcome: "selected", optionId: "deny-once" } },
  }]);
  expect(f.resolutions[0]).toEqual({
    requestId, turnId: "turn-owned", sessionId: SESSION, outcome: "denied", optionId: "deny-once",
  });
});

test("unoffered, case-mismatched and malformed selections cancel safely", () => {
  const broker = controlledBroker();
  const f = fixture(broker.port);
  for (const id of [1, 2, 3]) f.adapter.receive(permission(id));
  for (const [index, decision] of [
    { outcome: "selected", optionId: "allow-other" },
    { outcome: "selected", optionId: "ALLOW-ONCE" },
    { outcome: "selected", optionId: 123 },
  ].entries()) {
    broker.pending.get(broker.requests[index]?.requestId ?? "")?.(decision);
  }
  expect(f.replies).toEqual([1, 2, 3].map(id => ({ ...cancelled, id })));
  expect(f.resolutions.map(resolution => resolution.outcome)).toEqual(["denied", "denied", "denied"]);
  expect(f.timers.size).toBe(0);
});

test("broker cancellation and broker-signalled timeout map to the ACP cancelled schema", () => {
  const broker = controlledBroker();
  const f = fixture(broker.port);
  f.adapter.receive(permission("cancel"));
  f.adapter.receive(permission("timeout"));
  broker.pending.get(broker.requests[0]?.requestId ?? "")?.({ outcome: "cancelled" });
  broker.pending.get(broker.requests[1]?.requestId ?? "")?.({ outcome: "timeout" });
  expect(f.replies).toEqual([{ ...cancelled, id: "cancel" }, { ...cancelled, id: "timeout" }]);
  expect(f.resolutions.map(resolution => resolution.outcome)).toEqual(["denied", "timeout"]);
});

test("adapter deadline cancels exactly once and ignores late approval and replay", () => {
  const broker = controlledBroker();
  const f = fixture(broker.port);
  f.adapter.receive(permission("deadline"));
  expect([...f.timers.values()]).toEqual([ACP_PERMISSION_TIMEOUT_MS]);
  const late = broker.pending.get(broker.requests[0]?.requestId ?? "");
  f.expire();
  late?.({ outcome: "selected", optionId: "allow-once" });
  expect(f.adapter.receive(permission("deadline"))).toBe(true);
  f.expire();
  expect(f.replies).toEqual([{ ...cancelled, id: "deadline" }]);
  expect(f.resolutions.map(resolution => resolution.outcome)).toEqual(["timeout"]);
  expect(broker.unregisters).toHaveLength(1);
  expect(f.timers.size).toBe(0);
});

test("no broker, no controller, and throwing broker all fail closed visibly", () => {
  const noBroker = fixture();
  noBroker.adapter.receive(permission("no-broker"));
  const noController = fixture({ register: () => null });
  noController.adapter.receive(permission("no-controller"));
  const throws = fixture({ register: () => { throw new Error("secret=never-report"); } });
  throws.adapter.receive(permission("throws"));
  function assertDenied(f: ReturnType<typeof fixture>, id: string) {
    expect(f.replies).toEqual([{ ...cancelled, id }]);
    expect(f.resolutions).toHaveLength(1);
    expect(f.resolutions[0]?.outcome).toBe("denied");
    expect(JSON.stringify(f.resolutions)).not.toContain("secret=never-report");
    expect(f.timers.size).toBe(0);
  }
  assertDenied(noBroker, "no-broker");
  assertDenied(noController, "no-controller");
  assertDenied(throws, "throws");
});

test("invalid envelopes, options and unsupported kinds never reach the broker", () => {
  const broker = controlledBroker();
  const f = fixture(broker.port);
  const malformed: unknown[] = [
    { jsonrpc: "1.0", id: "version", method: "session/request_permission", params: { sessionId: SESSION, options: OPTIONS } },
    { jsonrpc: "2.0", id: "missing", method: "session/request_permission" },
    permission("empty-options", []),
    permission("duplicated", [{ optionId: "x", kind: "allow_once" }, { optionId: "x", kind: "reject_once" }]),
    permission("unsupported", [{ optionId: "x", kind: "run_terminal" }]),
    permission("bad-kind", [{ optionId: "x", kind: null }]),
    permission("bad-id", [{ optionId: "", kind: "allow_once" }]),
    permission("bad-entry", ["allow_once"]),
  ];
  for (const item of malformed) expect(f.adapter.receive(item)).toBe(true);
  expect(f.replies).toHaveLength(malformed.length);
  for (const reply of f.replies) expect(reply.result.outcome).toEqual({ outcome: "cancelled" });
  expect(f.resolutions.every(resolution => resolution.outcome === "denied")).toBe(true);
  expect(broker.requests).toEqual([]);
});

test("invalid JSON-RPC request ids are not echoed", () => {
  const broker = controlledBroker();
  const f = fixture(broker.port);
  for (const invalid of [null, {}, [], 1.5, Number.MAX_SAFE_INTEGER + 1, "", " ctrl\n"]) {
    expect(f.adapter.receive(permission(invalid))).toBe(true);
  }
  expect(f.replies).toEqual([]);
  expect(f.resolutions).toHaveLength(7);
  expect(broker.requests).toEqual([]);
});

test("broker sees only canonical choices and trusted identity, not tool data or secrets", () => {
  const broker = controlledBroker();
  const f = fixture(broker.port);
  const envelope = {
    jsonrpc: "2.0",
    id: "rpc-private",
    method: "session/request_permission",
    params: {
      sessionId: SESSION,
      principalId: "untrusted-agent-principal",
      turnId: "untrusted-agent-turn",
      toolCall: { title: "secret-payroll", rawInput: { api_key: "SECRET_CREDENTIAL_VALUE" } },
      options: [
        { optionId: "ok", kind: "allow_always", name: "SECRET_CREDENTIAL_VALUE" },
        { optionId: "no", kind: "reject_always", name: "SECRET_CREDENTIAL_VALUE" },
      ],
    },
  };
  expect(f.adapter.receive(envelope)).toBe(true);
  expect(broker.requests).toHaveLength(1);
  expect(broker.requests[0]).toEqual({
    requestId: broker.requests[0]?.requestId,
    principalId: "authenticated-controller",
    turnId: "turn-owned",
    sessionId: SESSION,
    options: [
      { optionId: "ok", kind: "allow_always", name: "Always allow" },
      { optionId: "no", kind: "reject_always", name: "Always deny" },
    ],
  });
  expect(JSON.stringify(broker.requests)).not.toContain("SECRET_CREDENTIAL_VALUE");
  expect(JSON.stringify(broker.requests)).not.toContain("secret-payroll");
  expect(JSON.stringify(broker.requests)).not.toContain("untrusted-agent");
  expect(broker.requests[0]?.requestId).not.toContain("rpc-private");
  broker.pending.get(broker.requests[0]?.requestId ?? "")?.({ outcome: "selected", optionId: "ok" });
  expect(f.replies[0]).toEqual({
    jsonrpc: "2.0", id: "rpc-private", result: { outcome: { outcome: "selected", optionId: "ok" } },
  });
});

test("cleanup cancels all concurrent pending requests, releases subscriptions and is idempotent", () => {
  const broker = controlledBroker();
  const f = fixture(broker.port);
  f.adapter.receive(permission(1));
  f.adapter.receive(permission(2));
  const callbacks = [...broker.pending.values()];
  expect(f.timers.size).toBe(2);
  f.adapter.cleanup();
  f.adapter.cleanup();
  for (const callback of callbacks) callback({ outcome: "selected", optionId: "allow-once" });
  expect(f.replies).toEqual([{ ...cancelled, id: 1 }, { ...cancelled, id: 2 }]);
  expect(f.resolutions.map(resolution => resolution.outcome)).toEqual(["denied", "denied"]);
  expect(broker.unregisters).toHaveLength(2);
  expect(f.timers.size).toBe(0);
  f.adapter.receive(permission(3));
  expect(f.replies.at(-1)).toEqual({ ...cancelled, id: 3 });
  expect(broker.requests).toHaveLength(2);
});

test("synchronous broker decisions still unregister exactly once", () => {
  let unregistered = 0;
  const f = fixture({
    register(_request, settle) {
      settle({ outcome: "selected", optionId: "allow-once" });
      return () => { unregistered++; };
    },
  });
  f.adapter.receive(permission("sync"));
  expect(f.replies).toEqual([{
    jsonrpc: "2.0", id: "sync", result: { outcome: { outcome: "selected", optionId: "allow-once" } },
  }]);
  expect(f.timers.size).toBe(0);
  expect(unregistered).toBe(1);
});

test("a broker that calls back but reports no controller cannot approve", () => {
  const f = fixture({
    register(_request, settle) {
      settle({ outcome: "selected", optionId: "allow-once" });
      return null;
    },
  });
  f.adapter.receive(permission("no-controller-sync"));
  expect(f.replies).toEqual([{ ...cancelled, id: "no-controller-sync" }]);
  expect(f.resolutions[0]?.outcome).toBe("denied");
  expect(f.timers.size).toBe(0);
});

test("broker throwing after a synchronous offer still fails closed", () => {
  const f = fixture({
    register(_request, settle) {
      settle({ outcome: "selected", optionId: "allow-once" });
      throw new Error("failed-to-register");
    },
  });
  f.adapter.receive(permission("throws-after-callback"));
  expect(f.replies).toEqual([{ ...cancelled, id: "throws-after-callback" }]);
  expect(f.resolutions[0]?.outcome).toBe("denied");
});

test("session switching while a decision is pending invalidates late approvals", () => {
  let current = SESSION;
  const broker = controlledBroker();
  const f = fixture(broker.port, { activeSessionId: () => current });
  f.adapter.receive(permission("session-changes"));
  current = "other-owned-session";
  broker.pending.get(broker.requests[0]?.requestId ?? "")?.({ outcome: "selected", optionId: "allow-once" });
  expect(f.replies).toEqual([{ ...cancelled, id: "session-changes" }]);
  expect(f.resolutions[0]?.outcome).toBe("denied");
  expect(f.timers.size).toBe(0);
});

test("a broken response writer cannot create a second approval or report successful delivery", () => {
  const broker = controlledBroker();
  let attempts = 0;
  const f = fixture(broker.port, {
    send: () => { attempts++; throw new Error("no transport"); },
  });
  f.adapter.receive(permission(42));
  const late = broker.pending.get(broker.requests[0]?.requestId ?? "");
  late?.({ outcome: "selected", optionId: "allow-once" });
  late?.({ outcome: "selected", optionId: "deny-once" });
  f.expire();
  expect(attempts).toBe(1);
  expect(f.resolutions).toHaveLength(1);
  expect(f.resolutions[0]?.outcome).toBe("denied");
  expect(f.resolutions[0]?.optionId).toBeUndefined();
});

test("timeouts are capped below the ACP turn limit even if misconfigured", () => {
  const broker = controlledBroker();
  const f = fixture(broker.port, { timeoutMs: 500_000 });
  f.adapter.receive(permission("cap"));
  expect([...f.timers.values()]).toEqual([60_000]);
  f.adapter.cleanup();
});
