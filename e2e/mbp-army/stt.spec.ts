import { test, expect, pair } from "./fixtures";
import { readFile } from "node:fs/promises";
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
