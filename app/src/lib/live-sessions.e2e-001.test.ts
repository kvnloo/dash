import { describe, expect, test } from "bun:test";
import type { HostInfo } from "../../../shared/protocol";
import type { AssistantState, Conversation } from "../model";
import { queuedParts } from "./pending-queue";
import { mergeLiveConversations, shouldRequestHistory } from "./live-sessions";

const now = 1_700_000_000_000;

/** An ACP session created by the paired bridge, with no native OMP process/tab. */
const paired: HostInfo = {
  id: "paired",
  name: "Laptop",
  hostname: "laptop",
  online: true,
  self: true,
  agents: [{ id: "harness:omp", name: "OMP", kind: "omp", status: "available" }],
};

const streaming: Conversation = {
  id: "phone-chat",
  harness: "omp",
  title: "Bridge ACP conversation",
  createdAt: now - 100,
  updatedAt: now,
  sessionId: "acp-session",
  targetHostId: "paired",
  profileId: "harness:omp",
  stale: false,
  messages: [
    { id: "user-1", role: "user", text: "Long request", at: now - 100 },
    { id: "reply-1", role: "assistant", text: "partial output", at: now, state: "streaming", turnId: "turn-running", seq: 4 },
  ],
};

function withState(state: AssistantState): Conversation {
  return {
    ...streaming,
    messages: streaming.messages.map(message => message.role === "assistant" ? { ...message, state } : message),
  };
}

describe("DASH-E2E-001: bridge-owned ACP sessions absent from the native roster", () => {
  test("a roster refresh cannot end an actively streaming bridge-owned session", () => {
    const before = [streaming];
    const after = mergeLiveConversations(before, [paired], now + 1);
    expect(after).toBe(before);
    expect(after[0]).toBe(streaming);
    expect(after[0]).toMatchObject({
      id: "phone-chat",
      harness: "omp",
      sessionId: "acp-session",
      targetHostId: "paired",
      profileId: "harness:omp",
      stale: false,
    });
    expect(shouldRequestHistory(after[0])).toBe(false);
    expect(mergeLiveConversations(after, [paired], now + 2)).toBe(after);
  });

  test("a new unscoped ACP chat stays live without inventing host or profile identity", () => {
    const unscoped: Conversation = { ...streaming, targetHostId: undefined, profileId: undefined };
    const before = [unscoped];
    const after = mergeLiveConversations(before, [paired], now + 1);
    expect(after).toBe(before);
    expect(after[0]?.stale).toBe(false);
    expect(after[0]?.sessionId).toBe("acp-session");
    expect(after[0]?.targetHostId).toBeUndefined();
    expect(after[0]?.profileId).toBeUndefined();
    const settled = { ...unscoped, messages: withState("done").messages };
    const ended = mergeLiveConversations([settled], [paired], now + 2);
    expect(ended[0]?.stale).toBe(true);
  });

  test("a follow-up stays queued against the same running session and retains its payload", () => {
    const queued: Conversation = {
      ...streaming,
      messages: [
        ...streaming.messages,
        { id: "user-2", role: "user", text: "Follow up", at: now + 1, delivery: "queued" },
        { id: "reply-2", role: "assistant", text: "", at: now + 1, state: "pending", turnId: "turn-queued", seq: 0 },
      ],
    };
    const after = mergeLiveConversations([queued], [paired], now + 2);
    expect(after[0]).toBe(queued);
    expect(after[0]?.stale).toBe(false);
    expect(after[0]?.sessionId).toBe(streaming.sessionId);
    expect(after[0]?.targetHostId).toBe(streaming.targetHostId);
    expect(after[0]?.profileId).toBe(streaming.profileId);
    expect(queuedParts(after[0]!)).toMatchObject([{
      user: { id: "user-2", text: "Follow up", delivery: "queued" },
      assistant: { id: "reply-2", turnId: "turn-queued", state: "pending" },
    }]);
  });

  for (const state of ["done", "interrupted", "error", "pending"] satisfies AssistantState[]) {
    test(`once the turn is ${state}, an absent session is not kept alive by the harness profile`, () => {
      const settled = withState(state);
      const after = mergeLiveConversations([settled], [paired], now + 10);
      expect(after[0]).toMatchObject({
        id: settled.id,
        sessionId: settled.sessionId,
        targetHostId: settled.targetHostId,
        profileId: settled.profileId,
        stale: true,
      });
      expect(after[0]?.messages).toBe(settled.messages);
      expect(shouldRequestHistory(after[0])).toBe(false);
      // Subsequent snapshots must not churn already ended rows.
      expect(mergeLiveConversations(after, [paired], now + 11)).toBe(after);
    });
  }

  test("an authoritative native session end still clears its host-surface state while streaming", () => {
    const native = { ...streaming, profileId: "omp:tab", openIn: "CLI" };
    const nativeHost: HostInfo = {
      ...paired,
      agents: [{ id: "omp:tab", name: "OMP tab", kind: "omp", status: "running" }],
    };
    const after = mergeLiveConversations([native], [nativeHost], now + 1);
    expect(after[0]).toMatchObject({
      id: native.id,
      targetHostId: native.targetHostId,
      profileId: "omp:tab",
      sessionId: native.sessionId,
      stale: true,
      openIn: undefined,
    });
  });

  test("only one online paired host with one unbound, available, matching harness profile qualifies", () => {
    const other = { ...paired, id: "other" };
    const variants: Array<{ label: string; hosts: HostInfo[]; chat?: Conversation }> = [
      { label: "no roster host", hosts: [] },
      { label: "wrong host", hosts: [other] },
      { label: "host offline", hosts: [{ ...paired, online: false }] },
      { label: "not paired to this bridge", hosts: [{ ...paired, self: false }] },
      { label: "harness missing", hosts: [{ ...paired, agents: [] }] },
      { label: "harness offline", hosts: [{ ...paired, agents: [{ ...paired.agents[0]!, status: "offline" }] }] },
      { label: "harness kind changed", hosts: [{ ...paired, agents: [{ ...paired.agents[0]!, kind: "codex" }] }] },
      { label: "native session changed", hosts: [{ ...paired, agents: [{ ...paired.agents[0]!, sessionId: "different-session" }] }] },
      { label: "duplicate profile", hosts: [{ ...paired, agents: [...paired.agents, ...paired.agents] }] },
      { label: "duplicate host identity", hosts: [paired, paired] },
      { label: "native-profile identity", hosts: [paired], chat: { ...streaming, profileId: "omp:tab" } },
      { label: "partial scope missing host", hosts: [paired], chat: { ...streaming, targetHostId: undefined } },
      { label: "partial scope missing profile", hosts: [paired], chat: { ...streaming, profileId: undefined } },
      { label: "unscoped ambiguous paired hosts", hosts: [paired, { ...other, self: true }], chat: { ...streaming, targetHostId: undefined, profileId: undefined } },
      { label: "already authoritatively stale", hosts: [paired], chat: { ...streaming, stale: true } },
      { label: "unknown harness", hosts: [{ ...paired, agents: [{ id: "harness:not-catalog", name: "Unknown", kind: "not-catalog", status: "available" }] }], chat: { ...streaming, harness: "not-catalog", profileId: "harness:not-catalog" } },
    ];
    for (const { label, hosts, chat = streaming } of variants) {
      const result = mergeLiveConversations([chat], hosts, now + 1);
      const original = result.find(item => item.id === chat.id);
      expect(original?.stale, label).toBe(true);
      expect(original?.targetHostId, label).toBe(chat.targetHostId);
      expect(original?.profileId, label).toBe(chat.profileId);
      expect(original?.sessionId, label).toBe(chat.sessionId);
    }
  });

  test("a uniquely reported native session still reconciles normally without changing target identity", () => {
    const native = { ...streaming, profileId: "omp:tab", stale: true };
    const nativeHost: HostInfo = {
      ...paired,
      agents: [{ id: "omp:tab", name: "OMP tab", kind: "omp", status: "running", sessionId: "acp-session" }],
    };
    const after = mergeLiveConversations([native], [nativeHost], now + 3);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: native.id,
      sessionId: native.sessionId,
      targetHostId: native.targetHostId,
      profileId: native.profileId,
      stale: false,
    });
    expect(after[0]?.messages).toBe(native.messages);
  });
});
