import { describe, expect, test } from "bun:test";
import { forDash, isStageUrl, parseStageDeepLink, stageLabel, stageLinks } from "./stage-link";

const T = "0123456789abcdef0123456789abcdef";

describe("stage links", () => {
  test("finds tailnet and loopback review links in a reply", () => {
    const text = `Review is up: http://100.113.138.100:41873/#t=${T} (and again http://100.113.138.100:41873/#t=${T}). Local: http://127.0.0.1:5000/?actor=owner#t=${T}.`;
    expect(stageLinks(text)).toEqual([`http://100.113.138.100:41873/#t=${T}`, `http://127.0.0.1:5000/?actor=owner#t=${T}`]);
  });
  test("refuses public http hosts and links without a review token", () => {
    expect(isStageUrl(`http://example.com:8080/#t=${T}`)).toBe(false);
    expect(isStageUrl("http://100.113.138.100:41873/")).toBe(false);
    expect(isStageUrl(`http://100.200.1.1:41873/#t=${T}`)).toBe(false); // outside 100.64/10
    expect(isStageUrl(`https://stage.example.com/#t=${T}`)).toBe(true);
  });
  test("deep links wrap a stage url", () => {
    const u = `http://100.113.138.100:41873/#t=${T}`;
    expect(parseStageDeepLink(`dash://stage?url=${encodeURIComponent(u)}`)).toBe(u);
    expect(parseStageDeepLink(`exp://192.168.1.2:8081/--/stage?url=${encodeURIComponent(u)}`)).toBe(u);
    expect(parseStageDeepLink("dash://stage?url=http%3A%2F%2Fevil.com%2F")).toBeNull();
  });
  test("marks the channel as dash and keeps the token in the fragment", () => {
    const u = forDash(`http://100.113.138.100:41873/#t=${T}`);
    expect(u).toBe(`http://100.113.138.100:41873/?channel=dash#t=${T}`);
    expect(stageLabel(u)).toBe("100.113.138.100:41873");
  });
});
