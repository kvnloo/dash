import { expect, test } from "bun:test";
import { gatewaySteer, sendGatewayMessage, steerDisposition, type SteerReceipt, type SteerSpawn } from "./hermes-steer";
import type { LiveSpawn } from "./hermes-live";
const base = { argv: ["fixture"], home: "/fixture", sessionId: "s", text: "change course", sink: { delta() {}, status() {} } };

function helperFixture(output: string, exit = 0, signal?: AbortController) {
  const input: string[] = []; const killed: string[] = [];
  const spawnSteer: SteerSpawn = (argv, options) => {
    expect(argv[0]).toBe("python3"); expect(argv[1]).toEndWith("hermes-steer.py");
    expect(argv).not.toContain(base.text); expect(options.env.HERMES_HOME).toBe(base.home);
    expect(options.env.HERMES_TUI_GATEWAY_URL).toBeUndefined();
    return { stdin: { write(text) { input.push(text); signal?.abort(); }, end() {} }, stdout: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(output)); c.close(); } }), exited: Promise.resolve(exit), kill(s) { killed.push(s ?? ""); } };
  };
  return { spawnSteer, input, killed };
}
test("helper receives text only on stdin, validates receipts and process outcomes", async () => {
  const fixture = helperFixture('{"ok":true,"code":"steered"}');
  expect(await gatewaySteer({ ...base, spawnSteer: fixture.spawnSteer })).toEqual({ ok: true, code: "steered" });
  expect(fixture.input).toEqual([JSON.stringify({ session_id: "s", text: base.text })]);
  expect(fixture.killed).toEqual([]);
  for (const raw of ['null', 'true', '1', '"steered"', '[]', '{}', '{"code":"steered"}', '{"ok":"true","code":"steered"}', '{"ok":true}', '{"ok":true,"code":1}']) {
    await expect(gatewaySteer({ ...base, spawnSteer: helperFixture(raw).spawnSteer })).rejects.toThrow("Invalid steer receipt");
  }
  await expect(gatewaySteer({ ...base, spawnSteer: helperFixture('{"ok":true,"code":"steered"}', 1).spawnSteer })).rejects.toThrow("outcome unknown");
});
test("cancelled helper never reports success or submits another turn", async () => {
  const signal = new AbortController(); const fixture = helperFixture('{"ok":true,"code":"steered"}', 0, signal);
  await expect(gatewaySteer({ ...base, signal: signal.signal, spawnSteer: fixture.spawnSteer })).rejects.toThrow("outcome unknown");
  expect(fixture.killed).toEqual(["SIGTERM"]);
  const pre = new AbortController(); pre.abort(); const notSent = helperFixture('{}');
  await expect(gatewaySteer({ ...base, signal: pre.signal, spawnSteer: notSent.spawnSteer })).rejects.toThrow("Steer cancelled");
  expect(notSent.input).toEqual([]); expect(notSent.killed).toEqual(["SIGTERM"]);
});

test("legacy/default and explicit queue never attempt steering", async () => {
  for (const mode of [undefined, "queue"] as const) {
    const deliveries: string[] = []; let queued = 0;
    const result = await sendGatewayMessage({ ...base, mode, delivery: mode => deliveries.push(mode), steer: async () => { throw new Error("must not steer"); }, queue: async options => { queued++; expect(deliveries).toEqual(["queued"]); options.onStarted?.(); options.onStarted?.(); return { text: "next reply", sessionId: "s", exitCode: 0 }; } });
    expect(result.text).toBe("next reply"); expect(queued).toBe(1); expect(deliveries).toEqual(["queued", "started"]);
  }
});
test("steer accepted has no new turn and no copied assistant reply", async () => {
  const deliveries: string[] = [];
  const result = await sendGatewayMessage({ ...base, mode: "steer", delivery: mode => deliveries.push(mode), steer: async () => ({ ok: true, code: "steered" }), queue: async () => { throw new Error("must not queue"); } });
  expect(result).toEqual({ text: "", sessionId: "s", exitCode: 0 }); expect(deliveries).toEqual(["steered"]);
});
test("explicit no-longer-accepting rejection queues once with a visible explanation", async () => {
  for (const code of ["no_running_turn", "stale_generation", "execution_not_ready"]) {
    const deliveries: [string, string][] = []; let queued = 0;
    await sendGatewayMessage({ ...base, mode: "steer", delivery: (mode, text) => deliveries.push([mode,text]), steer: async () => ({ ok: false, code }), queue: async () => { queued++; return { text: "reply", sessionId: "s", exitCode: 0 }; } });
    expect(queued).toBe(1); expect(deliveries).toEqual([["queued", "The turn stopped accepting steering; queued for the next turn instead."]]);
  }
});
test("unsupported, auth, ambiguous, malformed acceptance and refusal NEVER fallback", async () => {
  const receipts: SteerReceipt[] = ["unsupported_control", "permission_denied", "outcome_unknown", "steer_refused", "gateway_unavailable", "not_found"].map(code => ({ ok: false, code }));
  receipts.push({ ok: true, code: "no_running_turn" }, { ok: false, code: "steered" });
  for (const receipt of receipts) {
    expect(steerDisposition(receipt)).toBe("failed"); let queued = 0;
    await expect(sendGatewayMessage({ ...base, mode: "steer", delivery: () => { throw new Error("must not acknowledge"); }, steer: async () => receipt, queue: async () => { queued++; throw new Error("must not queue"); } })).rejects.toThrow("Nothing retried");
    expect(queued).toBe(0);
  }
});
test("transport disconnect never retries", async () => {
  let queued = 0;
  await expect(sendGatewayMessage({ ...base, mode: "steer", delivery() {}, steer: async () => { throw new Error("disconnect"); }, queue: async () => { queued++; throw new Error("must not queue"); } })).rejects.toThrow("disconnect");
  expect(queued).toBe(0);
});
test("gateway process startup is not a turn-start signal", async () => {
  const deliveries: string[] = []; const encoder = new TextEncoder();
  const spawn: LiveSpawn = () => ({ stdin: { write() {}, end() {} }, stdout: new ReadableStream({ start(controller) { expect(deliveries).toEqual(["queued"]); controller.enqueue(encoder.encode('{"type":"init"}\n')); controller.enqueue(encoder.encode('{"type":"tool_use","name":"terminal"}\n{"type":"text","text":"pong"}\n{"type":"result","exit_code":0,"text":"pong"}\n')); controller.close(); } }), stderr: new ReadableStream({ start(c) { c.close(); } }), exited: Promise.resolve(0), kill() {} });
  await sendGatewayMessage({ ...base, spawn, delivery: mode => deliveries.push(mode) });
  expect(deliveries).toEqual(["queued", "started"]);
});
