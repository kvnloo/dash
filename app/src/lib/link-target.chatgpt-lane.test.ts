import { describe, expect, test } from "bun:test";
import { classifyLink, linkAccessibilityHint, type LinkTarget } from "./link-target";

describe("DASH-15: tappable Markdown link targets", () => {
  const cases: { href: string; target: LinkTarget }[] = [
    { href: "  https://example.com/SomeCase/File.ts?q=KeepCase  ",
      target: { kind: "web", url: "https://example.com/SomeCase/File.ts?q=KeepCase" } },
    { href: "HTTP://example.com/Aa/Bb",
      target: { kind: "web", url: "HTTP://example.com/Aa/Bb" } },
    { href: "dash://trace", target: { kind: "app-route", route: "Trace" } },
    { href: " EXP+DaSh://LaB ", target: { kind: "app-route", route: "Lab" } },
    { href: "/--/orchestra", target: { kind: "app-route", route: "Orchestra" } },
    { href: "dash://settings", target: { kind: "app-route", route: "Settings" } },
    { href: "dash://bots", target: { kind: "app-route", route: "Bots" } },
    { href: "MAILTO:hello@example.com?subject=Hello",
      target: { kind: "mailto", url: "MAILTO:hello@example.com?subject=Hello" } },
    { href: "/work/src/a.ts", target: { kind: "file", path: "/work/src/a.ts" } },
    { href: "/work/src/a.ts:12", target: { kind: "file", path: "/work/src/a.ts", line: 12 } },
    { href: "/work/src/a.ts:12:4",
      target: { kind: "file", path: "/work/src/a.ts", line: 12, column: 4 } },
    { href: "/work/My File.ts:12:4",
      target: { kind: "file", path: "/work/My File.ts", line: 12, column: 4 } },
    { href: "~/proj/a.ts", target: { kind: "file", path: "~/proj/a.ts" } },
    { href: "~/proj/a.ts:42:9",
      target: { kind: "file", path: "~/proj/a.ts", line: 42, column: 9 } },
    { href: "./a.ts", target: { kind: "file", path: "./a.ts" } },
    { href: "./README", target: { kind: "file", path: "./README" } },
    { href: "../a.ts", target: { kind: "file", path: "../a.ts" } },
    { href: "src/../README", target: { kind: "file", path: "src/../README" } },
    { href: "src/a.ts", target: { kind: "file", path: "src/a.ts" } },
    { href: "src/nested/a.test.ts:12:4",
      target: { kind: "file", path: "src/nested/a.test.ts", line: 12, column: 4 } },
    { href: "file:///a%20b.ts", target: { kind: "file", path: "/a b.ts" } },
    { href: "file:///a%20b.ts:12:4",
      target: { kind: "file", path: "/a b.ts", line: 12, column: 4 } },
    { href: "file:///tmp/a%23b.ts:12",
      target: { kind: "file", path: "/tmp/a#b.ts", line: 12 } },
    { href: "file://localhost/tmp/x.ts",
      target: { kind: "file", path: "/tmp/x.ts" } },
  ];

  for (const { href, target } of cases) {
    test("classifies " + JSON.stringify(href), () => {
      expect(classifyLink(href)).toEqual(target);
    });
  }

  test("blocks unknown and malformed app routes without falling through to file", () => {
    for (const href of [
      "dash://nope", "exp+dash://nope", "/--/nope", "dash://trace/other",
      "/--/trace/other", "dash://untrusted/--/trace", "/foo/--/trace",
      "exp://localhost/--/trace",
    ]) {
      expect(classifyLink(href).kind).toBe("blocked");
    }
    expect(classifyLink("dash://trace")).toEqual({ kind: "app-route", route: "Trace" });
  });

  test("blocks prefixed Expo route markers rather than treating them as files", () => {
    for (const href of ["/foo/--/trace", "/foo/--/nope", "/foo/--/trace/other", "/foo/--/trace.ts"]) {
      expect(classifyLink(href)).toEqual({ kind: "blocked", reason: "Unknown app route" });
    }
    expect(classifyLink("/--/trace")).toEqual({ kind: "app-route", route: "Trace" });
    expect(classifyLink("mailto:user@example.com?body=/--/trace")).toEqual({
      kind: "mailto", url: "mailto:user@example.com?body=/--/trace",
    });
    expect(classifyLink("file:///foo/--/trace.ts")).toEqual({
      kind: "file", path: "/foo/--/trace.ts",
    });
  });

  test("allows every printable ASCII character in local file names", () => {
    for (let code = 0x20; code <= 0x7e; code++) {
      const path = "/src/A" + String.fromCharCode(code) + "Z.ts";
      expect(classifyLink(path)).toEqual({ kind: "file", path });
    }
    expect(classifyLink("MAILTO:AZaz09+tag@example.com?subject=Hello_World")).toEqual({
      kind: "mailto", url: "MAILTO:AZaz09+tag@example.com?subject=Hello_World",
    });
  });

  test("rejects every embedded C0 control and DEL, including decoded file paths", () => {
    const codes = Array.from({ length: 32 }, (_, code) => code).concat(0x7f);
    for (const code of codes) {
      const control = String.fromCharCode(code);
      for (const href of [
        "/src/A" + control + "Z.ts", "./A" + control + "Z.ts",
        "https://example.com/A" + control + "Z", "mailto:A" + control + "Z@example.com",
        "dash://tra" + control + "ce",
        "file:///src/A%" + code.toString(16).padStart(2, "0") + "Z.ts",
      ]) {
        expect(classifyLink(href).kind).toBe("blocked");
      }
    }
  });

  test("blocks unsafe schemes in any case", () => {
    for (const href of [
      "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,abc",
      "vbscript:MsgBox(1)", "intent://scan/#Intent", "content://provider/item",
      "ftp://example.com/file.ts", "tel:+15551234567", "custom://x",
    ]) {
      const result = classifyLink(href);
      expect(result.kind).toBe("blocked");
      if (result.kind === "blocked") {
        expect(result.reason.length).toBeGreaterThan(0);
        expect(result.reason.length).toBeLessThan(50);
      }
    }
  });

  test("rejects invalid hrefs, malformed URLs, remote file authorities and ambiguous positions", () => {
    for (const href of [
      "", "   \n\t", "https://", "http:example.com", "hello", "src/README",
      "//example.com/x.ts", "file:", "file://remote-host/tmp/a.ts",
      "file:///bad%E0%A4%A.ts", "file:///a%00b.ts",
      "file:///tmp/a.ts?download=1", "file:///tmp/a.ts#fragment",
      "/tmp/a.ts:0", "/tmp/a.ts:1:0", "/tmp/a.ts:1:2:3",
      "/tmp/a.ts:99999999999999999999", "src/a.ts:4:99999999999999999999",
      "https://example.com/\nJavascript:alert(1)",
    ]) {
      expect(classifyLink(href).kind).toBe("blocked");
    }
  });

  test("line and column are exact positive safe integers", () => {
    expect(classifyLink("./file.ts:0012:0004")).toEqual({
      kind: "file", path: "./file.ts", line: 12, column: 4,
    });
    expect(classifyLink("./file.ts:9007199254740991")).toEqual({
      kind: "file", path: "./file.ts", line: 9007199254740991,
    });
    expect(classifyLink("./file.ts:9007199254740992").kind).toBe("blocked");
  });

  test("provides purpose-specific accessibility hints", () => {
    const pairs: { target: LinkTarget; hint: string }[] = [
      { target: { kind: "web", url: "https://example.com" }, hint: "Opens in browser" },
      { target: { kind: "app-route", route: "Trace" }, hint: "Opens Dash Trace" },
      { target: { kind: "mailto", url: "mailto:user@example.com" }, hint: "Opens email app" },
      { target: { kind: "file", path: "/src/a.ts", line: 12 }, hint: "Opens file preview" },
      { target: { kind: "blocked", reason: "Unsafe link scheme" }, hint: "Link blocked" },
    ];
    for (const { target, hint } of pairs) {
      expect(linkAccessibilityHint(target)).toBe(hint);
    }
  });

  test("never throws for a reproducible fuzz corpus", () => {
    let seed = 357;
    const chars = [
      "a", "Z", "1", ":", "/", ".", "%", "?", "#", "@", "+", "-", "~", "&",
      " ", "\t", "\n", "\0", "\u007f", "\u00e9", "\ud800", "\udfff", "\ud83d\ude80",
    ];
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let i = 0; i < 3000; i++) {
      let value = "";
      const length = next() % 84;
      for (let j = 0; j < length; j++) value += chars[next() % chars.length];
      expect(() => classifyLink(value)).not.toThrow();
      const result = classifyLink(value);
      expect(["web", "app-route", "mailto", "file", "blocked"]).toContain(result.kind);
    }
  });

  test("contains no React Native or navigation dependency", async () => {
    const source = await Bun.file(new URL("./link-target.ts", import.meta.url)).text();
    expect(source).not.toMatch(/\bfrom\s*["']react-native(?:["']|\/)/);
    expect(source).not.toMatch(/\brequire\s*\(\s*["']react-native/);
    expect(source).not.toContain("Linking.openURL");
  });
});
