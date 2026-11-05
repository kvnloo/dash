import { describe, expect, test } from "bun:test";
import { ephemeralCardDocument, ephemeralCardSpec, ephemeralIntent, parseEphemeralMessage } from "./ephemeral-card";
import { parseOpenUI } from "./openui-catalog";
import { EPHEMERAL_APPS_BY_KIND, EPHEMERAL_KINDS, EPHEMERAL_KIT_REV } from "../vendor/ephemeral-ui/kinds.generated";

const fence = (body: string) => parseOpenUI(body, true);

describe("ephemeral-ui cards in the openui-lang catalog", () => {
  test("vendors all 50 card.v0 kinds at the pinned kit revision, each with a catalog app", () => {
    expect(EPHEMERAL_KIT_REV).toBe("63e06b29ffb0d7c5b9d482abebc0312335897321");
    expect(EPHEMERAL_KINDS.length).toBe(50);
    for (const kind of EPHEMERAL_KINDS) expect(EPHEMERAL_APPS_BY_KIND[kind].length).toBeGreaterThan(0);
  });

  test("every kind parses to a host-drawn card; app defaults to the first catalog app", () => {
    for (const kind of EPHEMERAL_KINDS) {
      expect(fence(`root = EphemeralCard("${kind}")`)).toEqual({ state: "ready", tree: { type: "EphemeralCard", kind, app: EPHEMERAL_APPS_BY_KIND[kind][0] } });
    }
    expect(fence('root = Stack([Text("Inbox"), EphemeralCard("inbox", "gmail")])')).toEqual({ state: "ready", tree: { type: "Stack", children: [{ type: "Text", value: "Inbox" }, { type: "EphemeralCard", kind: "inbox", app: "gmail" }] } });
  });

  test("rejects unknown kinds, apps that do not list the kind, extra props and more than ten cards", () => {
    expect(fence('root = EphemeralCard("bogus")').state).toBe("invalid");
    expect(fence('root = EphemeralCard("inbox", "uber")')).toEqual({ state: "invalid", reason: "Unknown ephemeral-ui kind or app" });
    expect(fence('root = EphemeralCard("inbox", "gmail", "x")').state).toBe("invalid");
    expect(fence(`root = Stack([${Array(11).fill('EphemeralCard("inbox")').join(", ")}])`)).toEqual({ state: "invalid", reason: "More than 10 ephemeral-ui cards" });
    expect(fence(`root = Stack([${Array(10).fill('EphemeralCard("inbox")').join(", ")}])`).state).toBe("ready");
  });

  test("the card page embeds only {kind, app, scheme}, a no-network CSP and only the fixtures the kind reads", () => {
    const spec = ephemeralCardSpec("inbox", "gmail")!;
    const page = ephemeralCardDocument(spec, "light");
    expect(page).toContain('window.__EUI_SPEC={"kind":"inbox","app":"gmail","scheme":"light"}');
    expect(page).toContain("connect-src 'none'");
    expect(page).not.toContain('"trace-fixture.json"');
    expect(ephemeralCardDocument(ephemeralCardSpec("trace-usage")!, "dark")).toContain('"trace-fixture.json"');
    expect(ephemeralCardDocument(ephemeralCardSpec("intel-value")!, "dark")).toContain('"intent-snapshot.json"');
    expect(page.match(/<\/script>/g)?.length).toBe(3);
  });

  test("card messages are bounded and become typed LiveIntents", () => {
    expect(parseEphemeralMessage({ type: "eui:size", height: 1e9 })).toEqual({ type: "eui:size", height: 2400 });
    expect(parseEphemeralMessage('{"type":"eui:eval","code":"x"}')).toBeNull();
    expect(parseEphemeralMessage({ type: "eui:intent", detail: { action: "rm -rf", label: "x" } })).toBeNull();
    const message = parseEphemeralMessage(JSON.stringify({ type: "eui:intent", detail: { v: 0, kind: "inbox", app: "gmail", action: "open", label: "Open this search in Gmail", ids: ["query:invoice", "<script>", 7], at: 1 } }));
    expect(message).toEqual({ type: "eui:intent", action: "open", label: "Open this search in Gmail", ids: ["query:invoice"], at: 1 });
    expect(ephemeralIntent(ephemeralCardSpec("inbox", "gmail")!, message as Extract<typeof message, { type: "eui:intent" }>)).toEqual({ controlId: "eui.inbox.open", value: ["query:invoice"], label: "Open this search in Gmail", surface: "ephemeral-ui:gmail" });
  });
});
