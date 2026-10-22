import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseZ0LiveSession, parseZ0LiveState, Z0LIVE_OFF } from "../../shared/z0live-state";
import { readZ0LiveState, z0liveStateHttp } from "./z0live-state";

// Sanitised from real broker session JSONL: structure, timestamps and sources kept; text and arguments replaced.
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/z0live", name), "utf8").trim().split("\n");
const TOOL = fixture("tool-call.jsonl");
const ENDED = fixture("ended-call.jsonl");
const ts = (line: string | undefined): number => { const v: unknown = JSON.parse(line ?? "{}"); return typeof v === "object" && v !== null && "ts" in v && typeof v.ts === "number" ? v.ts : NaN; };
const upTo = (lines: string[], n: number) => parseZ0LiveSession("s1", lines.slice(0, n).join("\n"), ts(lines[n - 1]) + 1);

test("replays a real call through connecting, listening, thinking, tool, speaking and end", () => {
  const phases = [1, 2, 3, 4, 5, 6, 7, 8].map(n => { const s = upTo(TOOL, n); return s.live ? s.phase : "off"; });
  expect(phases).toEqual(["connecting", "listening", "thinking", "tool", "thinking", "speaking", "speaking", "listening"]);
  const tool = upTo(TOOL, 4);
  expect(tool.live && tool.tool).toBe("volume");
  expect(upTo(TOOL, 5)).not.toHaveProperty("tool");
  expect(upTo(TOOL, TOOL.length)).toEqual(Z0LIVE_OFF);
});

test("tracks mute and keeps only the last three transcript lines, in order", () => {
  const muted = upTo(TOOL, 9);
  expect(muted.live && muted.muted).toBe(true);
  const unmuted = upTo(TOOL, 10);
  expect(unmuted.live && unmuted.muted).toBe(false);
  const mid = upTo(ENDED, 16);
  expect(mid.live).toBe(true);
  if (!mid.live) return;
  expect(mid.transcript).toHaveLength(3);
  expect(mid.transcript.map(l => l.role)).toEqual(["user", "assistant", "user"]);
  expect(mid.sessionId).toBe("s1");
  expect(mid.updated).toBe(ts(ENDED[15]));
  expect(mid.transcript.at(-1)?.text).toMatch(/^user line \d+$/);
});

test("ended and stale sessions are not live", () => {
  expect(parseZ0LiveSession("s1", ENDED.join("\n"), ts(ENDED.at(-1)) + 1)).toEqual(Z0LIVE_OFF);
  const last = ts(TOOL[7]);
  const body = TOOL.slice(0, 8).join("\n");
  expect(parseZ0LiveSession("s1", body, last + 60).live).toBe(true);
  expect(parseZ0LiveSession("s1", body, last + 61).live).toBe(false);
  expect(parseZ0LiveSession("s1", body, last - 61).live).toBe(false);
  expect(parseZ0LiveSession("s1", "", 0)).toEqual(Z0LIVE_OFF);
  expect(parseZ0LiveSession("../etc", body, last)).toEqual(Z0LIVE_OFF);
});

const line = (type: string, ts: number, data: Record<string, unknown> = {}, text = "") => JSON.stringify({ type, ts, text, data });

test("floor holder wins over audio and pending tools; barge-in clears tools", () => {
  const base = [line("app_state", 1, { source: "connected" })];
  const at = (...rest: string[]) => parseZ0LiveSession("s", [...base, ...rest].join("\n"), 10);
  expect(at(line("floor", 2, { state: "user" }), line("tool_call", 3, { name: "ask_z0", call_id: "c" }))).toMatchObject({ phase: "listening" });
  expect(at(line("floor", 2, { state: "assistant" }))).toMatchObject({ phase: "speaking" });
  expect(at(line("app_state", 2, { source: "active_session_heartbeat", floor: "user" }))).toMatchObject({ phase: "listening" });
  expect(at(line("app_state", 2, { source: "output_audio_buffer.started" }), line("app_state", 3, { source: "output_audio_buffer.cleared" }))).toMatchObject({ phase: "listening" });
  expect(at(line("tool_call", 2, { name: "ask_z0", call_id: "c" }), line("barge_in", 3))).toMatchObject({ phase: "listening" });
  // A result without call_id settles the same-named call.
  expect(at(line("tool_call", 2, { name: "ask_z0", id: 7 }), line("tool_result", 3, { name: "ask_z0" }))).toMatchObject({ phase: "listening" });
  expect(at(line("tool_call", 2, { name: "ask_z0", id: 7 }), line("tool_result", 3, { id: 7 }))).toMatchObject({ phase: "listening" });
  expect(at(line("tool_call", 2, {}, "rm -rf /"))).toMatchObject({ phase: "listening" });
  expect(at(line("tool_call", 2, {}, "say_hi"))).toMatchObject({ phase: "tool", tool: "say_hi" });
  expect(at(line("app_state", 2, { source: "session_ready" }))).toMatchObject({ phase: "connecting" });
  expect(at(line("app_state", 2, { source: "session_end" }))).toEqual(Z0LIVE_OFF);
  expect(at(line("summary", 2, { session_end: true }))).toEqual(Z0LIVE_OFF);
  expect(at("not json", "[]", JSON.stringify({ type: "floor" }), line("app_state", 2, { floor: "speaking" }))).toMatchObject({ phase: "listening" });
  expect(parseZ0LiveSession("s", JSON.stringify({ type: "user_transcript", ts: "1970-01-01T00:00:05Z", text: "hi", data: {} }), 5)).toMatchObject({ live: true, phase: "thinking", updated: 5 });
});

test("transcript text is flattened and clipped", () => {
  const long = "x".repeat(400);
  const s = parseZ0LiveSession("s", [line("app_state", 1, { source: "connected" }), line("user_transcript", 2, {}, `  a\n  b  `), line("assistant_transcript", 3, {}, long), line("user_transcript", 4, {}, "   ")].join("\n"), 4);
  expect(s.live && s.transcript).toEqual([{ role: "user", text: "a b" }, { role: "assistant", text: `${"x".repeat(279)}…` }]);
});

test("the app-side validator accepts the bridge shape and rejects anything else", () => {
  const good = { live: true, sessionId: "abc", phase: "tool", tool: "ask_z0", muted: true, updated: 5, transcript: [{ role: "user", text: "hi" }, { role: "x", text: "no" }, { role: "assistant", text: 3 }] };
  expect(parseZ0LiveState(good)).toEqual({ live: true, sessionId: "abc", phase: "tool", tool: "ask_z0", muted: true, updated: 5, transcript: [{ role: "user", text: "hi" }] });
  expect(parseZ0LiveState({ ...good, phase: "listening" })).not.toHaveProperty("tool");
  expect(parseZ0LiveState({ ...good, tool: "bad tool!" })).not.toHaveProperty("tool");
  expect(parseZ0LiveState({ ...good, muted: "yes" })).toMatchObject({ muted: false });
  for (const bad of [null, [], { live: false }, { ...good, live: "true" }, { ...good, sessionId: "a/b" }, { ...good, sessionId: 1 }, { ...good, phase: "idle" }, { ...good, updated: "5" }, { ...good, transcript: {} }]) expect(parseZ0LiveState(bad)).toEqual(Z0LIVE_OFF);
  for (const phase of ["connecting", "listening", "speaking", "thinking"]) expect(parseZ0LiveState({ ...good, phase })).toMatchObject({ phase });
  expect(parseZ0LiveState({ ...good, transcript: [1, 2, 3, { role: "user", text: "last" }] })).toMatchObject({ transcript: [{ role: "user", text: "last" }] });
});

test("reads the newest session file's tail, read-only, and serves it behind auth", async () => {
  const dir = mkdtempSync(join(tmpdir(), "z0live-"));
  expect(readZ0LiveState(dir, 0)).toEqual(Z0LIVE_OFF);
  expect(readZ0LiveState(join(dir, "missing"), 0)).toEqual(Z0LIVE_OFF);
  writeFileSync(join(dir, "old.jsonl"), TOOL.slice(0, 4).join("\n"));
  writeFileSync(join(dir, "notes.txt"), "x");
  writeFileSync(join(dir, "new.jsonl"), `${"{\"pad\":1}\n".repeat(8000)}${TOOL.slice(0, 6).join("\n")}\n`);
  utimesSync(join(dir, "old.jsonl"), 1, 1);
  const state = readZ0LiveState(dir, ts(TOOL[5]) + 1);
  expect(state).toMatchObject({ live: true, sessionId: "new", phase: "speaking" });
  const read = () => state;
  expect(z0liveStateHttp(new Request("http://x/other"), true, read)).toBeUndefined();
  expect(z0liveStateHttp(new Request("http://x/z0live/state"), false, read)?.status).toBe(401);
  expect(z0liveStateHttp(new Request("http://x/z0live/state", { method: "POST" }), true, read)?.status).toBe(405);
  const ok = z0liveStateHttp(new Request("http://x/z0live/state"), true, read);
  expect(ok?.headers.get("cache-control")).toBe("no-store");
  expect(await ok?.json()).toEqual(state);
});
