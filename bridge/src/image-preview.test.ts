import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachmentStore } from "./attachments";
import { createFilesHttpHandler } from "./files-http";
import { MAX_PREVIEW_BYTES } from "./image-preview";

test("authenticated image preview: real bytes, MIME sniffing, roots, secrets, symlinks and bounds", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dash-images-")));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "dash-outside-")));
  const token = crypto.randomUUID();
  const handler = createFilesHttpHandler({ token, store: new AttachmentStore(join(root, "attachments")), shareRoots: () => [root], run: async () => ({ code: 0, stdout: "", stderr: "" }) });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async req => await handler(req) ?? new Response("not found", { status: 404 }) });
  try {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afoQAAAAASUVORK5CYII=", "base64");
    writeFileSync(join(root, "test.png"), png); writeFileSync(join(outside, "test.png"), png);
    writeFileSync(join(root, ".secret.png"), png); writeFileSync(join(root, "token.png"), png);
    writeFileSync(join(root, "fake.png"), "<svg onload='alert(1)'/>");
    writeFileSync(join(root, "large.png"), Buffer.alloc(MAX_PREVIEW_BYTES + 1));
    symlinkSync(join(outside, "test.png"), join(root, "escape.png"));
    const url = (path: string) => `http://127.0.0.1:${server.port}/files?path=${encodeURIComponent(path)}`;
    expect((await fetch(url(join(root, "test.png")))).status).toBe(401);
    const get = (path: string) => fetch(url(path), { headers: { Authorization: `Bearer ${token}` } });
    const response = await get(join(root, "test.png"));
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("image/png"); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    for (const name of [".secret.png", "token.png", "escape.png"]) expect((await get(join(root, name))).status).toBe(403);
    expect((await get(join(outside, "test.png"))).status).toBe(403);
    expect((await get(join(root, "fake.png"))).status).toBe(415);
    expect((await get(join(root, "large.png"))).status).toBe(413);
    expect((await get(join(root, "missing.png"))).status).toBe(404);
    expect((await fetch(url(join(root, "test.png")), { method: "POST", headers: { Authorization: `Bearer ${token}` } })).status).toBe(405);
  } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
