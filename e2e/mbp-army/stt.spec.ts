import { test, expect, pair, createBridge, type Bridge } from "./fixtures";
import { readFile, writeFile, readdir, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// C01 adds BridgeOptions.env passthrough; keeping the shared fixture owned by C01.
const fixtureOptions = {
  archiveClaude: false,
  env: { DASH_STT_ENGINE: "fixture", DASH_STT_FIXTURE_BUSY_MS: "4000" },
};
test.use({ bridgeOptions: fixtureOptions });

test("STT fixture returns text while authenticated bridge GETs stay responsive", async ({ page, bridge }) => {
  // A real web app paired to an isolated real Bun bridge, not a mocked route.
  await pair(page, bridge);
  const token = (await readFile(join(bridge.dir, ".dash", "token"), "utf8")).trim();
  const root = "http://127.0.0.1:" + bridge.port;
  const auth = { Authorization: "Bearer " + token };
  const transcription = fetch(root + "/transcribe", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/octet-stream" },
    body: Buffer.alloc(2048, 0x55),
  });
  let transcribeFinished = false;
  void transcription.then(() => { transcribeFinished = true; }, () => { transcribeFinished = true; });

  const probes: Promise<{ status: number; ms: number }>[] = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    // A cheap authenticated GET: the context handler returns immediately for OMP.
    probes.push(fetch(root + "/chat/context?session=army-stt&profile=army-stt&harness=omp", {
      headers: auth,
    }).then(async response => {
      await response.text();
      return { status: response.status, ms: performance.now() - start };
    }));
    await new Promise<void>(resolve => setTimeout(resolve, 100));
  }
  expect(transcribeFinished, "The four-second decode must overlap all 30 probes").toBe(false);

  const results = await Promise.all(probes);
  for (const [index, result] of results.entries()) {
    expect(result.status, "authenticated probe " + index).toBe(200);
    expect(result.ms, "probe " + index + " must not stall behind STT").toBeLessThan(250);
  }
  const response = await transcription;
  expect(response.status).toBe(200);
  const payload: unknown = await response.json();
  expect(payload).toEqual({ text: "ARMY heard you" });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function postAudio(bridge: Bridge): Promise<Response> {
  const token = (await readFile(join(bridge.dir, ".dash", "token"), "utf8")).trim();
  return fetch("http://127.0.0.1:" + bridge.port + "/transcribe", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/octet-stream" },
    body: Buffer.alloc(256, 0x55),
  });
}

test.describe("STT real-host checks", () => {
  // C03's file-wide fixture selection is overridden for missing-model and filename checks.
  test.use({ bridgeOptions: {} });

  test("missing model returns 503 with model directory reason", async ({ page, bridge }) => {
    await pair(page, bridge);
    // Check the model-directory diagnostic independent of the CI host's ffmpeg install.
    await writeFile(join(bridge.dir, "bin", "ffmpeg"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    const response = await postAudio(bridge);
    expect(response.status).toBe(503);
    const body: unknown = await response.json();
    expect(body).toEqual({
      error: "Speech-to-text is not available on this host.",
      reason: expect.stringContaining(join(bridge.dir, "no-model")),
    });
  });

  test("malicious voice id does not touch HOME or TMPDIR files", async ({ page, bridge }, info) => {
    await pair(page, bridge);
    // Admit a real-path voice turn with dummy model files; ffmpeg deliberately fails
    // after the bridge has written its input. No native model or external tool is used.
    const modelDir = join(bridge.dir, "no-model");
    await mkdir(modelDir, { recursive: true });
    for (const name of ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"]) {
      await writeFile(join(modelDir, name), "army-invalid-model");
    }
    await writeFile(join(bridge.dir, "bin", "ffmpeg"),
      "#!/bin/sh\nprintf 'army forced decoder failure\\n' >&2\nexit 1\n", { mode: 0o700 });

    const sentinelInput = join(bridge.dir, "army-escape.input");
    const sentinelWave = join(bridge.dir, "army-escape.wav");
    await writeFile(sentinelInput, "ARMY_UNTOUCHED_INPUT");
    await writeFile(sentinelWave, "ARMY_UNTOUCHED_WAV");
    const workTmp = join(bridge.dir, "tmp");
    const list = async (directory: string): Promise<string[]> =>
      (await readdir(directory, { recursive: true })).sort();
    const before = { home: await list(bridge.dir), tmpdir: await list(workTmp) };
    const token = (await readFile(join(bridge.dir, ".dash", "token"), "utf8")).trim();
    const id = "../../army-escape";

    // A raw browser WebSocket, bypassing the Dash transport, with the bridge's
    // real execution credential. No route mocks or seeded turn state.
    const events = await page.evaluate(({ port, token: secret, id: turnId, cwd, chunk }) =>
      new Promise<string[]>((resolve, reject) => {
        const socket = new WebSocket("ws://127.0.0.1:" + port + "/ws?token=" + encodeURIComponent(secret));
        const received: string[] = [];
        const timeout = window.setTimeout(() => {
          socket.close();
          reject(new Error("voice_commit did not finish"));
        }, 15000);
        socket.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error("authenticated raw voice websocket failed"));
        };
        socket.onmessage = event => {
          if (typeof event.data !== "string") return;
          let message: unknown;
          try { message = JSON.parse(event.data); } catch { return; }
          if (!message || typeof message !== "object" || !("id" in message) || message.id !== turnId || !("type" in message)) return;
          received.push(event.data);
          if (message.type === "done") {
            window.clearTimeout(timeout);
            socket.close();
            resolve(received);
          }
        };
        socket.onopen = () => {
          socket.send(JSON.stringify({ type: "voice_begin", id: turnId, harness: "omp", mime: "audio/wav", cwd }));
          // voice_begin checks the local host and harness asynchronously.
          window.setTimeout(() => {
            socket.send(JSON.stringify({ type: "voice_chunk", id: turnId, data: chunk }));
            socket.send(JSON.stringify({ type: "voice_commit", id: turnId }));
          }, 1000);
        };
      }), { port: bridge.port, token, id, cwd: bridge.dir, chunk: Buffer.alloc(1024, 0x55).toString("base64") });

    expect(events.some(line => {
      const message: unknown = JSON.parse(line);
      return isRecord(message) && message.type === "status" && typeof message.text === "string" && message.text.includes("Transcribing");
    }), "voice_commit must have reached transcription, not a voice_begin rejection").toBe(true);
    expect(events.some(line => {
      const message: unknown = JSON.parse(line);
      return isRecord(message) && message.type === "error" && typeof message.message === "string" && message.message.includes("ffmpeg");
    })).toBe(true);

    const after = { home: await list(bridge.dir), tmpdir: await list(workTmp) };
    await info.attach("voice-traversal-home-and-tmpdir", {
      body: Buffer.from(JSON.stringify({ before, after }, null, 2)),
      contentType: "application/json",
    });
    const outside = (entries: string[]): string[] =>
      entries.filter(path => /\.(input|wav)$/.test(path) && !path.startsWith("tmp/dash-voice/")).sort();
    expect(outside(after.home)).toEqual(outside(before.home));
    expect(outside(after.tmpdir)).toEqual(outside(before.tmpdir));
    expect(await readFile(sentinelInput, "utf8")).toBe("ARMY_UNTOUCHED_INPUT");
    expect(await readFile(sentinelWave, "utf8")).toBe("ARMY_UNTOUCHED_WAV");
  });
});

test("STT fixture load failure returns 503 then retries to 200 without restart", async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), "dash-stt-fail-"));
  const failFile = join(dir, "block-model-load");
  await writeFile(failFile, "fixture intentionally fails the next load");
  const beforeEngine = process.env.DASH_STT_ENGINE;
  const beforeFailure = process.env.DASH_STT_FIXTURE_FAIL_FILE;
  const beforeRetry = process.env.DASH_STT_RETRY_MS;
  process.env.DASH_STT_ENGINE = "fixture";
  process.env.DASH_STT_FIXTURE_FAIL_FILE = failFile;
  process.env.DASH_STT_RETRY_MS = "500";
  let bridge: Bridge | undefined;
  try {
    bridge = await createBridge(false);
    await pair(page, bridge);
    const first = await postAudio(bridge);
    expect(first.status).toBe(503);
    const firstBody: unknown = await first.json();
    expect(firstBody).toEqual({
      error: "Speech-to-text is not available on this host.",
      reason: expect.stringContaining(failFile),
    });
    expect(bridge.logs()).toContain("speech.load_failed");
    expect(bridge.logs()).toMatch(/rssBytes=\d+/);

    await rm(failFile);
    // One actual retry after the configured cooldown, never a test retry loop.
    await new Promise<void>(resolve => setTimeout(resolve, 650));
    const second = await postAudio(bridge);
    expect(second.status).toBe(200);
    const secondBody: unknown = await second.json();
    expect(secondBody).toEqual({ text: "ARMY heard you" });
  } finally {
    if (bridge) await bridge.stop();
    if (beforeEngine === undefined) delete process.env.DASH_STT_ENGINE;
    else process.env.DASH_STT_ENGINE = beforeEngine;
    if (beforeFailure === undefined) delete process.env.DASH_STT_FIXTURE_FAIL_FILE;
    else process.env.DASH_STT_FIXTURE_FAIL_FILE = beforeFailure;
    if (beforeRetry === undefined) delete process.env.DASH_STT_RETRY_MS;
    else process.env.DASH_STT_RETRY_MS = beforeRetry;
    await rm(dir, { recursive: true, force: true });
  }
});
