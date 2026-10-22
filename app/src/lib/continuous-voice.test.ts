import { describe, expect, test } from "bun:test";
import { ContinuousVoice, realWords, type VoicePeer } from "./continuous-voice";

function harness(holdIntent = false, readyOnAnswer = true) {
  const requests: { path: string; body?: unknown }[] = [];
  const sent: object[] = [];
  let closed = 0;
  let muted = true;
  let event = (_raw: string) => {};
  let ready = () => {};
  let lost = () => {};
  const peer: VoicePeer = { offer: async () => "v=0\r\n", answer: async () => { if (readyOnAnswer) ready(); }, mute: value => { muted = value; }, send: value => { sent.push(value); }, close: () => { closed++; } };
  const call = new ContinuousVoice({ changed: () => {}, transcript: () => {}, holdIntent: () => holdIntent, request: async (path, body) => {
    requests.push({ path, body });
    if (path === "/v1/realtime/session") return { session_id: "test-session", transport: "realtime", value: "ephemeral-test" };
    if (path.startsWith("/v1/inbox")) return { messages: [], after: 0, has_more: false };
    if (path === "provider:answer") return "v=0\r\n";
    return { ok: true, speech: "silent" };
  }, peer: async (onEvent, onReady, onLost) => { event = onEvent; ready = onReady; lost = onLost; return peer; } });
  return { call, requests, sent, get closed() { return closed; }, get muted() { return muted; }, event: (value: object) => event(JSON.stringify(value)), lost: () => lost(), ready: () => ready() };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
describe("root continuous WebRTC lifecycle", () => {
  test("mute during connecting survives late peer readiness; unmute cannot transmit before ready", async () => {
    const h = harness(false, false); await h.call.start({ profile: "test", session: "attached" });
    h.call.mute(false); expect(h.muted).toBe(true);
    h.call.mute(true); h.ready(); expect(h.call.state.phase).toBe("listening");
    expect(h.call.state.muted).toBe(true); expect(h.muted).toBe(true); await h.call.stop();
  });
  test("a real final utterance is dispatched once with its provider item id; acceptance is silent", async () => {
    const h = harness(); await h.call.start({ profile: "test", session: "attached" });
    const event = { type: "conversation.item.input_audio_transcription.completed", event_id: "utterance", item_id: "provider-item", transcript: "Fix the marked button" };
    h.event(event); h.event(event); await settle();
    const work = h.requests.filter(r => r.path === "/v1/tools/ask_z0");
    expect(work).toHaveLength(1); expect(work[0]?.body).toMatchObject({ call_id: "provider-item", arguments: { question: "Fix the marked button" } });
    expect(h.call.state.delivery).toBe("accepted");
    expect(h.sent.filter(x => Reflect.get(x, "type") === "response.create")).toHaveLength(0); await h.call.stop();
  });
  test("annotation intent stays in its draft instead of dispatching a second text-only request", async () => {
    const h = harness(true); await h.call.start({ profile: "test", session: "attached" });
    h.event({ type: "conversation.item.input_audio_transcription.completed", event_id: "held", item_id: "held-item", transcript: "Make this bigger" }); await settle();
    expect(h.requests.filter(r => r.path === "/v1/tools/ask_z0")).toHaveLength(0);
    expect(h.call.state.delivery).toBe("draft"); await h.call.stop();
  });
  test("a final reply waits for actual audio playback to stop, and is never duplicated", async () => {
    const h = harness(); await h.call.start({ profile: "test", session: "attached" });
    h.event({ type: "response.created" }); h.event({ type: "output_audio_buffer.started" });
    h.call.deliverFinal("same-receipt", "The fix is ready"); h.call.deliverFinal("same-receipt", "The fix is ready");
    h.event({ type: "response.done" }); await settle();
    expect(h.sent.filter(x => Reflect.get(x, "type") === "response.create")).toHaveLength(0);
    h.event({ type: "output_audio_buffer.stopped" }); await settle();
    expect(h.sent.filter(x => Reflect.get(x, "type") === "response.create")).toHaveLength(1); await h.call.stop();
  });
  test("start uses realtime only and explicit stop closes local media and ends owned broker session", async () => {
    const h = harness(); await h.call.start({ profile: "test", session: "attached" });
    expect(h.call.state.phase).toBe("listening"); expect(h.muted).toBe(false);
    expect(h.requests[0]?.body).toMatchObject({ transports: ["realtime"], context: { hermes_target: { profile: "test", session: "attached" } } });
    await h.call.stop(); expect(h.closed).toBe(1); expect(h.muted).toBe(true);
    expect(h.requests.some(r => r.path === "/v1/sessions/test-session/end")).toBe(true);
  });
  test("noise does not interrupt, final words do; mute clears pending input", async () => {
    const h = harness(); await h.call.start({ profile: "test", session: "attached" });
    h.event({ type: "response.created" }); h.event({ type: "input_audio_buffer.speech_started" });
    expect(h.sent.some(x => Reflect.get(x, "type") === "response.cancel")).toBe(false);
    h.event({ type: "conversation.item.input_audio_transcription.completed", transcript: "[noise]", item_id: "noise" }); await settle();
    expect(h.sent.some(x => Reflect.get(x, "type") === "response.cancel")).toBe(false);
    h.event({ type: "conversation.item.input_audio_transcription.completed", transcript: "Actually change this", item_id: "words" }); await settle();
    expect(h.sent.some(x => Reflect.get(x, "type") === "response.cancel")).toBe(true);
    h.call.mute(true); expect(h.muted).toBe(true); expect(Reflect.get(h.sent.at(-1) ?? {}, "type")).toBe("input_audio_buffer.clear"); await h.call.stop();
  });
  test("disconnect shuts capture and does not resend or remint", async () => {
    const h = harness(); await h.call.start({ profile: "test", session: "attached" }); h.lost(); await settle();
    expect(h.closed).toBe(1); expect(h.call.state.phase).toBe("error");
    expect(h.requests.filter(r => r.path === "/v1/realtime/session")).toHaveLength(1);
  });
  test("late mint after stop is ended without acquiring microphone", async () => {
    let resolve: (value: unknown) => void = () => {}; let peers = 0; const ended: string[] = [];
    const call = new ContinuousVoice({ changed: () => {}, transcript: () => {}, peer: async () => { peers++; throw new Error(); }, request: async path => {
      if (path === "/v1/realtime/session") return new Promise(done => { resolve = done; });
      ended.push(path); return {};
    } });
    const start = call.start({ profile: "test", session: "attached" }); await call.stop();
    resolve({ session_id: "late", value: "short-lived", transport: "realtime" }); await start;
    expect(peers).toBe(0); expect(ended).toContain("/v1/sessions/late/end"); expect(call.state.phase).toBe("idle");
  });
  test("duplicate provider event never relays twice and silent acceptance never creates continuation", async () => {
    const h = harness(); await h.call.start({ profile: "test", session: "attached" });
    const event = { type: "response.function_call_arguments.done", event_id: "same", name: "ask_z0", call_id: "once", arguments: '{"question":"[test] hello"}' };
    h.event(event); h.event(event); await settle(); h.event({ type: "response.done" }); await settle();
    expect(h.requests.filter(r => r.path === "/v1/tools/ask_z0")).toHaveLength(1);
    expect(h.sent.filter(x => Reflect.get(x, "type") === "response.create")).toHaveLength(0); await h.call.stop();
  });
  test("noise gate rejects labels and accepts words", () => { expect(realWords("[noise]")).toBe(false); expect(realWords("…")).toBe(false); expect(realWords("cancel that")).toBe(true); });
  test("stop/background cannot release the microphone lease before pending native acquisition closes", async () => {
    let acquired = false, released = false, closed = false;
    let resolvePeer: (peer: VoicePeer) => void = () => {};
    const call = new ContinuousVoice({ changed: () => {}, transcript: () => {}, captureReleased: () => { released = true; },
      request: async path => path === "/v1/realtime/session" ? { session_id: "pending", transport: "realtime", value: "ephemeral" } : { messages: [], after: 0 },
      peer: () => { acquired = true; return new Promise(resolve => { resolvePeer = resolve; }); },
    });
    const start = call.start({ profile: "test", session: "attached" }); await settle(); expect(acquired).toBe(true);
    const stop = call.stop(); const background = call.stop(); expect(released).toBe(false);
    resolvePeer({ offer: async () => "v=0", answer: async () => {}, mute: () => {}, send: () => {}, close: () => { closed = true; } });
    await Promise.all([start, stop, background]); expect(closed).toBe(true); expect(released).toBe(true);
  });
});
