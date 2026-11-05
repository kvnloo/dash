import { expect, test } from "bun:test";
import { liveArgv, parseLiveLine, sendIntoLiveSession, type LiveSpawn } from "./hermes-live";

function fakeSpawn(lines: string[], options: { exit?: number; stderr?: string } = {}) {
  const seen: { argv?: string[]; env?: Record<string, string | undefined>; stdin: string; killed: (string | number | undefined)[] } = { stdin: "", killed: [] };
  const spawn: LiveSpawn = (argv, opts) => {
    seen.argv = argv; seen.env = opts.env;
    const body = (text: string) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
    return {
      stdin: { write: (text: string) => { seen.stdin += text; }, end: () => undefined },
      stdout: body(lines.map(l => `${l}\n`).join("")),
      stderr: body(options.stderr ?? ""),
      exited: Promise.resolve(options.exit ?? 0),
      kill: signal => { seen.killed.push(signal); },
    };
  };
  return { spawn, seen };
}

function sink() {
  const out = { deltas: [] as string[], statuses: [] as string[] };
  return { out, sink: { delta: (t: string) => out.deltas.push(t), status: (t: string) => out.statuses.push(t) } };
}

test("argv is Hermes's own one-shot gateway client; the text never rides argv", () => {
  expect(liveArgv("/bin/hermes", "local-1")).toEqual(["/bin/hermes", "chat", "--resume", "local-1", "--query-file", "-", "--format", "stream-json"]);
});

test("stream-json lines map to deltas, tool status and one result", () => {
  expect(parseLiveLine('{"type":"text","text":"po"}')).toEqual({ kind: "text", text: "po" });
  expect(parseLiveLine('{"type":"tool_use","name":"terminal"}')).toEqual({ kind: "tool", name: "terminal" });
  expect(parseLiveLine('{"type":"tool_result","name":"terminal"}')).toEqual({ kind: "tool-done", name: "terminal" });
  expect(parseLiveLine('{"type":"result","exit_code":0,"text":"pong","session_id":"local-1"}')).toEqual({ kind: "result", exitCode: 0, text: "pong", sessionId: "local-1" });
  expect(parseLiveLine("not json")).toEqual({ kind: "other" });
  expect(parseLiveLine('{"type":"system","subtype":"init"}')).toEqual({ kind: "other" });
});

test("a live send streams its own reply, uses the profile home and drops an inherited remote gateway URL", async () => {
  const { spawn, seen } = fakeSpawn(['{"type":"system","subtype":"init"}', '{"type":"tool_use","name":"terminal"}', '{"type":"tool_result"}', '{"type":"text","text":"po"}', '{"type":"text","text":"ng"}', '{"type":"result","exit_code":0,"text":"pong","session_id":"local-1"}']);
  const { out, sink: s } = sink();
  const result = await sendIntoLiveSession({ argv: ["hermes"], home: "/p/clean", sessionId: "local-1", text: "reply with just pong", sink: s, spawn, env: { HERMES_TUI_GATEWAY_URL: "ws://elsewhere", PATH: "/bin" } });
  expect(result).toEqual({ text: "pong", sessionId: "local-1", exitCode: 0 });
  expect(out.deltas).toEqual(["po", "ng"]);
  expect(out.statuses).toEqual(["Thinking", "Running terminal", "Thinking", ""]);
  expect(seen.stdin).toBe("reply with just pong");
  expect(seen.env?.HERMES_HOME).toBe("/p/clean");
  expect("HERMES_TUI_GATEWAY_URL" in (seen.env ?? {})).toBe(false);
});

test("an unstreamed or replay-gapped reply is shown once, whole", async () => {
  const whole = sink();
  await sendIntoLiveSession({ argv: ["hermes"], home: "/h", sessionId: "s", text: "t", sink: whole.sink, spawn: fakeSpawn(['{"type":"result","exit_code":0,"text":"pong"}']).spawn, env: {} });
  expect(whole.out.deltas).toEqual(["pong"]);
  const gap = sink();
  await sendIntoLiveSession({ argv: ["hermes"], home: "/h", sessionId: "s", text: "t", sink: gap.sink, spawn: fakeSpawn(['{"type":"text","text":"po"}', '{"type":"result","exit_code":0,"text":"pong","replay_gap":true}']).spawn, env: {} });
  expect(gap.out.deltas).toEqual(["po", "ng"]);
});

test("failures are reported, never retried: refused turn, no result (ambiguous), empty reply", async () => {
  const s = sink().sink;
  await expect(sendIntoLiveSession({ argv: ["hermes"], home: "/h", sessionId: "s", text: "t", sink: s, spawn: fakeSpawn(['{"type":"result","exit_code":3,"text":"","error":"needs approval"}'], { exit: 3 }).spawn, env: {} })).rejects.toThrow("Hermes: needs approval");
  await expect(sendIntoLiveSession({ argv: ["hermes"], home: "/h", sessionId: "s", text: "t", sink: s, spawn: fakeSpawn([], { exit: 1, stderr: "Error: Gateway disconnected\n" }).spawn, env: {} })).rejects.toThrow("check it before resending");
  await expect(sendIntoLiveSession({ argv: ["hermes"], home: "/h", sessionId: "s", text: "t", sink: s, spawn: fakeSpawn(['{"type":"result","exit_code":0,"text":""}']).spawn, env: {} })).rejects.toThrow("without a reply");
});

test("stopping the Dash turn interrupts only the thin client (SIGINT), and reports the cancel", async () => {
  const killed: (string | number | undefined)[] = [];
  let close: () => void = () => undefined;
  const spawn: LiveSpawn = () => {
    const open = new ReadableStream<Uint8Array>({ start(c) { close = () => c.close(); } });
    const empty = new ReadableStream<Uint8Array>({ start(c) { c.close(); } });
    let exit: (code: number) => void = () => undefined;
    const exited = new Promise<number>(resolve => { exit = resolve; });
    return { stdin: { write: () => undefined, end: () => undefined }, stdout: open, stderr: empty, exited,
      kill: signal => { killed.push(signal); close(); exit(130); } };
  };
  const live = new AbortController();
  const run = sendIntoLiveSession({ argv: ["hermes"], home: "/h", sessionId: "s", text: "t", sink: sink().sink, spawn, signal: live.signal, env: {} });
  live.abort();
  await expect(run).rejects.toThrow("Cancelled");
  expect(killed[0]).toBe("SIGINT");
  await Bun.sleep(5100);
  expect(killed).toEqual(["SIGINT"]);
}, 7000);
