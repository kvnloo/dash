import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identityFixture } from "../../shared/identity-fixture.test-helper";
import { record } from "../../shared/z0bridge-identity";

for (const legacyEnabled of [true, false]) {
  test(`canonical entrypoint: scoped HTTP, header-only WS revocation, legacy=${legacyEnabled}`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "dash-identity-entry-"));
    const f = identityFixture(); let active = true; let introspections = 0;
    const introspector = `z0bc.cred_1111111111111111.${"i".repeat(43)}`;
    const authority = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      if (new URL(request.url).pathname === "/.well-known/jwks.json") return Response.json(f.jwks);
      if (request.headers.get("authorization") !== `Bearer ${introspector}`) return new Response(null, { status: 401 });
      introspections++;
      const body: unknown = await request.json();
      if (!record(body) || typeof body.token !== "string") return new Response(null, { status: 400 });
      const c: unknown = JSON.parse(Buffer.from(body.token.split(".")[1] ?? "", "base64url").toString());
      if (!record(c)) throw new Error("fixture claims missing");
      return Response.json({ active, token_type: "access", sub: c.sub, aud: c.aud, scope: c.scope, exp: c.exp });
    } });
    const authorityUrl = `http://127.0.0.1:${authority.port}`;
    const credentialPath = join(directory, "introspector.json");
    writeFileSync(credentialPath, JSON.stringify({ app: "dash", credential: introspector, scopes: ["z0bridge:introspect"], url: authorityUrl }), { mode: 0o600 });
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = reservation.port; reservation.stop(true);
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "index.ts")], {
      env: {
        ...process.env, HOME: directory, PATH: directory, DASH_STT_MODEL: join(directory, "no-model"),
        DASH_HOST: "127.0.0.1", DASH_ALLOW_LOOPBACK: "1", DASH_PORT: String(port), DASH_CREDENTIAL_DIR: join(directory, "dash"),
        DASH_GATE_ENABLED: "0", DASH_IDENTITY: "1", DASH_IDENTITY_URL: authorityUrl, DASH_IDENTITY_ISSUER: f.issuer,
        DASH_IDENTITY_KID: f.kid, DASH_IDENTITY_CREDENTIAL_FILE: credentialPath, DASH_IDENTITY_RECHECK_SECONDS: "1", DASH_LEGACY_TOKEN: legacyEnabled ? "1" : "0",
      }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const stdout = new Response(proc.stdout).text(); const stderr = new Response(proc.stderr).text();
    const deadline = setTimeout(() => proc.kill("SIGKILL"), 7000);
    const sockets: WebSocket[] = [];
    try {
      const base = `http://127.0.0.1:${port}`;
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try { ready = (await fetch(base)).status === 401; if (ready) break; } catch { /* isolated child binding */ }
        await Bun.sleep(10);
      }
      expect(ready).toBe(true);
      const legacy = readFileSync(join(directory, "dash", "token"), "utf8").trim();
      const bootstrap = readFileSync(join(directory, "dash", "bootstrap-token"), "utf8").trim();
      const token = f.token(); const headers = { authorization: `Bearer ${token}` };
      expect((await fetch(`${base}/roster`, { headers })).status).toBe(200);
      expect(introspections).toBe(0); // HTTP is offline
      expect((await fetch(`${base}/roster?token=${token}`)).status).toBe(401);
      expect((await fetch(`${base}/ws?token=${token}`)).status).toBe(401);
      expect((await fetch(`${base}/roster`, { headers: { authorization: `Bearer ${f.token({ aud: "noop" })}` } })).status).toBe(401);
      expect((await fetch(`${base}/roster?token=${legacy}`)).status).toBe(legacyEnabled ? 200 : 401);
      expect((await fetch(`${base}/pair`, { headers: { authorization: `Bearer ${bootstrap}` } })).status).toBe(legacyEnabled ? 200 : 401);
      expect((await fetch(`${base}/attachments?name=fixture.txt`, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "isolated attachment" })).status).toBe(200);
      expect((await fetch(`${base}/attachments?name=bad.txt&token=${token}`, { method: "POST", body: "denied" })).status).toBe(401);
      expect((await fetch(`${base}/attachments?name=legacy.txt`, { method: "POST", headers: { authorization: `Bearer ${legacy}`, "content-type": "text/plain" }, body: "legacy fixture" })).status).toBe(legacyEnabled ? 200 : 401);
      expect((await fetch(`${base}/ws`, { headers: { ...headers, origin: "http://evil.example" } })).status).toBe(403);
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers }); sockets.push(ws);
      const closed = new Promise<number>(resolve => { ws.onclose = e => resolve(e.code); });
      await new Promise<void>((resolve, reject) => { ws.onmessage = () => resolve(); ws.onerror = () => reject(new Error("identity WS failed")); });
      expect(introspections).toBe(1);
      active = false;
      expect(await closed).toBe(1008);
      expect(introspections).toBeGreaterThanOrEqual(2);
      expect((await fetch(`${base}/ws`, { headers })).status).toBe(401);
      if (legacyEnabled) {
        const old = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${legacy}`); sockets.push(old);
        await new Promise<void>((resolve, reject) => { old.onmessage = () => resolve(); old.onerror = () => reject(new Error("legacy WS failed")); });
        expect(old.readyState).toBe(WebSocket.OPEN);
      }
      for (const socket of sockets) socket.close();
      proc.kill("SIGTERM"); await proc.exited;
      const output = `${await stdout}\n${await stderr}`;
      for (const secret of [token, legacy, bootstrap, introspector]) expect(output.includes(secret)).toBe(false);
    } finally {
      clearTimeout(deadline);
      for (const socket of sockets) socket.close();
      if (proc.exitCode === null) { proc.kill("SIGKILL"); await proc.exited; }
      await Promise.all([stdout, stderr]); authority.stop(true);
      rmSync(directory, { recursive: true, force: true });
    }
  }, 10000);
}
