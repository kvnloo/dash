import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachmentStore } from "./attachments";
import { createFilesHttpHandler } from "./files-http";
import { MAX_SHARE_BYTES, checkShareable, defaultShareDirs, pickDevice, shareRoots, shareToPhone, type Run } from "./share";

let dir = "";
beforeEach(() => { dir = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "dash-share-"))); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function tree() {
  const shared = join(dir, "shared");
  const other = join(dir, "other");
  mkdirSync(join(shared, "sub"), { recursive: true });
  mkdirSync(join(shared, ".git"), { recursive: true });
  mkdirSync(other, { recursive: true });
  writeFileSync(join(shared, "sub", "render.png"), "png");
  writeFileSync(join(shared, ".git", "config"), "x");
  writeFileSync(join(shared, "api.token"), "x");
  writeFileSync(join(shared, "prod.env"), "x");
  writeFileSync(join(shared, "server.pem"), "x");
  writeFileSync(join(other, "private.txt"), "x");
  symlinkSync(join(other, "private.txt"), join(shared, "link.txt"));
  return { shared, other };
}

describe("shareRoots", () => {
  test("keeps real existing absolute directories and refuses / and home", () => {
    const { shared, other } = tree();
    expect(shareRoots([shared, "relative/dir", join(dir, "missing"), "/", dir], `${other}::${shared}`, dir)).toEqual([shared, other]);
    expect(shareRoots([], undefined, dir)).toEqual([]);
  });
  test("defaults cover cwd, attachments and user folders", () => {
    expect(defaultShareDirs("/w", "/h/.dash/attachments", "/h")).toEqual(["/w", "/h/.dash/attachments", "/h/Downloads", "/h/Pictures", "/h/Documents"]);
  });
});

describe("checkShareable", () => {
  test("allows a real file inside a root", () => {
    const { shared } = tree();
    expect(checkShareable(join(shared, "sub", "render.png"), [shared])).toEqual({ ok: true, path: join(shared, "sub", "render.png"), size: 3 });
  });
  test("refuses paths outside roots, including through symlinks and traversal", () => {
    const { shared, other } = tree();
    expect(checkShareable(join(other, "private.txt"), [shared])).toMatchObject({ ok: false, status: 403 });
    expect(checkShareable(join(shared, "link.txt"), [shared])).toMatchObject({ ok: false, status: 403 });
    expect(checkShareable(join(shared, "..", "other", "private.txt"), [shared])).toMatchObject({ ok: false, status: 403 });
    expect(checkShareable(shared, [shared])).toMatchObject({ ok: false, status: 403 });
  });
  test("refuses hidden and credential-looking files", () => {
    const { shared } = tree();
    for (const p of [join(shared, ".git", "config"), join(shared, "api.token"), join(shared, "prod.env"), join(shared, "server.pem")]) {
      expect(checkShareable(p, [shared])).toMatchObject({ ok: false, status: 403, message: "Hidden and credential files are never sent." });
    }
  });
  test("refuses malformed input, directories and missing files", () => {
    const { shared } = tree();
    expect(checkShareable(undefined, [shared])).toMatchObject({ ok: false, status: 400 });
    expect(checkShareable("", [shared])).toMatchObject({ ok: false, status: 400 });
    expect(checkShareable("sub/render.png", [shared])).toMatchObject({ ok: false, status: 400 });
    expect(checkShareable(`${shared}/a\0b`, [shared])).toMatchObject({ ok: false, status: 400 });
    expect(checkShareable(`/${"a".repeat(5000)}`, [shared])).toMatchObject({ ok: false, status: 400 });
    expect(checkShareable(join(shared, "nope.txt"), [shared])).toMatchObject({ ok: false, status: 404 });
    expect(checkShareable(join(shared, "sub"), [join(dir)])).toMatchObject({ ok: false, status: 400 });
    expect(MAX_SHARE_BYTES).toBe(200 * 1024 * 1024);
  });
});

describe("KDE Connect", () => {
  const calls: string[][] = [];
  const run = (stdout: string, code = 0): Run => async argv => { calls.push(argv); return { code, stdout, stderr: "" }; };
  test("uses the configured device or the only reachable one", async () => {
    expect(await pickDevice("e899270776ad459a", run(""))).toBe("e899270776ad459a");
    expect(await pickDevice("bad id;rm", run(""))).toBeNull();
    expect(await pickDevice(undefined, run("abcdef123456\n"))).toBe("abcdef123456");
    expect(await pickDevice(undefined, run("abcdef123456\nfedcba654321\n"))).toBeNull();
    expect(await pickDevice(undefined, run("", 1))).toBeNull();
    expect(await pickDevice(undefined, async () => { throw new Error("missing"); })).toBeNull();
  });
  test("shares with argv, never a shell", async () => {
    calls.length = 0;
    expect(await shareToPhone("/a b/$(x).png", "dev12345", run(""))).toEqual({ ok: true, message: "Sent to your phone with KDE Connect." });
    expect(calls[0]).toEqual(["kdeconnect-cli", "-d", "dev12345", "--share", "/a b/$(x).png"]);
    expect((await shareToPhone("/a", "d", run("", 1))).ok).toBe(false);
    expect((await shareToPhone("/a", "d", async () => { throw new Error("x"); })).message).toContain("not installed");
  });
});

describe("files HTTP routes", () => {
  const TOKEN = "t".repeat(43);
  function handler(run: Run = async () => ({ code: 0, stdout: "dev12345\n", stderr: "" })) {
    const { shared } = tree();
    const store = new AttachmentStore(join(dir, "attachments"));
    return { shared, store, handle: createFilesHttpHandler({ token: TOKEN, store, shareRoots: () => [shared], run }) };
  }
  const auth = { authorization: `Bearer ${TOKEN}` };

  test("ignores other paths", async () => {
    const { handle } = handler();
    expect(await handle(new Request("http://h/roster"))).toBeNull();
  });
  test("requires the execution bearer token and POST", async () => {
    const { handle } = handler();
    expect((await handle(new Request("http://h/attachments?name=a", { method: "POST", body: "x" })))?.status).toBe(401);
    expect((await handle(new Request(`http://h/attachments?name=a&token=${TOKEN}`, { method: "POST", body: "x" })))?.status).toBe(401);
    expect((await handle(new Request("http://h/share", { headers: auth })))?.status).toBe(405);
  });
  test("stores an upload and returns its reference", async () => {
    const { handle, store } = handler();
    const res = await handle(new Request("http://h/attachments?name=..%2Fnote.txt", { method: "POST", headers: { ...auth, "content-type": "text/plain" }, body: "hello" }));
    expect(res?.status).toBe(200);
    const body = await res?.json();
    expect(body).toMatchObject({ name: "note.txt", mime: "text/plain", size: 5 });
    expect(store.claim("t", [body as never])[0]?.name).toBe("note.txt");
  });
  test("rejects an oversize declared upload", async () => {
    const { handle } = handler();
    const res = await handle(new Request("http://h/attachments?name=a", { method: "POST", headers: { ...auth, "content-length": String(26 * 1024 * 1024) }, body: "x" }));
    expect(res?.status).toBe(413);
  });
  test("shares an allowlisted file and refuses others", async () => {
    const calls: string[][] = [];
    const { handle, shared } = handler(async argv => { calls.push(argv); return { code: 0, stdout: "dev12345\n", stderr: "" }; });
    const ok = await handle(new Request("http://h/share", { method: "POST", headers: auth, body: JSON.stringify({ path: join(shared, "sub", "render.png") }) }));
    expect(ok?.status).toBe(200);
    expect(calls.at(-1)).toEqual(["kdeconnect-cli", "-d", "dev12345", "--share", join(shared, "sub", "render.png")]);
    const denied = await handle(new Request("http://h/share", { method: "POST", headers: auth, body: JSON.stringify({ path: "/etc/passwd" }) }));
    expect(denied?.status).toBe(403);
    const bad = await handle(new Request("http://h/share", { method: "POST", headers: auth, body: "{" }));
    expect(bad?.status).toBe(400);
  });
  test("reports when no single phone is reachable", async () => {
    const { handle, shared } = handler(async () => ({ code: 0, stdout: "", stderr: "" }));
    const res = await handle(new Request("http://h/share", { method: "POST", headers: auth, body: JSON.stringify({ path: join(shared, "sub", "render.png") }) }));
    expect(res?.status).toBe(503);
  });
});
