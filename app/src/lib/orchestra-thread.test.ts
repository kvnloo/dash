import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OrchestraProject } from "../catalog/orchestra";
import type { Conversation } from "../model";
import { threadTargetForAgent, threadTargetForOrchestra } from "./orchestra-thread";

const now = 1_700_000_000_000;

const dash: OrchestraProject = {
  id: "dash",
  name: "dash",
  subtitle: "phone UI + Tailscale bridge",
  agents: ["omp", "codex"],
  chatIds: ["live:omp:aaa"],
  status: "active",
  updatedAt: now,
  topologyId: "mesh",
  providerId: "omp",
};

function chat(partial: Partial<Conversation> & Pick<Conversation, "id" | "harness">): Conversation {
  return {
    title: partial.title ?? partial.id,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    messages: partial.messages ?? [],
    sessionId: partial.sessionId,
    cwd: partial.cwd,
    ...partial,
  };
}

describe("orchestra live thread targets", () => {
  test("tapping a live node opens that thread", () => {
    const live = chat({
      id: "live:omp:aaa",
      harness: "omp",
      sessionId: "aaa",
      updatedAt: now + 10,
    });
    const stale = chat({
      id: "codex-old",
      harness: "codex",
      updatedAt: now,
    });
    expect(threadTargetForOrchestra(dash, [stale, live])).toEqual({
      kind: "chat",
      conversationId: "live:omp:aaa",
    });
  });

  test("tapping a node with no chats opens the product detail", () => {
    expect(threadTargetForOrchestra({ ...dash, chatIds: [], agents: ["hermes"] }, [])).toEqual({
      kind: "detail",
      orchestraId: "dash",
    });
  });

  test("tapping an agent with a linked chat opens that thread", () => {
    const live = chat({ id: "live:omp:aaa", harness: "omp", sessionId: "aaa" });
    expect(threadTargetForAgent("omp", [live])).toEqual({ kind: "chat", conversationId: "live:omp:aaa" });
  });

  test("tapping an agent with no chat creates a real thread", () => {
    expect(threadTargetForAgent("codex", [])).toEqual({ kind: "create", harnessId: "codex" });
  });

  test("Orchestra pane and detail call the thread helpers", () => {
    const pane = readFileSync(join(import.meta.dir, "../screens/panes/OrchestraPane.tsx"), "utf8");
    const detail = readFileSync(join(import.meta.dir, "../screens/OrchestraDetailScreen.tsx"), "utf8");
    expect(pane).toContain("threadTargetForOrchestra");
    expect(detail).toContain("threadTargetForAgent");
    expect(detail).toContain("navigate(\"Chat\")");
  });
});
