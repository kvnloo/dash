import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Z0BridgeHermes } from "./z0bridge-hermes";

test("explicit local Hermes enrollment replaces owner auth and never falls back to it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dash-scoped-hermes-"));
  const credential = `z0bc.cred_0123456789abcdef.${"e".repeat(43)}`;
  const seen: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/v1/health") return Response.json({ ok: true, name: "z0bridge", version: "test", api: "v1" });
    const auth = request.headers.get("authorization") ?? "";
    seen.push(auth);
    if (auth !== `Bearer ${credential}`) return new Response(null, { status: 401 });
    return Response.json({ sessions: [] });
  } });
  try {
    const path = join(dir, "credential.json"); const owner = join(dir, "old-owner");
    writeFileSync(owner, "owner-fixture", { mode: 0o600 });
    const base = `http://127.0.0.1:${server.port}`;
    const data = { app: "dash", url: base, credential, scopes: ["hermes:sessions.read", "hermes:turns"] };
    writeFileSync(path, JSON.stringify(data), { mode: 0o600 });
    const env = { DASH_Z0BRIDGE_URL: base, DASH_Z0BRIDGE_CREDENTIAL_FILE: path, DASH_Z0BRIDGE_TOKEN_FILE: owner };
    expect(await new Z0BridgeHermes({ env }).list()).toEqual([]);
    expect(seen).toEqual([`Bearer ${credential}`]);
    seen.length = 0;
    for (const bad of [{ ...data, scopes: ["hermes:sessions.read"] }, { ...data, app: "noop" }, { ...data, credential: "bad" }]) {
      writeFileSync(path, JSON.stringify(bad));
      expect(await new Z0BridgeHermes({ env }).list()).toBeUndefined();
    }
    writeFileSync(path, JSON.stringify(data)); chmodSync(path, 0o644);
    expect(await new Z0BridgeHermes({ env }).list()).toBeUndefined();
    expect(seen).toEqual([]);
  } finally { server.stop(true); rmSync(dir, { recursive: true, force: true }); }
});
