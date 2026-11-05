import { describe, expect, test } from "bun:test";
import { dashConnectUrl, expoGoConnectUrl } from "../../../shared/pair-link";
import { createDeepLinkRouter, nextPrefill } from "./deep-link";
import { parseDashConnectUrl } from "./pair-url";

const prefill = { address: "100.113.138.100:4747", code: "AB2CD3" };

describe("parseDashConnectUrl", () => {
  test("dev build link", () => {
    expect(parseDashConnectUrl("dash://connect?address=100.113.138.100%3A4747&code=ab2cd3")).toEqual(prefill);
  });
  test("Expo Go link (the shape the phone receives tonight)", () => {
    expect(parseDashConnectUrl("exp://100.113.138.100:8097/--/connect?address=100.113.138.100%3A4747&code=AB2CD3")).toEqual(prefill);
    expect(parseDashConnectUrl("exps://u.expo.dev/abc/--/connect/?code=AB2CD3&address=100.113.138.100:4747")).toEqual(prefill);
  });
  test("bare and triple-slash forms", () => {
    expect(parseDashConnectUrl("connect?address=100.113.138.100:4747&code=AB2CD3")).toEqual(prefill);
    expect(parseDashConnectUrl("dash:///connect?address=100.113.138.100:4747&code=AB2CD3")).toEqual(prefill);
  });
  test("Expo Go reload URL without a connect route does not prefill", () => {
    expect(parseDashConnectUrl("exp://100.113.138.100:8097")).toBeNull();
    expect(parseDashConnectUrl("exp://100.113.138.100:8097?address=a:1&code=AB2CD3")).toBeNull();
    expect(parseDashConnectUrl("exp://100.113.138.100:8097/--/settings?address=a:1&code=AB2CD3")).toBeNull();
  });
  test("rejects other schemes, bad codes and smuggled addresses", () => {
    expect(parseDashConnectUrl("https://evil.example/connect?address=a:1&code=AB2CD3")).toBeNull();
    expect(parseDashConnectUrl("dash://connect?address=a:1&code=AB2C")).toBeNull();
    expect(parseDashConnectUrl("dash://connect?address=a:1&code=AB2C!3")).toBeNull();
    expect(parseDashConnectUrl("dash://connect?address=http%3A%2F%2Fa%3A1%2Fx&code=AB2CD3")).toBeNull();
    expect(parseDashConnectUrl("dash://connect?address=u%40a:1&code=AB2CD3")).toBeNull();
    expect(parseDashConnectUrl("dash://connect?address=%E0%A4%A&code=AB2CD3")).toBeNull();
    expect(parseDashConnectUrl("")).toBeNull();
  });
  test("first duplicate wins, fragment ignored", () => {
    expect(parseDashConnectUrl("dash://connect?address=100.113.138.100:4747&code=AB2CD3&code=ZZZZZZ#x")).toEqual(prefill);
  });
  test("bridge-built links round-trip through the app parser", () => {
    expect(parseDashConnectUrl(dashConnectUrl(prefill))).toEqual(prefill);
    const expo = expoGoConnectUrl("100.113.138.100:8097", prefill);
    expect(expo).toBe("exp://100.113.138.100:8097/--/connect?address=100.113.138.100%3A4747&code=AB2CD3");
    expect(parseDashConnectUrl(expo ?? "")).toEqual(prefill);
    expect(expoGoConnectUrl("exp://100.113.138.100:8097/", prefill)).toBe(expo);
    expect(expoGoConnectUrl("http://100.113.138.100:8097", prefill)).toBeUndefined();
    expect(expoGoConnectUrl("100.113.138.100:8097/path", prefill)).toBeUndefined();
  });
});

describe("createDeepLinkRouter", () => {
  test("holds a cold-start link until navigation is ready", () => {
    let ready = false;
    const opened: unknown[] = [];
    const router = createDeepLinkRouter({ isReady: () => ready, openPair: p => opened.push(p) });
    expect(router.handle("exp://h:8097/--/connect?address=100.113.138.100:4747&code=AB2CD3")).toBe(true);
    expect(opened).toEqual([]);
    router.flush();
    expect(opened).toEqual([]);
    ready = true;
    router.flush();
    expect(opened).toEqual([prefill]);
    router.flush();
    expect(opened).toEqual([prefill]);
  });
  test("opens immediately when ready, ignores non-pair links", () => {
    const opened: unknown[] = [];
    const router = createDeepLinkRouter({ isReady: () => true, openPair: p => opened.push(p) });
    expect(router.handle("exp://h:8097")).toBe(false);
    expect(router.handle(null)).toBe(false);
    expect(router.handle(dashConnectUrl(prefill))).toBe(true);
    expect(opened).toEqual([prefill]);
  });
});

describe("nextPrefill", () => {
  test("applies each distinct link once, so an already mounted Pair updates", () => {
    const first = nextPrefill(prefill, null);
    expect(first?.prefill).toEqual(prefill);
    expect(nextPrefill(prefill, first?.key ?? null)).toBeNull();
    const second = nextPrefill({ ...prefill, code: "zz9zz9" }, first?.key ?? null);
    expect(second?.prefill.code).toBe("ZZ9ZZ9");
    expect(nextPrefill(undefined, null)).toBeNull();
    expect(nextPrefill({ address: "a:1" }, null)).toBeNull();
  });
});
