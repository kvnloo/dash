import { describe, expect, test } from "bun:test";
import {
  ARTIFACT_CSP,
  checkArtifactHtml,
  withStrictCsp,
} from "./artifact-policy";
import type { ArtifactPolicyOptions } from "./artifact-policy";

const cspMeta = '<meta http-equiv="Content-Security-Policy" content="' + ARTIFACT_CSP + '">';

function page(body = "", head = ""): string {
  return "<!doctype html><html><head>" + head + "</head><body>" + body + "</body></html>";
}

function expectOnly(html: string, rule: string, options: ArtifactPolicyOptions = {}): void {
  const result = checkArtifactHtml(html, options);
  expect(result.ok).toBe(false);
  expect(result.violations.map(v => v.rule)).toEqual([rule]);
  expect(result.violations[0]?.excerpt.length).toBeGreaterThan(0);
  expect(result.violations[0]?.excerpt.length).toBeLessThanOrEqual(80);
}

describe("Flow artifact HTML checker", () => {
  test("accepts an inline, self-contained HTML page including data images, local anchors and inline JS", () => {
    const safe = page(
      '<h1 id="top">Local</h1><a href="#top">Back</a>' +
      '<img src="data:image/png;base64,AAAA" srcset="data:image/png;base64,//+/AA== 1x" />' +
      '<button onclick="this.textContent = \'Tapped\'">Tap</button>' +
      "<script>document.title = 'Local';</script>",
      '<style>body { background: url("data:image/png;base64,AAAA"); }</style>',
    );
    expect(checkArtifactHtml(safe)).toEqual({ ok: true, violations: [] });
    expect(checkArtifactHtml(safe, { maxBytes: 4096 })).toEqual({ ok: true, violations: [] });
  });

  const attributeCases: ReadonlyArray<readonly [string, string]> = [
    ["remote-src", '<img SRC = "https://cdn.example/test.png">'],
    ["remote-src", "<img src=//cdn.example/test.png>"],
    ["remote-src", '<img src="ws://host/image">'],
    ["remote-href", '<a href="HTTP://remote.example">Open</a>'],
    ["remote-action", '<form action="https://submit.example/">'],
    ["remote-formaction", '<button formaction="//remote.example/save">Save</button>'],
    ["remote-srcset", '<img srcset="data:image/png;base64,AAAA 1x, //cdn.example/2.png 2x">'],
    ["remote-poster", '<video poster="wss://remote.example/video">'],
    ["remote-xlink:href", '<svg><image xlink:href="//remote.example/pic"/></svg>'],
  ];
  test.each(attributeCases)("rejects %s URL attribute", (rule, markup) => {
    expectOnly(page(markup), rule);
  });

  test("rejects entity-encoded schemes, separators and quoted angle brackets", () => {
    expectOnly(page('<IMG alt="not > the tag end" src="h&#x74;tps&colon;&sol;&sol;cdn.example/a">'), "remote-src");
    expectOnly(page('<a HREF="&#47;&#47;cdn.example/a">Go</a>'), "remote-href");
  });

  const cssCases: ReadonlyArray<readonly [string, string]> = [
    ["remote-css-url", '<style>.x {background:url("https://cdn.example/a.png")}</style>'],
    ["remote-css-url", '<div style="background:url(&quot;//cdn.example/a.png&quot;)">OK</div>'],
    ["remote-css-import", '<style>@import "http://cdn.example/theme.css";</style>'],
    ["remote-css-import", '<style>@import url("//cdn.example/theme.css");</style>'],
    ["remote-css-url", '<style>.x{background:url(\\68ttps://cdn.example/pic)}</style>'],
  ];
  test.each(cssCases)("rejects %s in CSS", (rule, markup) => {
    expectOnly(page(markup), rule);
  });

  const markupCases: ReadonlyArray<readonly [string, string]> = [
    ["base-tag", '<BASE href="#top">'],
    ["meta-refresh", '<META HTTP-EQUIV = "Refresh" content="0; url=/safe">'],
    ["iframe-src", '<iframe src="data:text/html,local"></iframe>'],
    ["object-src", '<object src="data:text/html,local"></object>'],
    ["embed-src", '<embed src="data:text/html,local">'],
  ];
  test.each(markupCases)("rejects %s markup", (rule, markup) => {
    expectOnly(page(markup), rule);
  });

  const scriptCases: ReadonlyArray<readonly [string, string]> = [
    ["script-window-open", "window.open('#top')"],
    ["script-window-open", "window['open']('#top')"],
    ["script-location", "location = '#top'"],
    ["script-location", "window.location.href = '/elsewhere'"],
    ["script-location", "location.assign('#next')"],
    ["script-fetch", "fetch('/endpoint')"],
    ["script-xmlhttprequest", "const request = new XMLHttpRequest()"],
    ["script-websocket", "new WebSocket('/channel')"],
    ["script-eventsource", "new EventSource('/events')"],
    ["script-sendbeacon", "navigator.sendBeacon('/event', 'ok')"],
  ];
  test.each(scriptCases)("rejects %s JavaScript", (rule, code) => {
    expectOnly(page("<script>" + code + "</script>"), rule);
  });

  test("checks inline handlers as executable code, not only script blocks", () => {
    expectOnly(page('<button onClick="fetch(&quot;/events&quot;)">Click</button>'), "script-fetch");
    expectOnly(page('<a href="javascript:alert(1)">Click</a>'), "scripted-url");
  });

  test("staticOnly rejects any script element or inline event handler", () => {
    expectOnly(page('<script type="application/json">{"local":true}</script>'), "static-script", { staticOnly: true });
    expectOnly(page('<button ONCLICK="alert(1)">Click</button>'), "static-event-handler", { staticOnly: true });
    expect(checkArtifactHtml(page("<p>Static</p>"), { staticOnly: true })).toEqual({ ok: true, violations: [] });
  });

  test("reports independent script/static violations rather than hiding one", () => {
    const actual = checkArtifactHtml(page("<script>fetch('/endpoint')</script>"), { staticOnly: true });
    expect(actual.ok).toBe(false);
    expect(actual.violations.map(v => v.rule)).toEqual(["static-script", "script-fetch"]);
  });

  test("reports UTF-8 byte size (not UTF-16 code units) at the exact limit", () => {
    expect(checkArtifactHtml("💡", { maxBytes: 4 })).toEqual({ ok: true, violations: [] });
    expectOnly("💡", "size", { maxBytes: 3 });
    expectOnly("x".repeat(512 * 1024 + 1), "size");
    expectOnly("x", "invalid-max-bytes", { maxBytes: -1 });
  });

  test("never produces an excerpt longer than 80 characters", () => {
    const longUrl = "https://cdn.example/" + "a".repeat(240);
    const result = checkArtifactHtml(page('<img src="' + longUrl + '">'));
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.excerpt.length).toBe(80);
  });

  test("does not mistake comment markup or JS string markup for actual HTML tags", () => {
    const safe = page(
      "<!-- <base href='https://example.org'> -->" +
      "<script>const example = '<base href=\"https://example.org\">';</script>",
    );
    expect(checkArtifactHtml(safe).ok).toBe(true);
  });
});

describe("strict embedded CSP", () => {
  test("inserts exactly the required CSP meta before any other head children", () => {
    const source = '<!DOCTYPE html><HTML><HeAd data-a="1">\n<title>Test</title></HeAd><body>Safe</body></HTML>';
    const secured = withStrictCsp(source);
    expect(secured).toContain('<HeAd data-a="1">' + cspMeta + "\n<title>Test</title>");
    expect(secured).toContain('content="' + ARTIFACT_CSP + '"');
    expect(secured.match(/<meta http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
    expect(withStrictCsp(secured)).toBe(secured);
  });

  test("removes ALL page-provided CSP meta elements, including report-only and out-of-head", () => {
    const supplied =
      '<meta HTTP-EQUIV="content-security-policy" content="default-src *">' +
      '<meta http-equiv=Content-Security-Policy-Report-Only content="img-src *">';
    const source = page(
      '<meta http-equiv="Content-Security-Policy" content="script-src *"><p>Safe</p>',
      supplied,
    );
    const secured = withStrictCsp(source);
    expect(secured).toBe('<!doctype html><html><head>' + cspMeta + '</head><body><p>Safe</p></body></html>');
    expect(secured).not.toContain('default-src *');
    expect(secured).not.toContain('script-src *');
    expect(withStrictCsp(secured)).toBe(secured);
  });

  test("recognizes a supplied CSP meta despite mixed case, spacing and entity-encoded name", () => {
    const source = page("hello", '<META HTTP-EQUIV = "Content&#45;Security-Policy" content="default-src *">');
    const secured = withStrictCsp(source);
    expect(secured).toBe(page("hello", cspMeta));
  });

  test("creates head immediately after html if missing, ahead of body", () => {
    const source = '<!doctype html><html lang="en"><body><p>Hello</p></body></html>';
    const secured = withStrictCsp(source);
    expect(secured).toBe('<!doctype html><html lang="en"><head>' + cspMeta + '</head><body><p>Hello</p></body></html>');
    expect(withStrictCsp(secured)).toBe(secured);
  });

  test("creates head after doctype for fragment-style documents", () => {
    const source = "<!doctype html><main>Local</main>";
    const secured = withStrictCsp(source);
    expect(secured).toBe("<!doctype html><head>" + cspMeta + "</head><main>Local</main>");
    expect(withStrictCsp(secured)).toBe(secured);
  });
});
