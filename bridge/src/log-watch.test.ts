import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createLogWatch, type LogSource } from "./log-watch";

interface Fixture {
  signature: string;
  source: LogSource;
  line: string;
}

function sourceFromFixture(value: string): LogSource {
  if (value === "bridge" || value === "app" || value === "device") return value;
  throw new Error("Invalid fixture source: " + value);
}

const fixtures: Fixture[] = readFileSync(
  new URL("./fixtures/log-watch/signatures.txt", import.meta.url),
  "utf8",
)
  .trim()
  .split("\n")
  .map((row) => {
    const [signature, rawSource, line] = row.split("|");
    if (!signature || !rawSource || !line) throw new Error("Incomplete log-watch fixture");
    return { signature, source: sourceFromFixture(rawSource), line };
  });

const bursts = new Set(["bridge-econnrefused-burst", "hermes-auth-burst"]);
const invariant = "Invariant Violation at render (/app/Chat124.tsx:34:9)";

describe("log-watch signature fixtures", () => {
  test("covers the full named, ordered detector inventory", () => {
    expect(fixtures.map((fixture) => fixture.signature)).toEqual([
      "react-native-redbox",
      "typeerror-undefined",
      "unhandled-rejection",
      "android-fatal-exception",
      "android-anr",
      "js-stack-overflow",
      "bridge-eaddrinuse",
      "bridge-econnrefused-burst",
      "hermes-auth-burst",
      "out-of-memory",
    ]);
  });

  for (const fixture of fixtures) {
    test("emits one correct notice for " + fixture.signature, () => {
      const watcher = createLogWatch({ now: () => 123 });
      const occurrences = bursts.has(fixture.signature) ? 3 : 1;
      for (let attempt = 1; attempt < occurrences; attempt++) {
        expect(watcher.push(fixture.line, fixture.source)).toBeNull();
      }
      const notice = watcher.push(fixture.line, fixture.source);
      expect(notice).toMatchObject({
        signature: fixture.signature,
        source: fixture.source,
        count: occurrences,
        firstAt: 123,
      });
      expect(notice?.id).toContain("log-watch:" + fixture.signature + ":");
      expect(notice?.summary.length).toBeGreaterThan(0);
      expect(notice?.summary.length).toBeLessThanOrEqual(160);
      expect(watcher.flush()).toEqual([notice]);
      expect(watcher.flush()).toEqual([]);
      expect(watcher.push(fixture.line, fixture.source)).toBeNull();
    });
  }
});

describe("log-watch deduplication and time windows", () => {
  test("increments counts without re-emitting, and resets exactly at window boundary", () => {
    let clock = 0;
    const watcher = createLogWatch({ now: () => clock, windowMs: 1_000 });
    const first = watcher.push(invariant, "app");
    expect(first?.count).toBe(1);
    clock = 999;
    expect(watcher.push(invariant, "app")).toBeNull();
    expect(watcher.push(invariant, "app")).toBeNull();

    const flushed = watcher.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.count).toBe(3);
    expect(first?.count).toBe(1); // push returns a snapshot, not a mutable alias.
    expect(watcher.push(invariant, "app")).toBeNull();
    expect(flushed[0]?.count).toBe(3);
    expect(watcher.flush()).toEqual([]);

    clock = 1_000;
    const next = watcher.push(invariant, "app");
    expect(next).toMatchObject({ firstAt: 1_000, count: 1 });
    expect(next?.id).not.toBe(first?.id);
    expect(watcher.flush()).toEqual([next]);
  });

  test("normalizes absolute dirs, Windows paths, columns, and digits in file ids", () => {
    const watcher = createLogWatch({ now: () => 10 });
    const linux = "Invariant Violation at render (/data/user/Chat124.tsx:34:9)";
    const windows = "Invariant Violation at render (C:\\Users\\Temp\\Chat999.tsx:34:27)";
    const differentLine = "Invariant Violation at render (/data/user/Chat333.tsx:35:9)";
    expect(watcher.push(linux, "bridge")).not.toBeNull();
    expect(watcher.push(windows, "app")).toBeNull(); // Source is NOT part of fingerprint.
    expect(watcher.push(differentLine, "app")).not.toBeNull();
    expect(watcher.flush().map((notice) => [notice.source, notice.count])).toEqual([
      ["bridge", 2],
      ["app", 1],
    ]);
  });

  test("recognizes Android stack frames with no space before the parenthesis", () => {
    const watcher = createLogWatch({ now: () => 10 });
    const a = "FATAL EXCEPTION: main at com.dash.Activity.run(MainActivity42.java:41)";
    const b = "FATAL EXCEPTION: main at com.dash.Activity.run(MainActivity99.java:41)";
    const c = "FATAL EXCEPTION: main at com.dash.Activity.run(MainActivity99.java:42)";
    expect(watcher.push(a, "device")).not.toBeNull();
    expect(watcher.push(b, "device")).toBeNull();
    expect(watcher.push(c, "device")).not.toBeNull();
    expect(watcher.flush().map((notice) => notice.count)).toEqual([2, 1]);
  });

  test("does not confuse generic 401s, normal promise handling, and ordinary text with errors", () => {
    const watcher = createLogWatch();
    for (const line of [
      "HTTP 401 from an unrelated service",
      "handled promise rejection",
      "TypeError: undefined variable name",
      "request completed",
      "",
    ]) {
      expect(watcher.push(line, "bridge")).toBeNull();
    }
    expect(watcher.flush()).toEqual([]);
  });

  test("uses ordered matching for lines with multiple errors", () => {
    const watcher = createLogWatch({ now: () => 10 });
    expect(watcher.push("FATAL EXCEPTION: main; lowmemorykiller", "device")?.signature)
      .toBe("android-fatal-exception");
  });

  test("auth and socket errors only trigger on a genuine burst in one window", () => {
    let clock = 0;
    const watcher = createLogWatch({ now: () => clock, windowMs: 20 });
    const denied = "Hermes gateway HTTP 403 at check (/host/auth12.ts:44:1)";
    expect(watcher.push(denied, "bridge")).toBeNull();
    expect(watcher.push(denied, "bridge")).toBeNull();
    clock = 20;
    expect(watcher.push(denied, "bridge")).toBeNull(); // The earlier pair expired.
    expect(watcher.push(denied, "bridge")).toBeNull();
    expect(watcher.push(denied, "bridge")).toMatchObject({
      signature: "hermes-auth-burst",
      firstAt: 20,
      count: 3,
    });
    expect(watcher.push(denied, "bridge")).toBeNull();
    expect(watcher.flush()[0]?.count).toBe(4);
    expect(watcher.flush()).toEqual([]);
  });
});

describe("log-watch security and memory bounds", () => {
  test("redacts bearer, token keys, long hex and base64 before clipping at 160 characters", () => {
    const bearer = "BearerPrivate123XYZ";
    const token = "token-private-value-987654321";
    const longHex = "a1b2c3d4".repeat(6);
    const base64 = "QWxhZGRpbjpvcGVuIHNlc2FtZQ".repeat(3) + "==";
    for (const secret of [
      "Bearer " + bearer,
      "token=" + token,
      "access_token='" + token + "'",
      longHex,
      base64,
    ]) {
      const watcher = createLogWatch({ now: () => 0 });
      const notice = watcher.push("Invariant Violation " + secret + " at render (/app/secret9.tsx:4:1)", "app");
      expect(notice?.summary).toContain("[REDACTED]");
      expect(notice?.summary).not.toContain(bearer);
      expect(notice?.summary).not.toContain(token);
      expect(notice?.summary).not.toContain(longHex);
      expect(notice?.summary).not.toContain(base64);
      expect(notice?.summary.length).toBeLessThanOrEqual(160);
    }
    const long = "Invariant Violation " + "ordinary descriptive words ".repeat(30);
    expect(createLogWatch().push(long, "app")?.summary.length).toBe(160);
  });

  test("honors smaller notice caps and never exceeds hard cap 64", () => {
    const watcher = createLogWatch({ now: () => 0, maxNotices: 3 });
    for (let i = 1; i <= 10; i++) {
      expect(watcher.push("Invariant Violation at render (/a/file.ts:" + i + ":1)", "app"))
        .not.toBeNull();
    }
    const notices = watcher.flush();
    expect(notices).toHaveLength(3);
    expect(notices.map((notice) => notice.id)).toEqual([
      "log-watch:react-native-redbox:8",
      "log-watch:react-native-redbox:9",
      "log-watch:react-native-redbox:10",
    ]);
    expect(watcher.flush()).toEqual([]);
  });

  test("LRU refresh protects hot frames and evicts the oldest among 257 unique frames", () => {
    const watcher = createLogWatch({ now: () => 0 });
    function line(frame: number): string {
      return "Invariant Violation at render (/src/file.ts:" + frame + ":1)";
    }
    for (let i = 1; i <= 256; i++) watcher.push(line(i), "bridge");
    expect(watcher.push(line(1), "bridge")).toBeNull(); // Promote the oldest frame.
    expect(watcher.push(line(257), "bridge")).not.toBeNull();
    expect(watcher.push(line(1), "bridge")).toBeNull(); // Still hot.
    expect(watcher.push(line(2), "bridge")).not.toBeNull(); // Evicted.
    expect(watcher.flush()).toHaveLength(64);
  });

  test("10k distinct lines cannot grow the fingerprint set or notice buffer without bound", () => {
    const watcher = createLogWatch({ now: () => 0, maxNotices: 100_000 });
    function line(frame: number): string {
      return "Invariant Violation at render (/src/Frame" + frame + ".tsx:" + frame + ":1)";
    }
    const oldest = watcher.push(line(0), "app");
    for (let i = 1; i < 10_000; i++) watcher.push(line(i), "app");
    const buffered = watcher.flush();
    expect(buffered).toHaveLength(64);
    expect(buffered.every((notice) => notice.summary.length <= 160)).toBe(true);
    expect(buffered.some((notice) => notice.id === oldest?.id)).toBe(false);
    expect(watcher.push(line(9_999), "app")).toBeNull(); // Most recent entry retained.
    expect(watcher.push(line(0), "app")).not.toBeNull(); // Oldest entry was evicted.
    expect(watcher.flush()).toHaveLength(1);
  });

  test("invalid options do not bypass hard caps or make expiry non-finite", () => {
    const watcher = createLogWatch({ now: () => 0, windowMs: -Infinity, maxNotices: Infinity });
    expect(watcher.push(invariant, "app")).not.toBeNull();
    expect(watcher.push(invariant, "app")).toBeNull();
    expect(watcher.flush()[0]?.count).toBe(2);
  });
});
