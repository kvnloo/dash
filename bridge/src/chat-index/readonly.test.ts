import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AgentsviewFixture, engineConfig, HermesFixture, tempDir } from "../fixtures/chat-index/make-fixtures";
import { ChatIndexEngine } from "./worker";

function fingerprint(path: string) {
  const stat = statSync(path);
  return { mtimeMs: stat.mtimeMs, size: stat.size, sha256: new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex") };
}

describe("archive write boundary", () => {
  test("AgentsView and Hermes files are byte-identical after ingest, list, search, history and message", async () => {
    const dir = tempDir();
    const av = new AgentsviewFixture(join(dir, "av.db"));
    av.session({ id: "codex:c1", agent: "codex", first_message: "flamingo chat" });
    const avMsg = av.message({ session_id: "codex:c1", ordinal: 0, role: "user", content: "flamingo body" });
    av.close();
    const hz = new HermesFixture(join(dir, "hermes"));
    hz.session({ id: "s1", title: "hermes flamingo" });
    hz.message("s1", "user", "flamingo in hermes", 1_790_000_001);
    hz.close();
    const before = { av: fingerprint(av.path), hz: fingerprint(hz.path) };
    await Bun.sleep(20);
    const self = { id: "0", name: "groot" };
    const engine = new ChatIndexEngine(engineConfig(dir, { agentsviewPath: av.path }));
    const search = new ChatIndexEngine(engineConfig(dir, { agentsviewPath: av.path, role: "search" }));
    try {
      await engine.start();
      await engine.ingest();
      expect(engine.list({ limit: 50, fh: "f", kinds: [], hosts: [], chatable: false, self }).items.length).toBe(2);
      expect(engine.titleSearch({ q: "flamingo", qh: "q", limit: 10, kinds: [], hosts: [], self }).hits.length).toBe(2);
      expect(search.msgSearch({ q: "flamingo", limit: 10, positions: "start", exclude: [], kinds: [], hosts: [], self }).hits.length).toBe(2);
      expect((await engine.history({ key: "@self:codex:c1", limit: 10, self })).messages.length).toBe(1);
      expect((await engine.history({ key: "@self:hermes:s1:default", limit: 10, self })).messages.length).toBe(1);
      expect(engine.message({ key: "@self:codex:c1", id: `av:${avMsg}` }).text).toBe("flamingo body");
      expect(engine.wsHistory({ kind: "codex", sessionId: "c1" }).messages.length).toBe(1);
    } finally {
      engine.stop();
      search.stop();
    }
    expect(fingerprint(av.path)).toEqual(before.av);
    expect(fingerprint(hz.path)).toEqual(before.hz);
  });
});
