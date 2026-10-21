import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AttachmentStore } from "./attachments";
import { createFilesHttpHandler } from "./files-http";
import { parseChatAttachment } from "../../shared/protocol";

test("real isolated HTTP upload rejects the phone's error body and stores real PNG bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "dash-upload-"));
  const store = new AttachmentStore(root);
  const token = crypto.randomUUID();
  const handler = createFilesHttpHandler({ token, store, shareRoots: () => [], run: async () => ({ code: 0, stdout: "", stderr: "" }) });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (req) => await handler(req) ?? new Response("not found", { status: 404 }) });
  try {
    const url = `http://127.0.0.1:${server.port}/attachments?name=25486.png`;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" };
    const bad = await fetch(url, { method: "POST", headers, body: "File not found" });
    expect(bad.status).toBe(415);
    expect(await bad.json()).toMatchObject({ error: expect.stringContaining("Select it again") });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afoQAAAAASUVORK5CYII=", "base64");
    const good = await fetch(url, { method: "POST", headers, body: png });
    expect(good.status).toBe(200);
    const ref = parseChatAttachment(await good.json());
    expect(ref).not.toBeNull();
    if (!ref) throw new Error("missing reference");
    expect(ref.mime).toBe("image/png");
    expect(ref.size).toBe(png.length);
    const claimed = store.claim("isolated-proof", [ref]);
    expect(readFileSync(claimed[0]!.path)).toEqual(png);
    console.log(`isolated HTTP: corrupt image 415; PNG 200, ${ref.size} bytes, claimed bytes match`);
  } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); }
});
