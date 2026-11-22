// DA-002: real Expo web + authenticated Dash bridge, with fixture Realtime and z0bridge lanes.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { record } from "../../shared/z0bridge-identity";
import { test as base, expect, pair } from "./fixtures";
import { startFixtureZ0liveBroker, type FixtureZ0liveBroker } from "./fixture-z0live-broker";

async function startLanes(overlap: number, rejectCerebras: boolean) {
  const token = randomUUID();
  const dir = await mkdtemp(join(tmpdir(), "army-z0bridge-turbo-"));
  const tokenFile = join(dir, "token");
  await writeFile(tokenFile, token, { mode: 0o600 });
  const started: string[] = [];
  const waiting: { profile: string; response: ServerResponse }[] = [];
  const prompts: string[] = [];
  let observedOverlap = 0;
  const server = createServer(async (request, response) => {
    const json = (status: number, value: object) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
    if (request.headers.authorization !== `Bearer ${token}`) return json(401, {});
    if (request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const data of request) chunks.push(Buffer.from(data));
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
      if (request.url === "/v1/sessions" && record(body) && body.harness === "hermes" && typeof body.profile === "string") {
        return json(201, { id: `session-${body.profile}` });
      }
      const turn = /^\/v1\/sessions\/hermes\/([\w-]+)\/session-\1\/turns$/.exec(request.url ?? "");
      if (turn && record(body) && typeof body.text === "string") {
        const profile = turn[1];
        started.push(profile);
        prompts.push(body.text);
        if (rejectCerebras && profile === "cerebras-free") return json(429, { error: { code: "queue_full" } });
        return json(202, { turnId: profile });
      }
    }
    const turn = /^\/v1\/turns\/([\w-]+)\/events$/.exec(request.url ?? "");
    if (request.method === "GET" && turn) {
      const profile = turn[1];
      response.writeHead(200, { "content-type": "text/event-stream" });
      const finish = (entry: { profile: string; response: ServerResponse }) => {
        const events = [{ seq: 1, type: "delta", text: `Fixture answer from ${entry.profile}` }, { seq: 2, type: "done", stopReason: "end_turn" }];
        entry.response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
      };
      if (profile === "opus-meta") { finish({ profile, response }); return; }
      // No worker is allowed to finish before the other expected workers are in flight.
      waiting.push({ profile, response });
      observedOverlap = Math.max(observedOverlap, waiting.length);
      if (waiting.length === overlap) waiting.splice(0).forEach(finish);
      return;
    }
    return json(404, {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No fixture lane port");
  return {
    env: { DASH_Z0BRIDGE_URL: `http://127.0.0.1:${address.port}`, DASH_Z0BRIDGE_TOKEN_FILE: tokenFile,
      DASH_TURBO_FREE_LANES: "groq:groq-free,cerebras:cerebras-free,opencode:deepseek-free", DASH_TURBO_META_PROFILE: "opus-meta" },
    started, prompts, overlap: () => observedOverlap,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const test = base.extend<{
  wide: boolean;
  lanes: Awaited<ReturnType<typeof startLanes>>;
  voiceBroker: FixtureZ0liveBroker;
}>({
  wide: [false, { option: true }],
  lanes: async ({ wide }, use) => {
    const lanes = await startLanes(wide ? 3 : 2, !wide);
    try { await use(lanes); } finally { await lanes.stop(); }
  },
  voiceBroker: async ({}, use) => {
    const broker = await startFixtureZ0liveBroker();
    try { await use(broker); } finally { await broker.stop(); }
  },
  bridgeOptions: async ({ lanes, voiceBroker }, use) => {
    await use({ identity: true, env: { ...lanes.env, DASH_NATIVE_VOICE: "1", DASH_ARMY_VOICE_WEB: "1", DASH_Z0LIVE_BROKER: voiceBroker.origin } });
  },
});

for (const wide of [false, true]) {
  test.describe(wide ? "long spoken task" : "short spoken task", () => {
    test.use({ wide });
    test(wide ? "z0live Turbo scales up to three parallel provider lanes" : "z0live Turbo replaces a throttled lane with a free provider", async ({ page, bridge, lanes, voiceBroker }, info) => {
      const task = wide
        ? "Compare three approaches to simplifying a settings screen. Include a view of navigation hierarchy, accessibility tradeoffs, and the smallest meaningful validation plan."
        : "Compare ways to make this label clearer";
      const dash = bridge.identityToken();
      const z0live = bridge.identityToken({ aud: "z0live", scope: "z0live:voice" });
      voiceBroker.authorize(z0live);
      await page.addInitScript(({ dash, z0live, task }) => {
        Object.defineProperty(window, "__dashVoiceArmy", { value: { dash, z0live, identity: { credentialId: "cred_armyturborun" } } });
        Object.defineProperty(window, "__dashVoiceSay", { value: `Turbo, ${task}` });
      }, { dash, z0live, task });
      await pair(page, bridge);
      await page.getByTestId("chats-pane").locator('[data-testid^="chat-row-"]').filter({ hasText: "ARMY native fixture" }).click({ noWaitAfter: true });
      await expect(page.getByTestId("chat-window")).toBeVisible();
      await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });
      await page.getByRole("tab").nth(0).click({ noWaitAfter: true });
      await page.getByRole("button", { name: "Expand", exact: true }).click({ noWaitAfter: true });
      await page.getByRole("button", { name: "Start voice in Dash", exact: true }).click({ noWaitAfter: true });

      const count = wide ? 3 : 2;
      const providers = wide ? "groq, cerebras, opencode" : "groq, opencode";
      await expect(page.getByTestId("voice-turbo-status")).toHaveText(new RegExp(
        `Turbo: ${count} of ${count} started lanes completed \\(${providers}\\)\\. Finished at \\d{2}:\\d{2}:\\d{2} UTC in \\d+\\.\\ds\\.`), { timeout: 30_000 });
      expect(lanes.overlap()).toBe(count);
      expect(lanes.started.slice(0, -1).sort()).toEqual(["cerebras-free", "deepseek-free", "groq-free"]);
      expect(lanes.started.at(-1)).toBe("opus-meta");
      expect(lanes.prompts.every(text => text.includes(task))).toBe(true);
      expect(lanes.prompts.at(-1)).toContain("Fixture answer from deepseek-free");
      expect(voiceBroker.calls().filter(call => call.path === "/v1/tools/ask_z0")).toHaveLength(0);
      const trace = bridge.logs().split("\n").filter(line => line.includes("turbo."));
      for (const provider of providers.split(", ")) expect(trace.some(line => line.includes("turbo.lane.completed") && line.includes(`provider=${provider} role=worker`))).toBe(true);
      if (!wide) expect(trace.some(line => line.includes("turbo.lane.failed") && line.includes("provider=cerebras role=worker"))).toBe(true);
      await info.attach("turbo-trace", { body: trace.join("\n"), contentType: "text/plain" });
      await page.screenshot({ path: info.outputPath("final.png") });
    });
  });
}
