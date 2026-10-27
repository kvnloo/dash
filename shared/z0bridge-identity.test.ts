import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { base64url, identityUrl, parseIdentityPairLink, pinnedKey, sha256Ascii } from "./z0bridge-identity";
import { identityFixture } from "./identity-fixture.test-helper";
import { parseDashConnectUrl } from "./pair-link";
import { createDeepLinkRouter } from "../app/src/lib/deep-link";

describe("identity boundary helpers", () => {
  test("Expo-safe SHA-256 and base64url match Node including block boundaries", () => {
    for (const text of ["", "abc", "a".repeat(55), "b".repeat(56), "c".repeat(64), "d".repeat(1000)]) {
      expect(base64url(sha256Ascii(text))).toBe(createHash("sha256").update(text).digest("base64url"));
    }
    expect(() => sha256Ascii("é")).toThrow();
  });
  test("JWK pins are computed, not trusted labels", () => {
    const f = identityFixture();
    expect(pinnedKey(f.jwks, f.kid)?.kid).toBe(f.kid);
    const other = identityFixture();
    expect(pinnedKey({ keys: [{ ...other.jwks.keys[0], kid: f.kid }] }, f.kid)).toBeUndefined();
    for (const changes of [{ alg: "none" }, { use: "enc" }, { crv: "P-384" }, { d: "private" }, { x: "short" }]) {
      expect(pinnedKey({ keys: [{ ...f.jwks.keys[0], ...changes }] }, f.kid)).toBeUndefined();
    }
  });
  test("URLs are literal tailnet or explicit loopback, never arbitrary HTTP endpoints", () => {
    expect(identityUrl("http://100.113.138.100:4788")).toBe("http://100.113.138.100:4788");
    expect(identityUrl("http://127.0.0.1:4789", true)).toBe("http://127.0.0.1:4789");
    for (const url of ["http://127.0.0.1:4789", "http://100.128.0.1:4788", "http://100.113.138.999:4788", "http://100.113.138.100:0", "http://100.113.138.100:65536", "http://name:4788", "http://u:p@100.113.138.100:4788", "http://100.113.138.100:4788/x", "http://100.113.138.100:4788?x=1"]) expect(identityUrl(url)).toBeUndefined();
  });
  test("PR #2 pair and issue #79 connect links route without claiming or normalizing opaque codes", () => {
    const f = identityFixture();
    const code = `z0bp_${"aB_9-".repeat(8)}xyz`;
    const query = `v=2&url=${encodeURIComponent("http://100.113.138.100:4788")}&code=${code}&kid=${f.kid}&app=dash`;
    const link = `dash://pair?${query}`;
    expect(parseIdentityPairLink(link)?.code).toBe(code);
    expect(parseIdentityPairLink(`dash://connect?${query}`)?.code).toBe(code);
    expect(parseDashConnectUrl(link)).toEqual({ address: "", code: "", identityLink: link });
    let ready = false; const opened: unknown[] = [];
    const router = createDeepLinkRouter({ isReady: () => ready, openPair: p => opened.push(p) });
    expect(router.handle(link)).toBe(true); expect(opened).toEqual([]);
    ready = true; router.flush(); expect(opened).toEqual([{ address: "", code: "", identityLink: link }]);
    for (const invalid of [link + "&kid=other", link + "#fragment", link.replace("app=dash", "app=noop"), link.replace("v=2", "v=3"), link.replace(code, code.toUpperCase()), link.replace("url=", "url=%GG")]) expect(parseIdentityPairLink(invalid)).toBeNull();
  });
});
