import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReplyPart } from "../../shared/protocol";
import { sendViaZ0Bridge, type SendOptions } from "./hermes-session-send";

const scratch = mkdtempSync(join(tmpdir(), "dash-hermes-send-"));
const credentialFile = join(scratch, "credential.json");
const TOKEN = "z0bc.cred_" + "a".repeat(16) + "." + "Z".repeat(43);
const baseEnv = {
  DASH_Z0BRIDGE_URL: "http://127.0.0.1:4787",
  DASH_Z0BRIDGE_SEND_CREDENTIAL_FILE: credentialFile,
};
beforeAll(() => {
  writeFileSync(credentialFile, JSON.stringify({
    app: "dash", url: "http://127.0.0.1:4787", credential: TOKEN,
    scopes: ["hermes:session.send"],
  }), { mode: 0o600 });
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type HttpRecord = { path: string; method: string; headers: Headers; body: unknown };
type TestOptions = {
  healthy?: boolean;
  admissionStatus?: number;
  admissionCode?: string;
  admission?: unknown;
  postError?: boolean;
  streams?: Response[];
};

function frame(seq: number, type: string, values: Record<string, unknown> = {}): Record<string, unknown> {
  return { seq, type, ...values };
}

function stream(events: Record<string, unknown>[]): Response {
  const text = events.map(event => "id: " + event.seq + "\r\nevent: " + event.type +
    "\r\ndata: " + JSON.stringify(event) + "\r\n\r\n").join("");
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Force a multi-byte and CRLF boundary through the incremental SSE reader.
      for (let at = 0; at < bytes.length; at += 7) controller.enqueue(bytes.slice(at, at + 7));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

const expected = [
  frame(1, "status", { text: "starting" }),
  frame(2, "tool", { toolCallId: "call_1", title: "terminal", status: "in_progress" }),
  frame(3, "tool", { toolCallId: "call_1", title: "terminal", status: "completed" }),
  frame(4, "delta", { text: "po" }),
  frame(5, "delta", { text: "ng" }),
  frame(6, "done", { stopReason: "end_turn" }),
];

function fakeNetwork(options: TestOptions = {}) {
  const seen: HttpRecord[] = [];
  let read = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const record: HttpRecord = {
      path: url.pathname + url.search,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    seen.push(record);
    if (url.pathname === "/v1/health") {
      if (options.healthy === false) throw new Error("connection refused");
      return Response.json({ name: "z0bridge", ok: true, version: "0.1.0", api: "v1" });
    }
    if (url.pathname.endsWith("/send")) {
      if (options.postError) throw new Error("socket reset after admission");
      const status = options.admissionStatus ?? 202;
      if (status !== 202) return Response.json({ error: { code: options.admissionCode ?? "insufficient_scope", message: "Denied" } }, { status });
      return Response.json(options.admission ?? {
        sendId: "send_1", mode: record.body && typeof record.body === "object" && "mode" in record.body ? record.body.mode : "",
        accepted: record.body && typeof record.body === "object" && "mode" in record.body && record.body.mode === "steer" ? "steered" : "queued",
        eventsUrl: "/v1/sends/send_1/events",
      }, { status: 202 });
    }
    if (url.pathname.endsWith("/events")) {
      const custom = options.streams?.[read];
      read += 1;
      return custom ?? stream(expected);
    }
    return Response.json({ error: { code: "not_found" } }, { status: 404 });
  };
  return { seen, fetcher };
}

function sink() {
  const result = { delta: "", statuses: [] as string[], parts: [] as ReplyPart[], deliveries: [] as string[] };
  return {
    result,
    value: {
      delta: (text: string) => { result.delta += text; },
      status: (text: string) => { result.statuses.push(text); },
      part: (part: ReplyPart) => { result.parts.push(part); },
    },
    delivery: (mode: string, explanation: string) => { result.deliveries.push(mode + ": " + explanation); },
  };
}

function sendOptions(net: ReturnType<typeof fakeNetwork>, events = sink()): SendOptions {
  return {
    profile: "clean", sessionId: "local-123", submissionId: "dash-turn:123", mode: "next_turn",
    text: "reply with just pong", sink: events.value,
    delivery: events.delivery, env: baseEnv, fetch: net.fetcher,
  };
}

test("unconfigured, disabled or offline daemon alone allows native fallback before POST", async () => {
  const n = fakeNetwork();
  expect(await sendViaZ0Bridge({ ...sendOptions(n), env: {} })).toBeUndefined();
  expect(await sendViaZ0Bridge({ ...sendOptions(n), env: { ...baseEnv, DASH_Z0BRIDGE: "0" } })).toBeUndefined();
  expect(n.seen).toHaveLength(0);
  const offline = fakeNetwork({ healthy: false });
  expect(await sendViaZ0Bridge(sendOptions(offline))).toBeUndefined();
  expect(offline.seen.map(request => request.path)).toEqual(["/v1/health"]);
});

test("next_turn uses a scoped credential, stable submissionId and the send SSE (not ACP /turns)", async () => {
  const n = fakeNetwork();
  const events = sink();
  const outcome = await sendViaZ0Bridge(sendOptions(n, events));
  expect(outcome).toEqual({ text: "pong", sessionId: "local-123", exitCode: 0 });
  expect(n.seen.map(request => request.path)).toEqual([
    "/v1/health", "/v1/sessions/hermes/clean/local-123/send", "/v1/sends/send_1/events",
  ]);
  expect(n.seen[1]?.method).toBe("POST");
  expect(n.seen[1]?.body).toEqual({
    text: "reply with just pong", mode: "next_turn", submissionId: "dash-turn:123",
  });
  expect(n.seen[1]?.headers.get("authorization")).toBe("Bearer " + TOKEN);
  expect(n.seen[2]?.headers.get("authorization")).toBe("Bearer " + TOKEN);
  expect(events.result.delta).toBe("pong");
  expect(events.result.deliveries.map(value => value.split(":")[0])).toEqual(["queued", "started"]);
  expect(events.result.parts.map(part => part.kind)).toEqual(["tool_start", "tool_finish"]);
  expect(events.result.statuses).toContain("Running terminal");
});

test("steer is explicit, owns no second reply and does not queue a new turn", async () => {
  const n = fakeNetwork({ streams: [stream([frame(1, "status", { text: "steered" }), frame(2, "done", { stopReason: "end_turn" })])] });
  const events = sink();
  const outcome = await sendViaZ0Bridge({ ...sendOptions(n, events), mode: "steer" });
  expect(outcome).toEqual({ text: "", sessionId: "local-123", exitCode: 0 });
  expect(n.seen[1]?.body).toEqual({
    text: "reply with just pong", mode: "steer", submissionId: "dash-turn:123",
  });
  expect(events.result.delta).toBe("");
  expect(events.result.deliveries).toHaveLength(1);
  expect(events.result.deliveries[0]).toContain("Steered the running Hermes turn");
});

test("403 revoked send scope and 409 idle steer are final; no CLI/ACP fallback", async () => {
  for (const [status, code] of [[403, "insufficient_scope"], [409, "no_running_turn"]] ) {
    const n = fakeNetwork({ admissionStatus: status, admissionCode: code });
    await expect(sendViaZ0Bridge({ ...sendOptions(n), mode: "steer" }))
      .rejects.toThrow("HTTP " + status + ", " + code);
    expect(n.seen.filter(request => request.method === "POST")).toHaveLength(1);
    expect(n.seen.every(request => !request.path.includes("/turns"))).toBe(true);
  }
});

test("a POST network failure is ambiguous, not permission to resubmit on hermes-live", async () => {
  const n = fakeNetwork({ postError: true });
  await expect(sendViaZ0Bridge(sendOptions(n))).rejects.toThrow("outcome unknown after POST");
  expect(n.seen.filter(request => request.method === "POST")).toHaveLength(1);
});

test("reconnects only SSE with a stable sendId and exact replay cursor", async () => {
  const streams = [
    stream([frame(1, "status", { text: "running" }), frame(2, "delta", { text: "po" })]),
    stream([frame(2, "delta", { text: "po" }), frame(3, "delta", { text: "ng" }), frame(4, "done", { stopReason: "end_turn" })]),
  ];
  const n = fakeNetwork({ streams });
  const events = sink();
  expect(await sendViaZ0Bridge(sendOptions(n, events))).toEqual({ text: "pong", sessionId: "local-123", exitCode: 0 });
  expect(events.result.delta).toBe("pong");
  expect(n.seen.filter(request => request.method === "POST")).toHaveLength(1);
  expect(n.seen.filter(request => request.path.includes("/events")).map(request => request.path)).toEqual([
    "/v1/sends/send_1/events", "/v1/sends/send_1/events?after=2",
  ]);
  expect(n.seen.at(-1)?.headers.get("last-event-id")).toBe("2");
});

test("stream gaps, malformed terminal receipts and unexpected origin never report success", async () => {
  const variants = [
    { streams: [stream([frame(1, "delta", { text: "po" }), frame(3, "done", { stopReason: "end_turn" })])] },
    { streams: [stream([frame(1, "done", { stopReason: "cancelled" })])] },
    { streams: [stream([frame(1, "done", { stopReason: "end_turn" })])] },
    { admission: { sendId: "send_1", accepted: "queued", mode: "next_turn", eventsUrl: "http://evil.example/events" } },
  ];
  for (const variant of variants) {
    const n = fakeNetwork(variant);
    await expect(sendViaZ0Bridge(sendOptions(n))).rejects.toThrow();
    expect(n.seen.filter(request => request.method === "POST")).toHaveLength(1);
  }
});

test("SSE end without done never invents completion or retries POST", async () => {
  const n = fakeNetwork({ streams: [
    stream([frame(1, "delta", { text: "po" })]),
    stream([]),
    stream([]),
  ] });
  await expect(sendViaZ0Bridge(sendOptions(n))).rejects.toThrow("without a final receipt");
  expect(n.seen.filter(request => request.method === "POST")).toHaveLength(1);
  expect(n.seen.filter(request => request.path.includes("/events"))).toHaveLength(3);
});

test("steer cannot forward foreign turn deltas or tool details as its own output", async () => {
  const n = fakeNetwork({ streams: [stream([frame(1, "delta", { text: "other viewer private text" })])] });
  const events = sink();
  await expect(sendViaZ0Bridge({ ...sendOptions(n, events), mode: "steer" })).rejects.toThrow("foreign turn text");
  expect(events.result.delta).toBe("");
  expect(events.result.parts).toHaveLength(0);
  expect(n.seen.filter(request => request.method === "POST")).toHaveLength(1);
});

test("credential permissions and invalid request values are rejected before POST", async () => {
  const n = fakeNetwork();
  const inputs: Array<Partial<SendOptions>> = [
    { mode: "next_turn", submissionId: "../escape" },
    { text: "/undo" },
    { sessionId: " " },
    { profile: "bad/profile" },
    { text: " " },
  ];
  for (const input of inputs) {
    await expect(sendViaZ0Bridge({ ...sendOptions(n), ...input })).rejects.toThrow("Invalid Hermes send");
  }
  expect(n.seen).toHaveLength(0);
  chmodSync(credentialFile, 0o644);
  try {
    await expect(sendViaZ0Bridge(sendOptions(n))).rejects.toThrow("Missing private Dash credential");
    expect(n.seen).toHaveLength(0);
  } finally {
    chmodSync(credentialFile, 0o600);
  }
});

test("only the enrolled hermes:session.send scope authorizes this client, never an owner-token fallback", async () => {
  const n = fakeNetwork();
  const wrongFile = join(scratch, "wrong.json");
  writeFileSync(wrongFile, JSON.stringify({ app: "dash", url: "http://127.0.0.1:4787", credential: TOKEN, scopes: ["hermes:turns"] }), { mode: 0o600 });
  await expect(sendViaZ0Bridge({
    ...sendOptions(n), env: { ...baseEnv, DASH_Z0BRIDGE_SEND_CREDENTIAL_FILE: wrongFile },
  })).rejects.toThrow("hermes:session.send");
  expect(n.seen).toHaveLength(0);
  await expect(sendViaZ0Bridge({
    ...sendOptions(n), env: { ...baseEnv, DASH_Z0BRIDGE_URL: "http://192.168.1.2:4787" },
  })).rejects.toThrow("loopback HTTP");
  expect(n.seen).toHaveLength(0);
});
