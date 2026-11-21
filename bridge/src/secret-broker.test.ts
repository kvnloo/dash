// Secure sudo broker (#559). Cross-implementation: the phone's @noble seal (app/src/lib/secret-seal.ts)
// is opened by the bridge's node:crypto. The spawn is a recorder, so no real sudo runs here.
import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { SecretBroker, createSudoHttpHandler, displayCommand, validateSudoRun, type SudoSpawn } from "./secret-broker";
import { sealSecret } from "../../app/src/lib/secret-seal";
import type { SecretRequest, SecretResolved } from "../../shared/secret";

const random = (b: Uint8Array) => { b.set(randomBytes(b.length)); };
const tick = () => Bun.sleep(0);
function harness(spawnOut: { stdout?: string; stderr?: string; exitCode?: number } = {}, ttlMs = 5_000) {
  const calls: { cmd: string[]; stdin: string; cwd: string }[] = [];
  const logs: string[] = [];
  const wire: (SecretRequest | SecretResolved)[] = [];
  const spawn: SudoSpawn = async (cmd, { cwd, stdin }) => {
    calls.push({ cmd, stdin: stdin.toString("utf8"), cwd });
    return { exitCode: spawnOut.exitCode ?? 0, stdout: Buffer.from(spawnOut.stdout ?? "ok\n"), stderr: Buffer.from(spawnOut.stderr ?? "") };
  };
  const broker = new SecretBroker({ sudo: () => "/usr/bin/sudo", account: "kevin@studio", ttlMs, spawn, needsPassword: async () => true, log: (e, f) => logs.push(JSON.stringify({ e, ...f })) });
  broker.subscribe(m => wire.push(m));
  return { broker, calls, logs, wire };
}
const requestOf = (wire: (SecretRequest | SecretResolved)[]) => {
  const r = wire.find((m): m is SecretRequest => m.type === "secret_request");
  if (!r) throw Error("no request broadcast");
  return r;
};

describe("secure sudo broker", () => {
  test("phone seal opens on the bridge and goes only into sudo -k -S stdin; nothing else carries it", async () => {
    const h = harness({ stdout: "echoed hunter2-π secret\n" });
    const done = h.broker.requestSudo({ argv: ["apt", "install", "-y", "jq"], cwd: "/tmp", reason: "install jq" });
    await tick();
    const request = requestOf(h.wire);
    expect(request.command).toBe("apt install -y jq");
    expect(request.account).toBe("kevin@studio");
    await h.broker.submit(sealSecret(request, "hunter2-π", random));
    const result = await done;
    expect(result.outcome).toBe("delivered");
    expect(result.exitCode).toBe(0);
    expect(h.calls).toEqual([{ cmd: ["/usr/bin/sudo", "-k", "-S", "-p", "", "--", "apt", "install", "-y", "jq"], stdin: "hunter2-π\n", cwd: "/tmp" }]);
    expect(result.stdout).toBe("echoed [redacted] secret\n");
    const everythingElse = JSON.stringify({ result, wire: h.wire, logs: h.logs });
    expect(everythingElse).not.toContain("hunter2");
    expect(h.logs.join("\n")).not.toContain("apt");
    expect(h.broker.openCount()).toBe(0);
  });
  test("a seal for another request, a tampered ciphertext or a replay is refused", async () => {
    const h = harness();
    const a = h.broker.requestSudo({ argv: ["true"], cwd: "/" });
    const b = h.broker.requestSudo({ argv: ["false"], cwd: "/" });
    await tick();
    const [ra, rb] = h.wire.filter((m): m is SecretRequest => m.type === "secret_request");
    const sealedForA = sealSecret(ra!, "pw", random);
    await h.broker.submit({ ...sealedForA, id: rb!.id });
    expect((await b).outcome).toBe("failed");
    const tampered = sealSecret(ra!, "pw", random);
    const bytes = Buffer.from(tampered.ciphertext, "base64"); bytes[0]! ^= 1;
    await h.broker.submit({ ...tampered, ciphertext: bytes.toString("base64") });
    expect((await a).outcome).toBe("failed");
    await h.broker.submit(sealedForA);
    expect(h.calls).toEqual([]);
  });
  test("decline, expiry, missing sudo and the pending cap", async () => {
    const h = harness({}, 30);
    const declined = h.broker.requestSudo({ argv: ["id"], cwd: "/" });
    await tick();
    h.broker.cancel(requestOf(h.wire).id);
    expect((await declined).outcome).toBe("cancelled");
    expect((await h.broker.requestSudo({ argv: ["id"], cwd: "/" })).outcome).toBe("expired");
    const none = new SecretBroker({ sudo: () => null, account: "a@b" });
    const nopasswd: (SecretRequest | SecretResolved)[] = [];
    const open = new SecretBroker({ sudo: () => "/usr/bin/sudo", account: "a@b", needsPassword: async () => false });
    open.subscribe(m => nopasswd.push(m));
    const refused = await open.requestSudo({ argv: ["cat"], cwd: "/" });
    expect(refused.outcome, "NOPASSWD: never ask the phone for a password sudo would pass to the command").toBe("refused");
    expect(nopasswd).toEqual([]);
    expect((await none.requestSudo({ argv: ["id"], cwd: "/" })).outcome).toBe("refused");
    const capped = harness();
    for (let i = 0; i < 4; i++) void capped.broker.requestSudo({ argv: ["id"], cwd: "/" });
    expect((await capped.broker.requestSudo({ argv: ["id"], cwd: "/" })).outcome).toBe("refused");
    capped.broker.dispose();
  });
  test("argv cannot smuggle sudo options, NULs or relative cwd", () => {
    expect(typeof validateSudoRun({ argv: ["-s"] })).toBe("string");
    expect(typeof validateSudoRun({ argv: ["-A", "id"] })).toBe("string");
    expect(typeof validateSudoRun({ argv: ["cat", "a\0b"] })).toBe("string");
    expect(typeof validateSudoRun({ argv: ["id"], cwd: "rel" })).toBe("string");
    expect(typeof validateSudoRun({ argv: [] })).toBe("string");
    expect(validateSudoRun({ argv: ["systemctl", "restart", "x"], cwd: "/srv" })).toEqual({ argv: ["systemctl", "restart", "x"], cwd: "/srv" });
    expect(displayCommand(["sh", "-c", "echo 'hi there'"])).toBe("sh -c 'echo '\\''hi there'\\'''");
  });
  test("loopback route needs the bridge token, a loopback peer and no browser Origin", async () => {
    const h = harness();
    const route = createSudoHttpHandler({ token: "tok", broker: h.broker });
    const post = (headers: Record<string, string>, body = JSON.stringify({ argv: ["id"], cwd: "/" })) =>
      new Request("http://127.0.0.1:4748/secret/sudo", { method: "POST", headers, body });
    expect((await route(post({ Authorization: "Bearer nope" }), "127.0.0.1", () => {}))?.status).toBe(401);
    expect((await route(post({ Authorization: "Bearer tok", Origin: "http://evil" }), "127.0.0.1", () => {}))?.status).toBe(403);
    expect((await route(post({ Authorization: "Bearer tok" }), "100.64.0.9", () => {}))?.status).toBe(403);
    expect((await route(post({ Authorization: "Bearer tok" }, JSON.stringify({ argv: ["-s"] })), "127.0.0.1", () => {}))?.status).toBe(400);
    expect(await route(new Request("http://127.0.0.1:4748/notice"), "127.0.0.1", () => {})).toBeNull();
    let held = false;
    const pending = route(post({ Authorization: "Bearer tok" }), "127.0.0.1", () => { held = true; });
    await Bun.sleep(5);
    expect(held).toBe(true);
    h.broker.cancel(requestOf(h.wire).id);
    const response = await pending;
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ outcome: "cancelled", exitCode: null });
  });
});
