import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttachmentError,
  AttachmentStore,
  MAX_ATTACHMENT_BYTES,
  MAX_NAME_LENGTH,
  STAGING_TTL_MS,
  formatBytes,
  isImageMime,
  promptWithAttachments,
  sanitizeFileName,
  sanitizeMime,
  turnDirName,
} from "./attachments";

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "dash-attach-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const mode = (path: string) => statSync(path).mode & 0o777;

describe("sanitizeFileName", () => {
  test("keeps ordinary names", () => {
    expect(sanitizeFileName("photo.png")).toBe("photo.png");
    expect(sanitizeFileName("Q3 report (final).pdf")).toBe("Q3 report (final).pdf");
    expect(sanitizeFileName("café.txt")).toBe("café.txt");
  });
  test("strips directories, traversal and hidden prefixes", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\me\\secret.txt")).toBe("secret.txt");
    expect(sanitizeFileName("..")).toBe("file");
    expect(sanitizeFileName(".")).toBe("file");
    expect(sanitizeFileName(".bashrc")).toBe("bashrc");
    expect(sanitizeFileName("  ...  .x")).toBe("x");
    expect(sanitizeFileName("")).toBe("file");
    expect(sanitizeFileName("dir/")).toBe("file");
  });
  test("removes control characters and shell metacharacters", () => {
    expect(sanitizeFileName("a\u0000b\nc.txt")).toBe("abc.txt");
    expect(sanitizeFileName("x$(rm -rf);`y`|z&.sh")).toBe("x_(rm -rf)_y_z_.sh");
    expect(sanitizeFileName("a   b\tc.md")).toBe("a b c.md");
    expect(sanitizeFileName("a***b.md")).toBe("a_b.md");
  });
  test("bounds the length and keeps a short extension", () => {
    const long = sanitizeFileName(`${"a".repeat(300)}.jpeg`);
    expect(long.length).toBe(MAX_NAME_LENGTH);
    expect(long.endsWith(".jpeg")).toBe(true);
    const noExt = sanitizeFileName("b".repeat(300));
    expect(noExt).toBe("b".repeat(MAX_NAME_LENGTH));
    expect(sanitizeFileName(`${"c".repeat(200)}.${"d".repeat(20)}`).length).toBe(MAX_NAME_LENGTH);
  });
});

describe("sanitizeMime / isImageMime / turnDirName / formatBytes", () => {
  test("mime", () => {
    expect(sanitizeMime("image/PNG")).toBe("image/png");
    expect(sanitizeMime("text/plain; charset=utf-8")).toBe("text/plain");
    expect(sanitizeMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(sanitizeMime("nonsense")).toBe("application/octet-stream");
    expect(sanitizeMime("text/<script>")).toBe("application/octet-stream");
    expect(sanitizeMime(null)).toBe("application/octet-stream");
    expect(sanitizeMime(`a/${"b".repeat(120)}`)).toBe("application/octet-stream");
  });
  test("images", () => {
    for (const m of ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/heic"]) expect(isImageMime(m)).toBe(true);
    expect(isImageMime("image/svg+xml")).toBe(false);
    expect(isImageMime("text/plain")).toBe(false);
  });
  test("turn directory names stay one plain component", () => {
    expect(turnDirName("mh2x-abc_1")).toBe("mh2x-abc_1");
    expect(turnDirName("../../x")).toBe("______x");
    expect(turnDirName("/")).toBe("turn");
    expect(turnDirName("")).toBe("turn");
    expect(turnDirName("a".repeat(100))).toHaveLength(64);
  });
  test("bytes", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(MAX_ATTACHMENT_BYTES)).toBe("25.0 MB");
  });
});

describe("promptWithAttachments", () => {
  const file = { id: "a".repeat(32), name: "p.png", mime: "image/png", size: 2048, path: "/home/u/.dash/attachments/t1/p.png" };
  test("unchanged without files", () => {
    expect(promptWithAttachments("hi", [])).toBe("hi");
  });
  test("lists absolute paths after the text", () => {
    const text = promptWithAttachments("what is this?", [file]);
    expect(text.startsWith("what is this?\n\n")).toBe(true);
    expect(text).toContain("- /home/u/.dash/attachments/t1/p.png (image/png, 2.0 KB)");
  });
  test("gives an empty prompt a request", () => {
    expect(promptWithAttachments("  ", [file]).startsWith("Please look at the attached file.")).toBe(true);
    expect(promptWithAttachments("", [file, { ...file, path: "/x/q.txt" }]).startsWith("Please look at the attached files.")).toBe(true);
  });
});

describe("AttachmentStore", () => {
  test("stores uploads privately and claims them into the turn directory", () => {
    const store = new AttachmentStore(join(dir, "attachments"));
    const ref = store.put("../evil/notes.txt", "text/plain", new TextEncoder().encode("hello"));
    expect(ref).toMatchObject({ name: "notes.txt", mime: "text/plain", size: 5 });
    expect(ref.id).toMatch(/^[a-f0-9]{32}$/);
    expect(mode(store.root)).toBe(0o700);
    expect(mode(join(store.root, "staging", ref.id))).toBe(0o700);
    const [claimed] = store.claim("turn-1", [ref]);
    expect(claimed?.path).toBe(join(store.root, "turn-1", "notes.txt"));
    expect(readFileSync(claimed?.path ?? "", "utf8")).toBe("hello");
    expect(mode(claimed?.path ?? "")).toBe(0o600);
    expect(mode(join(store.root, "turn-1"))).toBe(0o700);
    expect(existsSync(join(store.root, "staging", ref.id))).toBe(false);
  });

  test("a claimed or unknown id cannot be claimed again", () => {
    const store = new AttachmentStore(join(dir, "a"));
    const ref = store.put("a.txt", "text/plain", new Uint8Array([1]));
    store.claim("t", [ref]);
    expect(() => store.claim("t2", [ref])).toThrow(AttachmentError);
    expect(() => store.claim("t2", [{ ...ref, id: "b".repeat(32) }])).toThrow("no longer on the host");
    expect(() => store.claim("t2", [{ ...ref, id: "../../etc" }])).toThrow("Invalid attachment id");
  });

  test("fails a whole turn without half-claiming", () => {
    const store = new AttachmentStore(join(dir, "a"));
    const good = store.put("a.txt", "text/plain", new Uint8Array([1]));
    expect(() => store.claim("t", [good, { ...good, id: "c".repeat(32) }])).toThrow(AttachmentError);
    expect(existsSync(join(store.root, "staging", good.id, "a.txt"))).toBe(true);
    expect(store.claim("t", [])).toEqual([]);
  });

  test("dedupes clashing names inside one turn", () => {
    const store = new AttachmentStore(join(dir, "a"));
    const one = store.put("x.png", "image/png", new Uint8Array([1]));
    const two = store.put("x.png", "image/png", new Uint8Array([2]));
    const three = store.put("x", "image/png", new Uint8Array([3]));
    const four = store.put("x", "image/png", new Uint8Array([4]));
    const names = store.claim("t", [one, two, three, four]).map(f => f.name);
    expect(names).toEqual(["x.png", "x (2).png", "x", "x (2)"]);
    expect(readdirSync(join(store.root, "t")).sort()).toEqual(["x", "x (2)", "x (2).png", "x.png"]);
  });

  test("refuses oversize data", () => {
    const store = new AttachmentStore(join(dir, "a"));
    expect(() => store.put("big", null, new Uint8Array(MAX_ATTACHMENT_BYTES + 1))).toThrow("larger than 25.0 MB");
  });

  test("upload streams a body and enforces the cap and declared length", async () => {
    const store = new AttachmentStore(join(dir, "a"));
    const ok = await store.upload(new Response("abc").body, "3", "a.txt", "text/plain; charset=utf-8");
    expect(ok).toMatchObject({ name: "a.txt", mime: "text/plain", size: 3 });
    await expect(store.upload(new Response("abc").body, String(MAX_ATTACHMENT_BYTES + 1), "a", null)).rejects.toMatchObject({ status: 413 });
    await expect(store.upload(new Response("abc").body, "-1", "a", null)).rejects.toMatchObject({ status: 413 });
    await expect(store.upload(null, null, "a", null)).rejects.toMatchObject({ status: 400 });
    const big = new Response(new Uint8Array(MAX_ATTACHMENT_BYTES + 10)).body;
    await expect(store.upload(big, null, "a", null)).rejects.toMatchObject({ status: 413 });
  });

  test("prunes stale staged uploads but keeps fresh ones", () => {
    let now = 1_000_000;
    const store = new AttachmentStore(join(dir, "a"), () => now);
    const old = store.put("old.txt", null, new Uint8Array([1]));
    now += STAGING_TTL_MS + 1;
    const fresh = store.put("new.txt", null, new Uint8Array([1]));
    expect(existsSync(join(store.root, "staging", old.id))).toBe(false);
    expect(existsSync(join(store.root, "staging", fresh.id))).toBe(true);
    expect(store.prune()).toBe(0);
    // A staging dir without metadata ages by mtime.
    const later = new AttachmentStore(join(dir, "a"), () => Date.now() + STAGING_TTL_MS);
    const orphan = join(store.root, "staging", "orphan");
    mkdirSync(orphan);
    const past = (Date.now() - STAGING_TTL_MS) / 1000;
    utimesSync(orphan, past, past);
    expect(later.prune()).toBe(2);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(join(store.root, "staging", fresh.id))).toBe(false);
    expect(new AttachmentStore(join(dir, "missing")).prune()).toBe(0);
  });
});
