import { describe, expect, test } from "bun:test";
import {
  LIMIT_LABEL,
  MAX_ATTACHMENT_BYTES,
  baseName,
  canSendDrafts,
  fileRefs,
  formatSize,
  isImage,
  nameFromUri,
  readyRefs,
  rejectReason,
  remainingSlots,
  sendToPhone,
  uploadAttachment,
  uploadUrl,
  type DraftAttachment,
} from "./attachments";

const ref = { id: "0123456789abcdef0123456789abcdef", name: "p.png", mime: "image/png", size: 4 };
const draft = (state: DraftAttachment["state"], extra: Partial<DraftAttachment> = {}): DraftAttachment => ({ key: Math.random().toString(), name: "p.png", mime: "image/png", uri: "file:///p.png", state, ...extra });

describe("limits", () => {
  test("labels the 25 MB cap", () => {
    expect(LIMIT_LABEL).toBe("25.0 MB");
    expect(formatSize(undefined)).toBe("");
    expect(formatSize(-1)).toBe("");
    expect(formatSize(900)).toBe("900 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
  test("rejects oversize and empty files with a clear message", () => {
    expect(rejectReason({ name: "a.mov", size: MAX_ATTACHMENT_BYTES + 1 })).toBe("a.mov is 25.0 MB. The limit is 25.0 MB per file.");
    expect(rejectReason({ name: "a.mov", size: MAX_ATTACHMENT_BYTES })).toBeNull();
    expect(rejectReason({ name: "a.txt", size: 0 })).toBe("a.txt is empty.");
    expect(rejectReason({ name: "a.txt" })).toBeNull();
  });
  test("counts remaining slots", () => {
    expect(remainingSlots([])).toBe(8);
    expect(remainingSlots(Array.from({ length: 8 }, () => draft("ready")))).toBe(0);
    expect(remainingSlots(Array.from({ length: 9 }, () => draft("ready")))).toBe(0);
  });
});

describe("drafts", () => {
  test("send needs text or a ready file and waits for uploads", () => {
    expect(canSendDrafts("", [])).toBe(false);
    expect(canSendDrafts(" hi ", [])).toBe(true);
    expect(canSendDrafts("", [draft("ready", { ref })])).toBe(true);
    expect(canSendDrafts("hi", [draft("uploading")])).toBe(false);
    expect(canSendDrafts("", [draft("error")])).toBe(false);
  });
  test("only ready refs are sent", () => {
    expect(readyRefs([draft("ready", { ref }), draft("error"), draft("uploading"), draft("ready")])).toEqual([ref]);
  });
  test("names and kinds", () => {
    expect(isImage("image/jpeg")).toBe(true);
    expect(isImage("text/plain")).toBe(false);
    expect(nameFromUri("file:///data/cache/My%20Photo.jpg?x=1")).toBe("My Photo.jpg");
    expect(nameFromUri("file:///data/%E0%A4%A.jpg")).toBe("%E0%A4%A.jpg");
    expect(nameFromUri("")).toBe("file");
    expect(uploadUrl("100.1.2.3:4747", "a b&c.png")).toBe("http://100.1.2.3:4747/attachments?name=a%20b%26c.png");
    expect(baseName("/a/b/c.png")).toBe("c.png");
  });
});

function fakeFetch(reply: { ok: boolean; status: number; body?: unknown; throws?: boolean }, size = 4) {
  const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: unknown } }[] = [];
  const impl = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
    calls.push({ url, init });
    if (!init) return { ok: true, status: 200, json: async () => ({}), blob: async () => new Blob([new Uint8Array(size)]) };
    if (reply.throws) throw new Error("net");
    return { ok: reply.ok, status: reply.status, json: async () => { if (reply.body === undefined) throw new Error("no json"); return reply.body; }, blob: async () => new Blob([]) };
  };
  return { calls, impl };
}

describe("uploadAttachment", () => {
  const settings = { address: "h:4747", token: "secret" };
  test("reads the picked uri and posts bytes with the bearer token", async () => {
    const { calls, impl } = fakeFetch({ ok: true, status: 200, body: ref });
    expect(await uploadAttachment(settings, { uri: "file:///p.png", name: "p.png", mime: "image/png" }, impl)).toEqual(ref);
    expect(calls[0]?.url).toBe("file:///p.png");
    expect(calls[1]?.url).toBe("http://h:4747/attachments?name=p.png");
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[1]?.init?.headers).toEqual({ Authorization: "Bearer secret", "Content-Type": "image/png" });
    expect(calls[1]?.init?.body).toBeInstanceOf(Blob);
  });
  test("uses a web File directly and defaults the type", async () => {
    const { calls, impl } = fakeFetch({ ok: true, status: 200, body: ref });
    await uploadAttachment(settings, { uri: "blob:x", name: "p", mime: "", blob: new Blob(["abcd"]) }, impl);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.headers?.["Content-Type"]).toBe("application/octet-stream");
  });
  test("refuses an oversize file before uploading", async () => {
    const { calls, impl } = fakeFetch({ ok: true, status: 200, body: ref }, MAX_ATTACHMENT_BYTES + 1);
    await expect(uploadAttachment(settings, { uri: "file:///big", name: "big.mov", mime: "video/mp4" }, impl)).rejects.toThrow("The limit is 25.0 MB per file.");
    expect(calls).toHaveLength(1);
  });
  test("surfaces bridge errors, network failures and bad replies", async () => {
    await expect(uploadAttachment(settings, { uri: "u", name: "a", mime: "x/y" }, fakeFetch({ ok: false, status: 413, body: { error: "File is larger than 25.0 MB." } }).impl)).rejects.toThrow("File is larger than 25.0 MB.");
    await expect(uploadAttachment(settings, { uri: "u", name: "a", mime: "x/y" }, fakeFetch({ ok: false, status: 401 }).impl)).rejects.toThrow("Pair again");
    await expect(uploadAttachment(settings, { uri: "u", name: "a", mime: "x/y" }, fakeFetch({ ok: false, status: 413 }).impl)).rejects.toThrow("Too large");
    await expect(uploadAttachment(settings, { uri: "u", name: "a", mime: "x/y" }, fakeFetch({ ok: false, status: 500 }).impl)).rejects.toThrow("Upload failed (500).");
    await expect(uploadAttachment(settings, { uri: "u", name: "a", mime: "x/y" }, fakeFetch({ ok: true, status: 200, throws: true }).impl)).rejects.toThrow("Could not reach the bridge");
    await expect(uploadAttachment(settings, { uri: "u", name: "a", mime: "x/y" }, fakeFetch({ ok: true, status: 200, body: { id: "x" } }).impl)).rejects.toThrow("unexpected reply");
  });
});

describe("sendToPhone", () => {
  const settings = { address: "h:4747", token: "secret" };
  test("posts the path and reports the bridge message", async () => {
    const { calls, impl } = fakeFetch({ ok: true, status: 200, body: { ok: true, message: "Sent to your phone with KDE Connect." } });
    expect(await sendToPhone(settings, "/w/out.png", impl)).toEqual({ ok: true, message: "Sent to your phone with KDE Connect." });
    expect(calls[0]?.url).toBe("http://h:4747/share");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ path: "/w/out.png" }));
  });
  test("reports refusals and failures", async () => {
    expect(await sendToPhone(settings, "/etc/x", fakeFetch({ ok: false, status: 403, body: { ok: false, message: "That folder is not shared with the phone." } }).impl)).toEqual({ ok: false, message: "That folder is not shared with the phone." });
    expect((await sendToPhone(settings, "/x", fakeFetch({ ok: false, status: 500 }).impl)).message).toBe("Upload failed (500).");
    expect((await sendToPhone(settings, "/x", fakeFetch({ ok: true, status: 200 }).impl)).message).toBe("Sent.");
    expect(await sendToPhone(settings, "/x", fakeFetch({ ok: true, status: 200, throws: true }).impl)).toEqual({ ok: false, message: "Could not reach the bridge." });
  });
});

describe("fileRefs", () => {
  test("finds absolute file paths in prose, code spans and parentheses", () => {
    const text = "Saved to /mnt/art/run/final.png and the log at `/tmp/run/out.log`. See (/home/u/docs/report.pdf).";
    expect(fileRefs(text)).toEqual(["/mnt/art/run/final.png", "/tmp/run/out.log", "/home/u/docs/report.pdf"]);
  });
  test("handles a path at the end of a sentence", () => {
    expect(fileRefs("Wrote /w/a/notes.md.")).toEqual(["/w/a/notes.md"]);
  });
  test("skips URLs, relative and home paths, directories, traversal and duplicates", () => {
    expect(fileRefs("https://x.com/a/b.png ~/a/b.png ./a/b.png /w/dir/ /w/a/../b.png /a.png")).toEqual([]);
    expect(fileRefs("/w/a/b.png /w/a/b.png")).toEqual(["/w/a/b.png"]);
  });
  test("caps the list", () => {
    expect(fileRefs("/a/1.txt /a/2.txt /a/3.txt /a/4.txt")).toHaveLength(3);
    expect(fileRefs("/a/1.txt /a/2.txt", 1)).toEqual(["/a/1.txt"]);
  });
});
