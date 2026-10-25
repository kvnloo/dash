import { describe, expect, test } from "bun:test";
import type { Conversation } from "../model";
import { composerSuggestions, composerTrigger, insertSuggestion } from "./composer-suggestions";
import {
  appendMentionTrigger,
  currentSuggestionLoad,
  EMPTY_SUGGESTIONS,
  loadSuggestionInventory,
  selectSuggestionTarget,
  suggestionRequestKey,
  type SuggestionSource,
} from "./composer-suggestion-request";

const pair: SuggestionSource = {
  address: "dash.local:8097",
  token: "test-token-only",
  harness: "hermes",
  cwd: "/workspace/agent project",
};

const conversations: Conversation[] = [{
  id: "local-chat-01",
  harness: "hermes",
  title: "Repair logs",
  sessionId: "native-session-123",
  createdAt: 1,
  updatedAt: 2,
  messages: [],
}];

function trigger(text: string, cursor = text.length) {
  const result = composerTrigger(text, cursor);
  if (!result) throw new Error(`Missing expected trigger in ${JSON.stringify(text)}`);
  return result;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("H-050 main and open-chat suggestions", () => {
  test("Main selects its configured harness/workspace and inserts real slash commands", async () => {
    const target = selectSuggestionTarget({
      selectedHarness: "omp",
      connectedHarness: "hermes",
      selectedCwd: "/workspace/main project",
      connectedCwd: "/workspace/other",
    });
    expect(target).toEqual({ harness: "omp", cwd: "/workspace/main project" });

    const calls: { url: string; authorization: string | null; signal?: AbortSignal }[] = [];
    const controller = new AbortController();
    const fakeFetch: typeof fetch = async (url, init) => {
      calls.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("Authorization"),
        signal: init?.signal ?? undefined,
      });
      return response({ commands: [{ name: "review", description: "Review changed files" }], files: [] });
    };
    const inventory = await loadSuggestionInventory({ ...pair, ...target }, controller.signal, fakeFetch);
    expect(calls).toEqual([{
      url: "http://dash.local:8097/suggestions?harness=omp&cwd=%2Fworkspace%2Fmain%20project",
      authorization: "Bearer test-token-only",
      signal: controller.signal,
    }]);

    const typed = "/rev";
    const suggestion = composerSuggestions(trigger(typed), inventory, [], []).find(row => row.id === "command:review");
    expect(suggestion?.label).toBe("/review");
    if (!suggestion) throw new Error("Missing advertised /review");
    expect(insertSuggestion(typed, trigger(typed), suggestion.insert)).toBe("/review ");
    expect(composerSuggestions(trigger("/nonexistent"), inventory, [], [])).toEqual([]);
  });

  test("Main @ button preserves existing text, then inserts a real file or session", () => {
    const typed = appendMentionTrigger("Please inspect the bug");
    expect(typed).toBe("Please inspect the bug @");
    const rows = composerSuggestions(
      trigger(typed),
      { commands: [], files: ["app/src/App.tsx", "bridge/src/index.ts"] },
      conversations,
      [],
    );
    expect(rows.map(row => row.id)).toEqual([
      "chat:local-chat-01", "file:app/src/App.tsx", "file:bridge/src/index.ts",
    ]);
    const file = rows.find(row => row.id === "file:app/src/App.tsx");
    const session = rows.find(row => row.id === "chat:local-chat-01");
    if (!file || !session) throw new Error("Missing a real mention source");
    expect(insertSuggestion(typed, trigger(typed), file.insert)).toBe("Please inspect the bug @app/src/App.tsx ");
    expect(insertSuggestion(typed, trigger(typed), session.insert)).toBe("Please inspect the bug @native-session-123 ");
    expect(appendMentionTrigger("")).toBe("@");
    expect(appendMentionTrigger("/review")).toBe("/review");
    expect(appendMentionTrigger("@app")).toBe("@app");
    expect(appendMentionTrigger("Please inspect  ")).toBe("Please inspect @");
  });

  test("Chat selects conversation-specific Hermes session/workspace over Main settings", () => {
    const target = selectSuggestionTarget({
      chatHarness: "hermes",
      selectedHarness: "omp",
      connectedHarness: "codex",
      chatCwd: "/workspace/conversation",
      selectedCwd: "/workspace/global",
    });
    expect(target).toEqual({ harness: "hermes", cwd: "/workspace/conversation" });

    const typed = "Inspect @app then continue";
    const cursor = typed.indexOf(" then");
    const active = trigger(typed, cursor);
    expect(active.query).toBe("app");
    const rows = composerSuggestions(active, { commands: [], files: ["app/src/Chat.tsx", "docs/README.md"] }, conversations, []);
    expect(rows.map(row => row.id)).toEqual(["file:app/src/Chat.tsx"]);
    const [file] = rows;
    if (!file) throw new Error("Missing advertised file");
    expect(insertSuggestion(typed, active, file.insert)).toBe("Inspect @app/src/Chat.tsx then continue");
    // No mention should be offered when the caret is after the completed token.
    expect(composerTrigger(typed)).toBeNull();
  });

  test("Changing harness, workspace or pairing hides old remote suggestions before the next effect", () => {
    const key = suggestionRequestKey(pair);
    const state = {
      key,
      inventory: { commands: [{ name: "hermes-only", description: "Hermes ACP" }], files: ["private/old.ts"] },
      loading: false,
    };
    expect(currentSuggestionLoad(key, state).inventory.commands[0]?.name).toBe("hermes-only");

    const changedSources: SuggestionSource[] = [
      { ...pair, harness: "omp" },
      { ...pair, cwd: "/workspace/another" },
      { ...pair, address: "new-pair.local:8097" },
      { ...pair, token: "different-credential" },
    ];
    for (const source of changedSources) {
      const changed = currentSuggestionLoad(suggestionRequestKey(source), state);
      expect(changed.inventory).toEqual(EMPTY_SUGGESTIONS);
      expect(changed.loading).toBe(true);
      expect(composerSuggestions(trigger("/"), changed.inventory, [], [])).toEqual([]);
      expect(composerSuggestions(trigger("@old"), changed.inventory, [], [])).toEqual([]);
    }
  });

  test("Local @ sessions remain actionable without the remote inventory", () => {
    const rows = composerSuggestions(trigger("@repair"), EMPTY_SUGGESTIONS, conversations, []);
    expect(rows.map(row => row.insert)).toEqual(["@native-session-123"]);
    const [session] = rows;
    if (!session) throw new Error("Missing local session");
    expect(insertSuggestion("@repair", trigger("@repair"), session.insert)).toBe("@native-session-123 ");
  });

  test("HTTP authentication, missing bridge, malformed data and transient failure remain distinct", async () => {
    const controller = new AbortController();
    const broken = (status: number): typeof fetch => async () => response({ error: "unavailable" }, status);
    await expect(loadSuggestionInventory(pair, controller.signal, broken(401))).rejects.toThrow("Pairing expired");
    await expect(loadSuggestionInventory(pair, controller.signal, broken(404))).rejects.toThrow("Update the paired bridge");
    await expect(loadSuggestionInventory(pair, controller.signal, broken(503))).rejects.toThrow("Could not load suggestions");
    await expect(loadSuggestionInventory(pair, controller.signal, async () => response({ commands: [], files: null })))
      .rejects.toThrow("Invalid suggestion inventory");

    let attempts = 0;
    const flaky: typeof fetch = async () => {
      attempts += 1;
      return attempts === 1
        ? brokenResponse()
        : response({ commands: [{ name: "help", description: "Real catalog" }], files: ["src/index.ts"] });
    };
    function brokenResponse() { return response({ error: "temporary" }, 503); }
    await expect(loadSuggestionInventory(pair, controller.signal, flaky)).rejects.toThrow("Could not load suggestions");
    const retry = await loadSuggestionInventory(pair, controller.signal, flaky);
    expect(attempts).toBe(2);
    expect(retry.commands).toEqual([{ name: "help", description: "Real catalog" }]);
    expect(retry.files).toEqual(["src/index.ts"]);
  });
});
