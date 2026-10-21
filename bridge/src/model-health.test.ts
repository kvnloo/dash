import { expect, test } from "bun:test";
import { modelHealth } from "./model-health";
test("health probes local inventory, caches, and never guesses cloud OAuth status", async () => {
  let requests = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { requests++; return Response.json({ data: [{ id: "health-test" }] }); } });
  const before = process.env.DASH_TINY_URL;
  process.env.DASH_TINY_URL = `http://127.0.0.1:${server.port}/v1`;
  try {
    expect(await modelHealth("local/health-test")).toBe("healthy");
    expect(await modelHealth("local/health-test")).toBe("healthy"); expect(requests).toBe(1);
    expect(await modelHealth("local/missing-test")).toBe("unavailable");
    expect(await modelHealth("openai-codex/gpt-6-luna")).toBe("unknown"); expect(requests).toBe(2);
  } finally { server.stop(true); if (before === undefined) delete process.env.DASH_TINY_URL; else process.env.DASH_TINY_URL = before; }
});
