import { expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { AcpClient } from "./client";
import {
  AcpPermissionAdapter,
  type AcpPermissionBrokerPort,
  type AcpPermissionResolution,
} from "./permission-adapter";
import {
  PERMISSION_TIMEOUT_MS,
  PermissionBroker,
  type PermissionNotice,
  type PermissionScheduler,
  type PermissionScope,
} from "../permission-broker";

const SESSION = "fixture-permission-session";
const PRINCIPAL = "authenticated-owner";
const TURN = "turn-139";
const FIXTURE = join(import.meta.dir, "fixtures/permission-lane-agent.ts");

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Frame = Record<string, unknown>;
type Waiter = {
  matches: (frame: Frame) => boolean;
  resolve: (frame: Frame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Only test transport mechanics: permission decisions come from the real modules. */
class StdioAgent {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly backlog: Frame[] = [];
  private readonly waiters = new Set<Waiter>();
  private readonly exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private ended = false;
  readonly received: Frame[] = [];

  constructor(mode = "permission") {
    this.child = spawn(process.execPath, [FIXTURE, mode], {
      cwd: import.meta.dir,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdin.on("error", () => { /* Expected if a malformed fixture exits early. */ });
    this.child.stderr.resume();
    this.exit = new Promise(resolve => {
      this.child.once("close", (code, signal) => {
        this.ended = true;
        for (const waiter of this.waiters) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error("Permission fixture closed before expected JSON-RPC frame"));
        }
        this.waiters.clear();
        resolve({ code, signal });
      });
    });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on("line", line => {
      let value: unknown;
      try { value = JSON.parse(line); }
      catch { return this.rejectAll(new Error("Fixture emitted invalid JSON")); }
      if (!record(value) || value.jsonrpc !== "2.0") {
        return this.rejectAll(new Error("Fixture emitted invalid JSON-RPC"));
      }
      this.received.push(value);
      for (const waiter of this.waiters) {
        if (!waiter.matches(value)) continue;
        this.waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(value);
        return;
      }
      this.backlog.push(value);
    });
  }

  private rejectAll(error: Error): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  send(frame: unknown): void {
    if (this.ended) throw new Error("Cannot write to a closed permission fixture");
    this.child.stdin.write(JSON.stringify(frame) + "\n");
  }

  take(matches: (frame: Frame) => boolean, timeoutMs = 2500): Promise<Frame> {
    const index = this.backlog.findIndex(matches);
    if (index >= 0) {
      const matching = this.backlog.splice(index, 1)[0];
      if (matching) return Promise.resolve(matching);
    }
    if (this.ended) return Promise.reject(new Error("Permission fixture exited before frame"));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        matches, resolve, reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error("Timed out waiting for real fixture frame"));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  async begin(): Promise<Frame> {
    this.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: 1, clientInfo: { name: "dash-test", version: "1" }, clientCapabilities: {},
    } });
    const initialized = await this.take(frame => frame.id === 1);
    expect(record(initialized.result) && initialized.result.protocolVersion).toBe(1);
    this.send({ jsonrpc: "2.0", id: 2, method: "session/new", params: {
      cwd: import.meta.dir, mcpServers: [],
    } });
    const opened = await this.take(frame => frame.id === 2);
    expect(record(opened.result) && opened.result.sessionId).toBe(SESSION);
    this.send({ jsonrpc: "2.0", id: 3, method: "session/prompt", params: {
      sessionId: SESSION, prompt: [{ type: "text", text: "permission test" }],
    } });
    return this.take(frame => frame.method === "session/request_permission");
  }

  async textAndFinish(): Promise<string> {
    const update = await this.take(frame => frame.method === "session/update");
    const params = record(update.params) ? update.params : null;
    const content = params && record(params.update) && record(params.update.content)
      ? params.update.content : null;
    const text = content && typeof content.text === "string" ? content.text : "";
    const finished = await this.take(frame => frame.id === 3);
    expect(record(finished.result) && finished.result.stopReason).toBe("end_turn");
    return text;
  }

  async waitExit(timeoutMs = 2500): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.exit,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Permission fixture failed to exit")), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private kill(signal: NodeJS.Signals): void {
    if (!this.child.pid) return;
    try { process.kill(-this.child.pid, signal); }
    catch { if (!this.ended) this.child.kill(signal); }
  }

  async close(): Promise<void> {
    if (!this.ended) {
      this.child.stdin.end();
      this.kill("SIGTERM");
      let grace: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.exit,
        new Promise<void>(resolve => { grace = setTimeout(resolve, 200); }),
      ]);
      clearTimeout(grace);
      if (!this.ended) this.kill("SIGKILL");
    }
    await this.waitExit();
  }
}

/** Deterministic clock: no 60-second sleep, still executes real timeout callbacks. */
class PermissionClock implements PermissionScheduler {
  private time = 1_900_000_000_000;
  private next = 0;
  private readonly tasks = new Map<number, { when: number; run: () => void }>();
  now(): number { return this.time; }
  schedule(run: () => void, delayMs: number): () => void {
    const id = ++this.next;
    this.tasks.set(id, { when: this.time + delayMs, run });
    return () => { this.tasks.delete(id); };
  }
  advance(ms: number): void {
    const until = this.time + ms;
    for (;;) {
      const next = [...this.tasks].filter(([, task]) => task.when <= until)
        .sort((a, b) => a[1].when - b[1].when || a[0] - b[0])[0];
      if (!next) break;
      const [id, task] = next;
      this.tasks.delete(id);
      this.time = task.when;
      task.run();
    }
    this.time = until;
  }
}

type Notified = { principal: string; notice: PermissionNotice };

/** The small structural bridge between #138's port and #133's keyed broker. */
function brokerPort(broker: PermissionBroker, notices: Notified[]): AcpPermissionBrokerPort {
  return {
    register(request, settle) {
      const scope: PermissionScope = {
        authenticatedPrincipal: request.principalId,
        turnId: request.turnId,
        requestId: request.requestId,
        sessionId: request.sessionId,
      };
      const registered = broker.register({
        ...scope,
        options: request.options,
        respond: response => settle(response.outcome),
        notify: (principal, notice) => { notices.push({ principal, notice }); },
      });
      return registered ? () => { broker.cancel(scope); } : null;
    },
  };
}

function makeStack(agent: StdioAgent, clock: PermissionClock) {
  const broker = new PermissionBroker(clock);
  const notices: Notified[] = [];
  const resolutions: AcpPermissionResolution[] = [];
  const adapter = new AcpPermissionAdapter({
    activeSessionId: () => SESSION,
    principalId: PRINCIPAL,
    turnId: TURN,
    broker: brokerPort(broker, notices),
    send: response => agent.send(response),
    resolved: value => resolutions.push(value),
    timeoutMs: 50,
    schedule: (callback, ms) => clock.schedule(callback, ms),
  });
  return { broker, notices, resolutions, adapter };
}

function offeredScope(notices: Notified[]): PermissionScope {
  const request = notices.find(entry => entry.notice.type === "permission_request");
  if (!request || request.notice.type !== "permission_request") {
    throw new Error("The authenticated broker did not publish a permission request");
  }
  expect(request.principal).toBe(PRINCIPAL);
  expect(request.notice.options).toEqual([
    { optionId: "yes", name: "Allow once", kind: "allow_once" },
    { optionId: "no", name: "Deny once", kind: "reject_once" },
  ]);
  return {
    authenticatedPrincipal: PRINCIPAL, turnId: TURN,
    requestId: request.notice.requestId, sessionId: SESSION,
  };
}

test.each([
  { choice: "yes", expected: "ALLOWED", resolution: "allowed" },
  { choice: "no", expected: "DENIED", resolution: "denied" },
])("real stdio adapter + broker selects $choice exactly once ($resolution)", async ({ choice, expected, resolution }) => {
  const agent = new StdioAgent();
  const clock = new PermissionClock();
  const stack = makeStack(agent, clock);
  try {
    const request = await agent.begin();
    expect(request.id).toBe("fixture-permission-request");
    expect(record(request.params) && request.params.options).toEqual([
      { optionId: "yes", name: "Allow once", kind: "allow_once" },
      { optionId: "no", name: "Reject once", kind: "reject_once" },
    ]);
    expect(stack.adapter.receive(request)).toBe(true);
    const scope = offeredScope(stack.notices);
    expect(stack.broker.decide({ ...scope, optionId: choice })).toBe(true);
    expect(await agent.textAndFinish()).toBe(expected);
    expect(stack.resolutions.map(value => value.outcome)).toEqual([resolution]);
    expect(stack.broker.decide({ ...scope, optionId: choice })).toBe(false);
    expect(stack.broker.pendingCount(PRINCIPAL)).toBe(0);
    expect(stack.notices.filter(entry => entry.notice.type === "permission_resolved")).toHaveLength(1);
  } finally {
    stack.adapter.cleanup();
    stack.broker.dispose();
    await agent.close();
  }
});

test("real stdio timeout denies; wrong and late decisions cannot allow", async () => {
  const agent = new StdioAgent();
  const clock = new PermissionClock();
  const stack = makeStack(agent, clock);
  try {
    expect(PERMISSION_TIMEOUT_MS).toBe(60_000);
    const request = await agent.begin();
    expect(stack.adapter.receive(request)).toBe(true);
    const scope = offeredScope(stack.notices);
    expect(stack.broker.decide({ ...scope, optionId: "not-offered" })).toBe(false);
    clock.advance(49);
    expect(stack.resolutions).toHaveLength(0);
    clock.advance(1);
    expect(await agent.textAndFinish()).toBe("DENIED");
    expect(stack.resolutions.map(value => value.outcome)).toEqual(["timeout"]);
    expect(stack.broker.decide({ ...scope, optionId: "yes" })).toBe(false);
    expect(stack.broker.pendingCount(PRINCIPAL)).toBe(0);
  } finally {
    stack.adapter.cleanup();
    stack.broker.dispose();
    await agent.close();
  }
});

test("cancellation settles the live stdio permission and cleans up the child", async () => {
  const agent = new StdioAgent();
  const stack = makeStack(agent, new PermissionClock());
  try {
    const request = await agent.begin();
    expect(stack.adapter.receive(request)).toBe(true);
    stack.adapter.cleanup();
    expect(await agent.textAndFinish()).toBe("DENIED");
    expect(stack.resolutions.map(value => value.outcome)).toEqual(["denied"]);
    expect(stack.broker.pendingCount(PRINCIPAL)).toBe(0);
  } finally {
    stack.adapter.cleanup();
    stack.broker.dispose();
    await agent.close();
  }
});

test("fixture rejects malformed option responses instead of emitting ALLOWED", async () => {
  const agent = new StdioAgent();
  try {
    const request = await agent.begin();
    agent.send({ jsonrpc: "2.0", id: request.id, result: {
      outcome: { outcome: "selected", optionId: "not-offered" },
    } });
    expect((await agent.waitExit()).code).toBe(13);
    expect(agent.received.some(frame => frame.method === "session/update")).toBe(false);
  } finally {
    await agent.close();
  }
});

test("fixture rejects a late approval after cancellation", async () => {
  const agent = new StdioAgent();
  try {
    const request = await agent.begin();
    agent.send({ jsonrpc: "2.0", id: request.id, result: { outcome: { outcome: "cancelled" } } });
    expect(await agent.textAndFinish()).toBe("DENIED");
    agent.send({ jsonrpc: "2.0", id: request.id, result: {
      outcome: { outcome: "selected", optionId: "yes" },
    } });
    expect((await agent.waitExit()).code).toBe(13);
    expect(agent.received.some(frame => record(frame.params) &&
      record(frame.params.update) && record(frame.params.update.content) &&
      frame.params.update.content.text === "ALLOWED")).toBe(false);
  } finally {
    await agent.close();
  }
});

test("unavailable filesystem remains denied by the existing ACP client over real stdio", async () => {
  const text: string[] = [];
  const client = new AcpClient({
    command: [process.execPath, FIXTURE, "fs"],
    cwd: import.meta.dir,
    timeoutMs: 2500,
    sink: {
      session() {}, status() {}, error() {},
      delta: value => text.push(value),
    },
  });
  try {
    expect(await client.turn({ text: "fs should remain unavailable", cwd: import.meta.dir })).toBe("end_turn");
    expect(text).toEqual(["FS_UNAVAILABLE"]);
  } finally {
    await client.close();
  }
  expect(client.exited).toBe(true);
});

test.each(["no-controller", "wrong-session"])("%s is visibly denied over real stdio", async mode => {
  const agent = new StdioAgent();
  const clock = new PermissionClock();
  const broker = new PermissionBroker(clock);
  const notices: Notified[] = [];
  const resolutions: AcpPermissionResolution[] = [];
  const adapter = new AcpPermissionAdapter({
    activeSessionId: () => SESSION,
    principalId: PRINCIPAL,
    turnId: TURN,
    ...(mode === "no-controller" ? {} : { broker: brokerPort(broker, notices) }),
    send: response => agent.send(response),
    resolved: value => resolutions.push(value),
    timeoutMs: 50,
    schedule: (callback, ms) => clock.schedule(callback, ms),
  });
  try {
    const incoming = await agent.begin();
    const frame = mode === "wrong-session"
      ? { ...incoming, params: {
          sessionId: "another-session",
          options: record(incoming.params) ? incoming.params.options : undefined,
        } }
      : incoming;
    expect(adapter.receive(frame)).toBe(true);
    expect(await agent.textAndFinish()).toBe("DENIED");
    expect(resolutions.map(value => value.outcome)).toEqual(["denied"]);
    expect(notices).toHaveLength(0);
    expect(broker.pendingCount(PRINCIPAL)).toBe(0);
  } finally {
    adapter.cleanup();
    broker.dispose();
    await agent.close();
  }
});

test("real session/cancel ends a pending fixture prompt without allowing it", async () => {
  const agent = new StdioAgent();
  try {
    await agent.begin();
    agent.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: SESSION } });
    const cancelled = await agent.take(frame => frame.id === 3);
    expect(record(cancelled.result) && cancelled.result.stopReason).toBe("cancelled");
    expect(agent.received.some(frame => frame.method === "session/update")).toBe(false);
  } finally {
    await agent.close();
  }
});

test("fixture exits nonzero for structurally malformed permission results", async () => {
  const agent = new StdioAgent();
  try {
    const request = await agent.begin();
    agent.send({ jsonrpc: "2.0", id: request.id, result: { outcome: { outcome: "selected" } } });
    expect((await agent.waitExit()).code).toBe(13);
    expect(agent.received.some(frame => frame.method === "session/update")).toBe(false);
  } finally {
    await agent.close();
  }
});
