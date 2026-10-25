import { describe, expect, test } from "bun:test";
import { MAX_ATTACHMENTS_PER_TURN } from "../../../shared/protocol";
import { parseConversation, parseSettings } from "../model";

// Synthetic persisted rows only. No storage, timers, network, device, or global mocks.
const upload = {
  id: "a".repeat(32),
  name: "fixture.txt",
  mime: "text/plain",
  size: 7,
};
const identity = {
  url: "http://100.89.45.123:4788",
  issuer: "urn:dash2-181",
  kid: "k".repeat(43),
  credentialId: "cred_0123456789abcdef",
};

function diskUser(id = "dash2-181-user"): Record<string, unknown> {
  return {
    id,
    role: "user",
    text: "Keep original bytes",
    at: 1_700_000_000_001,
    attachments: [upload],
    delivery: "queued",
    deliveryAt: 1_700_000_000_002,
    deliveryNote: "Awaiting host",
  };
}

function diskAssistant(id = "dash2-181-assistant"): Record<string, unknown> {
  return {
    id,
    role: "assistant",
    text: "Working",
    at: 1_700_000_000_003,
    state: "streaming",
    turnId: "Turn/CaseSensitive:001",
    seq: 2,
    delivery: "started",
    status: "reading",
    handoff: "queued",
    parts: [{ kind: "tool_start", callId: "Call/Exact:ABc", name: "read", summary: "Read fixture", args: "{}" }],
    summaries: [{ blockId: "block-181", kind: "live", text: "Planning", model: "test-model", durationMs: 4 }],
    activity: ["reading"],
  };
}

function diskConversation(label: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "dash2-181-conversation-" + label,
    harness: "codex",
    title: "Synthetic thread",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_005,
    sessionId: "Session/Exact:AbC",
    targetHostId: "Host/Exact:AbC",
    profileId: "Profile/Exact:AbC",
    profileName: "Test profile",
    cwd: "/workspace/fixture",
    messageCount: 2,
    detailMode: "Full",
    summariesEnabled: true,
    deliverQueuedAsOne: false,
    queueWaitForIdle: true,
    queuePreview: "two turns",
    messages: [diskUser(), diskAssistant()],
    ...overrides,
  };
}

describe("parseSettings: persisted boundary", () => {
  test("keeps legacy defaults and exact validated identity metadata, never a credential", () => {
    expect(parseSettings({ address: "host:4747", token: "", harness: "hermes" })).toEqual({
      address: "host:4747",
      token: "",
      harness: "hermes",
      cwd: undefined,
      inAppFeedback: true,
      handedness: "right",
    });
    expect(parseSettings({
      address: "100.89.45.123:4747",
      token: "fixture-token",
      harness: "codex",
      cwd: "/A/CaseSensitive",
      identity,
      handedness: "left",
      inAppFeedback: false,
      credential: "never-persist-this",
    })).toEqual({
      address: "100.89.45.123:4747",
      token: "fixture-token",
      harness: "codex",
      cwd: "/A/CaseSensitive",
      identity,
      handedness: "left",
      inAppFeedback: false,
    });
  });

  test("rejects missing, null, array, or wrongly typed required settings", () => {
    const good = { address: "host:4747", token: "fixture", harness: "codex" };
    const inputs: unknown[] = [
      undefined, null, false, 4, "settings", [], {},
      { ...good, address: undefined }, { ...good, address: null },
      { ...good, token: [] }, { ...good, token: 7 },
      { ...good, harness: {} }, { ...good, harness: false },
    ];
    for (const raw of inputs) expect(parseSettings(raw)).toBeNull();
  });

  test("fails closed on present malformed enrollment; does not invent cwd or handedness", () => {
    const good = { address: "host:4747", token: "", harness: "codex" };
    for (const bad of [null, [], {}, "identity", { ...identity, kid: "bad" }, { ...identity, credentialId: "" }]) {
      expect(parseSettings({ ...good, identity: bad })).toBeNull();
    }
    expect(parseSettings({ ...good, cwd: [], handedness: "LEFT" })).toEqual({
      ...good, cwd: undefined, inAppFeedback: true, handedness: "right",
    });
  });
});

describe("parseConversation: valid persisted control", () => {
  test("preserves exact host/profile/session, attachment, turn and tool-call identities", () => {
    expect(parseConversation(diskConversation("positive"))).toEqual({
      id: "dash2-181-conversation-positive",
      harness: "codex",
      title: "Synthetic thread",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_005,
      sessionId: "Session/Exact:AbC",
      targetHostId: "Host/Exact:AbC",
      profileId: "Profile/Exact:AbC",
      profileName: "Test profile",
      cwd: "/workspace/fixture",
      messageCount: 2,
      detailMode: "Full",
      summariesEnabled: true,
      deliverQueuedAsOne: false,
      queueWaitForIdle: true,
      queuePreview: "two turns",
      stale: false,
      messages: [
        {
          id: "dash2-181-user",
          role: "user",
          text: "Keep original bytes",
          at: 1_700_000_000_001,
          attachments: [upload],
          delivery: "queued",
          deliveryAt: 1_700_000_000_002,
          deliveryNote: "Awaiting host",
        },
        {
          id: "dash2-181-assistant",
          role: "assistant",
          text: "Working",
          at: 1_700_000_000_003,
          state: "streaming",
          turnId: "Turn/CaseSensitive:001",
          seq: 2,
          delivery: "started",
          status: "reading",
          handoff: "queued",
          parts: [{ kind: "tool_start", callId: "Call/Exact:ABc", name: "read", summary: "Read fixture", args: "{}" }],
          summaries: [{ blockId: "block-181", kind: "live", text: "Planning", model: "test-model", durationMs: 4 }],
          activity: ["reading"],
          error: undefined,
        },
      ],
    });
  });

  test("old rows receive safe defaults; an unknown option field never becomes an approval", () => {
    const row = diskConversation("legacy", {
      sessionId: undefined, targetHostId: undefined, profileId: undefined,
      profileName: undefined, cwd: undefined, messageCount: undefined,
      detailMode: "invalid", deliverQueuedAsOne: undefined, summariesEnabled: undefined,
      queueWaitForIdle: undefined, queuePreview: undefined, messages: [],
      optionId: "not-a-persisted-approval",
    });
    const result = parseConversation(row);
    expect(result?.messages).toEqual([]);
    expect(result?.deliverQueuedAsOne).toBe(true);
    expect(result?.queueWaitForIdle).toBe(false);
    expect(result?.summariesEnabled).toBe(false);
    expect(result?.detailMode).toBeUndefined();
    expect(result?.sessionId).toBeUndefined();
    expect(result?.targetHostId).toBeUndefined();
    expect(result?.profileId).toBeUndefined();
    expect(result && Object.hasOwn(result, "optionId")).toBe(false);
  });
});

describe("parseConversation: mandatory shapes and message states", () => {
  test("rejects malformed root types and missing/wrong-type required fields", () => {
    const inputs: unknown[] = [
      undefined, null, "", false, 0, [], {},
      diskConversation("missing-id", { id: undefined }),
      diskConversation("null-id", { id: null }),
      diskConversation("bad-harness", { harness: [] }),
      diskConversation("bad-title", { title: {} }),
      diskConversation("bad-created", { createdAt: "1700000000000" }),
      diskConversation("bad-updated", { updatedAt: null }),
      diskConversation("missing-messages", { messages: undefined }),
      diskConversation("object-messages", { messages: {} }),
    ];
    for (const raw of inputs) expect(parseConversation(raw)).toBeNull();
  });

  test("invalid nested rows are discarded without promoting a role or turn", () => {
    const valid = diskUser("dash2-181-good-user");
    const rows: unknown[] = [
      null, [], "user", {}, { ...valid, role: "system" },
      { ...valid, role: null }, { ...valid, id: 17 },
      { ...valid, text: [] }, { ...valid, at: "1700000000001" },
      { ...diskAssistant("no-state"), state: "DONE" },
      { ...diskAssistant("null-state"), state: null },
      { ...diskAssistant("missing-turn"), turnId: undefined },
      { ...diskAssistant("wrong-turn"), turnId: 404 },
      valid,
    ];
    const result = parseConversation(diskConversation("bad-rows", { messages: rows }));
    const positive = parseConversation(diskConversation("good-row", { messages: [valid] }));
    expect(result?.messages).toEqual(positive?.messages);
    expect(result?.messages.map(message => message.id)).toEqual(["dash2-181-good-user"]);
  });

  test("wrong-type routing fields cannot invent a host, profile or native session", () => {
    const parsed = parseConversation(diskConversation("bad-routing-types", {
      sessionId: [], targetHostId: { id: "fake" }, profileId: true, cwd: 42,
      messageCount: "2",
    }));
    expect(parsed?.sessionId).toBeUndefined();
    expect(parsed?.targetHostId).toBeUndefined();
    expect(parsed?.profileId).toBeUndefined();
    expect(parsed?.cwd).toBeUndefined();
    expect(parsed?.messageCount).toBeUndefined();
  });
});

describe("parseConversation: fail-closed regressions for Hermes", () => {
  // The source at the claimed branch uses typeof number, which accepts NaN and Infinity.
  // These assertions intentionally describe the safe boundary; production fixes are out of scope.
  for (const sample of [
    { label: "NaN", value: Number.NaN },
    { label: "positive-infinity", value: Number.POSITIVE_INFINITY },
    { label: "negative-infinity", value: Number.NEGATIVE_INFINITY },
  ]) {
    test("rejects non-finite root timestamps: " + sample.label, () => {
      expect(parseConversation(diskConversation("created-" + sample.label, { createdAt: sample.value }))).toBeNull();
      expect(parseConversation(diskConversation("updated-" + sample.label, { updatedAt: sample.value }))).toBeNull();
    });
    test("does not hydrate a message with non-finite timestamp: " + sample.label, () => {
      const parsed = parseConversation(diskConversation("at-" + sample.label, {
        messages: [{ ...diskUser("bad-at-" + sample.label), at: sample.value }],
      }));
      expect(parsed?.messages).toEqual([]);
    });
  }

  for (const id of ["", "   "]) {
    test("empty/blank conversation id cannot become a real conversation", () => {
      expect(parseConversation(diskConversation("empty-conversation-id", { id }))).toBeNull();
    });
    test("empty/blank message and bridge turn ids cannot be reattached", () => {
      const parsed = parseConversation(diskConversation("empty-message-ids", {
        messages: [diskUser(id), { ...diskAssistant("assistant-" + id), turnId: id }],
      }));
      expect(parsed?.messages).toEqual([]);
    });
  }

  test("duplicate message ids never become two live keyed rows", () => {
    const parsed = parseConversation(diskConversation("duplicate-key", {
      messages: [diskUser("same-id"), diskAssistant("same-id")],
    }));
    expect(parsed?.messages.map(message => message.id)).toEqual(["same-id"]);
  });

  test("empty routing identifiers are absent rather than usable live targets", () => {
    const parsed = parseConversation(diskConversation("empty-routes", {
      sessionId: " ", targetHostId: "", profileId: "  ",
    }));
    expect(parsed?.sessionId).toBeUndefined();
    expect(parsed?.targetHostId).toBeUndefined();
    expect(parsed?.profileId).toBeUndefined();
  });

  for (const seq of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
    test("invalid sequence cannot create an attachable assistant turn: " + String(seq), () => {
      const parsed = parseConversation(diskConversation("bad-seq-" + String(seq), {
        messages: [{ ...diskAssistant("bad-seq"), seq }],
      }));
      expect(parsed?.messages).toEqual([]);
    });
  }

  test("non-finite optional timing/count fields are not persisted as metrics", () => {
    const parsed = parseConversation(diskConversation("bad-optional-numbers", {
      messageCount: Number.POSITIVE_INFINITY,
      messages: [{ ...diskUser("bad-delivery-at"), deliveryAt: Number.NaN }],
    }));
    expect(parsed?.messageCount).toBeUndefined();
    expect(parsed?.messages[0]?.role).toBe("user");
    const user = parsed?.messages[0];
    if (user?.role !== "user") throw new Error("Expected a persisted user row");
    expect(user.deliveryAt).toBeUndefined();
  });

  const tooManyDistinctUploads = Array.from(
    { length: MAX_ATTACHMENTS_PER_TURN + 1 },
    (_, index) => ({ ...upload, id: index.toString(16).padStart(32, "0") }),
  );
  for (const entry of [
    { label: "null", attachments: null },
    { label: "object-not-array", attachments: { ...upload } },
    { label: "wrong-id", attachments: [{ ...upload, id: "bad-id" }] },
    { label: "empty-name", attachments: [{ ...upload, name: "" }] },
    { label: "negative-size", attachments: [{ ...upload, size: -1 }] },
    { label: "non-finite-size", attachments: [{ ...upload, size: Number.POSITIVE_INFINITY }] },
    { label: "mixed-valid-and-invalid", attachments: [upload, null] },
    { label: "duplicate-ids", attachments: [upload, { ...upload }] },
    { label: "too-many-distinct-ids", attachments: tooManyDistinctUploads },
  ]) {
    test("malformed uploads cannot silently turn into a text-only send: " + entry.label, () => {
      const parsed = parseConversation(diskConversation("bad-upload-" + entry.label, {
        messages: [{ ...diskUser("bad-upload-" + entry.label), attachments: entry.attachments }],
      }));
      expect(parsed?.messages).toEqual([]);
    });
  }
});
