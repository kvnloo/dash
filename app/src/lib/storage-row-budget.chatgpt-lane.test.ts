import { describe, expect, test } from "bun:test";
import {

// Large-payload test: correctness is load-independent; 5 s default timed out at load ~37 on MBP fleet.
const HEAVY_TEST_TIMEOUT_MS = 30_000;
  ROW_BYTE_LIMIT,
  chunkRow,
  fitRecord,
  joinChunks,
  truncateUtf8,
  utf8Bytes,
} from "./storage-row-budget";

interface Draft {
  text: string;
  at: number;
}

function encode(row: Record<string, Draft>): string {
  return JSON.stringify(row) ?? "{}";
}

function wellFormedUtf16(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (next < 0xdc00 || next > 0xdfff || Number.isNaN(next)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

describe("CursorWindow storage row budget", () => {
  test("UTF-8 sizing includes code-point widths and replacement for a lone surrogate", () => {
    expect(ROW_BYTE_LIMIT).toBe(512 * 1024);
    expect(utf8Bytes("Aé中🙂")).toBe(10);
    expect(utf8Bytes("\ud800")).toBe(3);
    expect(utf8Bytes("")).toBe(0);
  });

  test("truncation reserves the ellipsis, never splits a surrogate pair, and obeys the byte cap", () => {
    expect(truncateUtf8("aé🙂", 6)).toBe("aé…");
    expect(truncateUtf8("🙂🙂🙂", 7)).toBe("🙂…");
    expect(truncateUtf8("🙂🙂🙂", 6)).toBe("…");
    expect(truncateUtf8("🌲", 3)).toBe("…");
    expect(truncateUtf8("🌲", 2)).toBe("");
    expect(truncateUtf8("é", 2)).toBe("é");
    expect(truncateUtf8("", 0)).toBe("");
    expect(() => truncateUtf8("text", -1)).toThrow(RangeError);

    const original = "🧠🙂🌲".repeat(400);
    for (const budget of [0, 1, 2, 3, 4, 7, 13, 100, 301, 1000]) {
      const reduced = truncateUtf8(original, budget);
      expect(utf8Bytes(reduced)).toBeLessThanOrEqual(budget);
      expect(wellFormedUtf16(reduced)).toBe(true);
    }
  });

  test("3 MB draft row is shrunk to <=512 KiB and retains the newest entries first", () => {
    const input = {
      old: { text: "x".repeat(3 * 1024 * 1024), at: 1 },
      middle: { text: "still here", at: 2 },
      newest: { text: "typed last", at: 3 },
    };
    expect(utf8Bytes(encode(input))).toBeGreaterThan(3 * 1024 * 1024);

    const fitted = fitRecord<{ text: string }>(
      input,
      encode,
      ROW_BYTE_LIMIT,
      (entry, budget) => ({ ...entry, text: truncateUtf8(entry.text, budget) }),
    );

    expect(utf8Bytes(encode(fitted.entries))).toBeLessThanOrEqual(ROW_BYTE_LIMIT);
    expect(Object.keys(fitted.entries)).toEqual(["newest", "middle", "old"]);
    expect(fitted.entries.newest?.text).toBe("typed last");
    expect(fitted.entries.middle?.text).toBe("still here");
    expect(fitted.entries.old?.text.endsWith("…")).toBe(true);
    expect(fitted.entries.old?.text.length).toBeLessThan(input.old.text.length);
    expect(fitted.dropped).toEqual([]);
    expect(input.old.text).toHaveLength(3 * 1024 * 1024);
  }, HEAVY_TEST_TIMEOUT_MS);

  test("without a shrinker a large entry is dropped, never written as a giant row", () => {
    const input = {
      old: { text: "x".repeat(3 * 1024 * 1024), at: 1 },
      newest: { text: "keep", at: 2 },
    };
    const result = fitRecord<{ text: string }>(input, encode);
    expect(Object.keys(result.entries)).toEqual(["newest"]);
    expect(result.dropped).toEqual(["old"]);
    expect(utf8Bytes(encode(result.entries))).toBeLessThanOrEqual(ROW_BYTE_LIMIT);
  });

  test("a huge newer item is prioritized; the oldest item is dropped if nothing fits after shrinking", () => {
    const input = {
      old: { text: "older", at: 1 },
      huge: { text: "x".repeat(ROW_BYTE_LIMIT * 2), at: 2 },
      newest: { text: "keep", at: 3 },
    };
    const result = fitRecord<{ text: string }>(
      input, encode, ROW_BYTE_LIMIT,
      (entry, budget) => ({ ...entry, text: truncateUtf8(entry.text, budget) }),
    );
    expect(Object.keys(result.entries)).toEqual(["newest", "huge"]);
    expect(result.dropped).toEqual(["old"]);
    expect(utf8Bytes(encode(result.entries))).toBeLessThanOrEqual(ROW_BYTE_LIMIT);
  }, HEAVY_TEST_TIMEOUT_MS);

  test("ties sort by key; full JSON escaping overhead is measured", () => {
    const tied = {
      z: { text: "last", at: 5 },
      a: { text: "first", at: 5 },
    };
    expect(Object.keys(fitRecord<{ text: string }>(tied, encode).entries)).toEqual(["a", "z"]);

    const escaped = { quoted: { text: "\\".repeat(100), at: 1 } };
    const small = fitRecord<{ text: string }>(escaped, encode, 64);
    expect(small.dropped).toEqual(["quoted"]);
    expect(small.entries).toEqual({});
    expect(utf8Bytes(encode(small.entries))).toBeLessThanOrEqual(64);
    expect(() => fitRecord<{ text: string }>(tied, encode, 1)).toThrow(RangeError);
  });

  test("a shrinker with a minimum viable payload is searched above null budgets", () => {
    const input = { draft: { text: "x".repeat(200), at: 1 } };
    const result = fitRecord<{ text: string }>(input, encode, 100, (entry, budget) =>
      budget < 60 ? null : { ...entry, text: entry.text.slice(0, budget) });
    expect(result.dropped).toEqual([]);
    expect(result.entries.draft).toEqual({ text: "x".repeat(72), at: 1 });
    expect(utf8Bytes(encode(result.entries))).toBe(100);
  });

  test("null lower budgets and oversized upper budgets bracket a fitting shrink", () => {
    const input = {
      older: { text: "x".repeat(300), at: 1 },
      newest: { text: "keep", at: 2 },
    };
    const result = fitRecord<{ text: string }>(input, encode, 150, (entry, budget) =>
      budget < 80 ? null : { ...entry, text: entry.text.slice(0, budget) });
    expect(Object.keys(result.entries)).toEqual(["newest", "older"]);
    expect(result.entries.newest).toEqual(input.newest);
    expect(result.entries.older?.text.length).toBe(90);
    expect(result.dropped).toEqual([]);
    expect(utf8Bytes(encode(result.entries))).toBe(150);
  });

  test("a shrinker that always returns null terminates and reports the dropped key", () => {
    const input = { draft: { text: "x".repeat(200), at: 1 } };
    const budgets: number[] = [];
    const result = fitRecord<{ text: string }>(input, encode, 100, (_entry, budget) => {
      budgets.push(budget);
      return null;
    });
    expect(result.entries).toEqual({});
    expect(result.dropped).toEqual(["draft"]);
    expect(budgets).toEqual([50, 75, 88, 94, 97, 99, 100]);
  });

  test("a noncooperative shrinker cannot bypass the row limit", () => {
    const input = { giant: { text: "x".repeat(ROW_BYTE_LIMIT * 2), at: 1 } };
    const result = fitRecord<{ text: string }>(input, encode, ROW_BYTE_LIMIT, item => item);
    expect(result.entries).toEqual({});
    expect(result.dropped).toEqual(["giant"]);
  });
});

describe("chunked storage rows", () => {
  test("round trips 0, 1, limit, limit+1 and 5x limit bytes; every stored part stays bounded", () => {
    const limit = ROW_BYTE_LIMIT;
    for (const size of [0, 1, limit, limit + 1, limit * 5]) {
      const original = "q".repeat(size);
      const parts = chunkRow(original, limit, "dash.drafts");
      expect(Object.keys(parts.rows)).toHaveLength(Math.ceil(size / limit));
      expect(utf8Bytes(parts.header)).toBeLessThanOrEqual(limit);
      for (const [storageKey, payload] of Object.entries(parts.rows)) {
        expect(storageKey.startsWith("dash.drafts#")).toBe(true);
        expect(utf8Bytes(payload)).toBeLessThanOrEqual(limit);
      }
      expect(joinChunks(parts, "dash.drafts")).toBe(original);
    }
  });

  test("Unicode chunk boundaries preserve whole code points and exact content", () => {
    const value = "🙂🧠🌲".repeat(80) + "final";
    const limit = 64;
    const parts = chunkRow(value, limit, "unicode");
    expect(Object.keys(parts.rows).length).toBeGreaterThan(1);
    for (const part of Object.values(parts.rows)) {
      expect(utf8Bytes(part)).toBeLessThanOrEqual(limit);
      expect(wellFormedUtf16(part)).toBe(true);
    }
    expect(utf8Bytes(parts.header)).toBeLessThanOrEqual(limit);
    expect(joinChunks(parts, "unicode")).toBe(value);
  });

  test("missing, corrupt, wrong-key or incomplete chunks fail closed", () => {
    const original = "z".repeat(140);
    const parts = chunkRow(original, 64, "key");
    expect(Object.keys(parts.rows)).toHaveLength(3);

    const missing = { header: parts.header, rows: { ...parts.rows } };
    delete missing.rows["key#1"];
    expect(joinChunks(missing, "key")).toBeNull();

    const corrupt = { header: parts.header, rows: { ...parts.rows } };
    corrupt.rows["key#0"] = "y" + (corrupt.rows["key#0"] ?? "").slice(1);
    expect(joinChunks(corrupt, "key")).toBeNull();

    expect(joinChunks(parts, "other")).toBeNull();
    expect(joinChunks({ header: null, rows: parts.rows }, "key")).toBeNull();
    expect(joinChunks({ header: "{bad json", rows: parts.rows }, "key")).toBeNull();
    expect(joinChunks({ header: '{"v":1,"count":3,"bytes":140,"hash":"bad"}', rows: parts.rows }, "key")).toBeNull();
    expect(joinChunks({ header: '{"v":1,"count":4,"bytes":140,"hash":"811c9dc5"}', rows: parts.rows }, "key")).toBeNull();
  });

  test("limits too small for a code point or count header reject instead of producing oversized rows", () => {
    expect(() => chunkRow("🙂", 3)).toThrow(RangeError);
    expect(() => chunkRow("", 1)).toThrow(RangeError);
    expect(() => chunkRow("test", -1)).toThrow(RangeError);
    expect(() => chunkRow("test", ROW_BYTE_LIMIT, "")).toThrow(RangeError);
  });
});
