import { describe, expect, test } from "bun:test";
import { streamHermesSession, takeSseFrames } from "./hermes-stream";

const api = { url: "http://127.0.0.1:8642", key: "k" };

function sse(frames: string[], opts: { status?: number; delayMs?: number } = {}): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const f of frames) {
        if (opts.delayMs) await Bun.sleep(opts.delayMs);
        controller.enqueue(enc.encode(f));
      }
      controller.close();
    },
  });
  return new Response(body, { status: opts.status ?? 200, headers: { "Content-Type": "text/event-stream" } });
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function fakeFetch(stream: () => Response, calls: string[] = []) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/chat/stream")) return stream();
    return Response.json({ session: { id: "s1" } });
  };
}

function sink() {
  const deltas: string[] = [];
  const statuses: string[] = [];
  return { deltas, statuses, delta: (t: string) => deltas.push(t), status: (t: string) => statuses.push(t) };
}

describe("takeSseFrames", () => {
  test("splits frames, skips keepalive comments, keeps a partial tail", () => {
    const { frames, rest } = takeSseFrames(`: keepalive\n\nevent: assistant.delta\ndata: {"delta":"he"}\n\nevent: done\ndata: {}\n\nevent: assist`);
    expect(frames).toEqual([{ event: "assistant.delta", data: { delta: "he" } }, { event: "done", data: {} }]);
    expect(rest).toBe("event: assist");
  });
  test("CRLF frames parse the same", () => {
    expect(takeSseFrames(`event: done\r\ndata: {}\r\n\r\n`).frames).toEqual([{ event: "done", data: {} }]);
  });
});

describe("streamHermesSession", () => {
  test("forwards each delta as it arrives and posts to the SSE endpoint after an identity check", async () => {
    const calls: string[] = [];
    const s = sink();
    const result = await streamHermesSession({ api, sessionId: "s1", text: "hi", sink: s, fetch: fakeFetch(() => sse([
      frame("run.started", {}), frame("assistant.delta", { delta: "po" }), frame("assistant.delta", { delta: "ng" }),
      frame("assistant.completed", { content: "pong", session_id: "s1" }), frame("run.completed", {}), frame("done", {}),
    ]), calls) });
    expect(s.deltas).toEqual(["po", "ng"]);
    expect(result).toEqual({ text: "pong", sessionId: "s1", streamed: true });
    expect(calls).toEqual(["GET http://127.0.0.1:8642/api/sessions/s1", "POST http://127.0.0.1:8642/api/sessions/s1/chat/stream"]);
  });

  test("a frame split across network chunks still parses", async () => {
    const s = sink();
    const whole = frame("assistant.delta", { delta: "split" }) + frame("done", {});
    await streamHermesSession({ api, sessionId: "s1", text: "hi", sink: s, fetch: fakeFetch(() => sse([whole.slice(0, 17), whole.slice(17)])) });
    expect(s.deltas).toEqual(["split"]);
  });

  test("tool steps become status lines and separate the text around them", async () => {
    const s = sink();
    await streamHermesSession({ api, sessionId: "s1", text: "hi", sink: s, fetch: fakeFetch(() => sse([
      frame("assistant.delta", { delta: "Checking." }), frame("tool.started", { tool_name: "terminal", preview: "ls" }),
      frame("tool.completed", { tool_name: "terminal" }), frame("assistant.delta", { delta: "Done." }), frame("done", {}),
    ])) });
    expect(s.statuses).toEqual(["Thinking", "", "Running terminal", "Thinking", ""]);
    expect(s.deltas.join("")).toBe("Checking.\n\nDone.");
  });

  test("a reply that was not streamed token by token arrives once, whole", async () => {
    const s = sink();
    const result = await streamHermesSession({ api, sessionId: "s1", text: "hi", sink: s, fetch: fakeFetch(() => sse([frame("assistant.completed", { content: "whole reply" }), frame("done", {})])) });
    expect(s.deltas).toEqual(["whole reply"]);
    expect(result.streamed).toBe(false);
  });

  test("an error frame fails the turn", async () => {
    await expect(streamHermesSession({ api, sessionId: "s1", text: "hi", sink: sink(), fetch: fakeFetch(() => sse([frame("error", { message: "model down" }), frame("done", {})])) })).rejects.toThrow("model down");
  });

  test("202 means Hermes queued it with a live owner: never resend", async () => {
    await expect(streamHermesSession({ api, sessionId: "s1", text: "hi", sink: sink(), fetch: fakeFetch(() => new Response("{}", { status: 202 })) })).rejects.toThrow("do not resend");
  });

  test("an API that does not own the session is refused before any send", async () => {
    const calls: string[] = [];
    const fetchFn = async (input: string | URL | Request, init?: RequestInit) => { calls.push(`${init?.method ?? "GET"} ${String(input)}`); return Response.json({ session: { id: "other" } }); };
    await expect(streamHermesSession({ api, sessionId: "s1", text: "hi", sink: sink(), fetch: fetchFn })).rejects.toThrow("does not own");
    expect(calls).toHaveLength(1);
  });

  test("a long turn survives as long as frames keep coming; only silence ends it", async () => {
    const s = sink();
    const frames = [...Array.from({ length: 6 }, () => ": keepalive\n\n"), frame("assistant.delta", { delta: "late" }), frame("done", {})];
    await streamHermesSession({ api, sessionId: "s1", text: "hi", sink: s, idleMs: 60, fetch: fakeFetch(() => sse(frames, { delayMs: 30 })) });
    expect(s.deltas).toEqual(["late"]);
    await expect(streamHermesSession({ api, sessionId: "s1", text: "hi", sink: sink(), idleMs: 40, fetch: fakeFetch(() => sse([frame("done", {})], { delayMs: 120 })) })).rejects.toThrow("went quiet");
  });

  test("an empty finish is an error, not a silent success", async () => {
    await expect(streamHermesSession({ api, sessionId: "s1", text: "hi", sink: sink(), fetch: fakeFetch(() => sse([frame("done", {})])) })).rejects.toThrow("without a reply");
  });
});
