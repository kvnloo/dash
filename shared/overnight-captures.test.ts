import { describe, expect, test } from "bun:test";
import {
  CAPTURE_DEDUPE_MS,
  MAX_CAPTURE_TEXT_LENGTH,
  MAX_OVERNIGHT_CAPTURES,
  addCapture,
  dismiss,
  markPlanned,
  morningList,
  parseCaptures,
  type Capture,
  type CaptureInput,
} from "./overnight-captures";

function capture(id: string, capturedAt: number, patch: Partial<Capture> = {}): Capture {
  return {
    id,
    text: "note " + id,
    capturedAt,
    attachments: 0,
    status: "queued",
    ...patch,
  };
}

describe("bedtime capture-only queue", () => {
  test("adds a bounded, trimmed note with stable metadata without creating an agent turn", () => {
    const before: Capture[] = [];
    const input: CaptureInput = { text: "  remember to review this  ", conversationId: "chat-1", attachments: 2 };
    let idsRequested = 0;
    const after = addCapture(before, input, 1_000, () => {
      idsRequested++;
      return "capture-1";
    });

    expect(after).toEqual([{
      id: "capture-1",
      text: "remember to review this",
      conversationId: "chat-1",
      capturedAt: 1_000,
      attachments: 2,
      status: "queued",
    }]);
    expect(before).toEqual([]);
    expect(input.text).toBe("  remember to review this  ");
    expect(idsRequested).toBe(1);
    expect(addCapture([], { text: "bare note" }, 0, () => "bare")).toEqual([
      capture("bare", 0, { text: "bare note" }),
    ]);
  });

  test("rejects empty notes and bad metadata before allocating an ID", () => {
    const queue = [capture("existing", 12)];
    const invalid: CaptureInput[] = [
      { text: "" },
      { text: "    \n\t " },
      { text: "hello", attachments: -1 },
      { text: "hello", attachments: 0.5 },
      { text: "hello", attachments: Infinity },
      { text: "hello", conversationId: "" },
      { text: "hello", conversationId: "bad id" },
    ];

    let called = 0;
    const id = () => {
      called++;
      return "new";
    };
    for (const item of invalid) {
      expect(addCapture(queue, item, 1_000, id)).toBe(queue);
    }
    for (const badTime of [-1, Infinity, -Infinity, NaN]) {
      expect(addCapture(queue, { text: "valid" }, badTime, id)).toBe(queue);
    }
    expect(called).toBe(0);
    expect(addCapture(queue, { text: "different" }, 1_000, () => "existing")).toBe(queue);
    expect(addCapture(queue, { text: "different" }, 1_000, () => " ")).toBe(queue);
  });

  test("truncates at 4,000 UTF-16 units with ellipsis and no broken surrogate pair", () => {
    const exact = addCapture([], { text: "a".repeat(MAX_CAPTURE_TEXT_LENGTH) }, 1, () => "exact");
    expect(exact[0]?.text).toBe("a".repeat(MAX_CAPTURE_TEXT_LENGTH));

    const truncated = addCapture([], { text: "x".repeat(6_000) }, 1, () => "long");
    expect(truncated[0]?.text).toBe("x".repeat(MAX_CAPTURE_TEXT_LENGTH - 1) + "…");
    expect(truncated[0]?.text.length).toBe(MAX_CAPTURE_TEXT_LENGTH);

    const unicode = addCapture([], { text: "a".repeat(3_998) + "😀" + "z" }, 1, () => "emoji");
    expect(unicode[0]?.text).toBe("a".repeat(3_998) + "…");
    expect(unicode[0]?.text.includes("\ufffd")).toBe(false);
  });

  test("dedupes identical stored text for two minutes including the boundary", () => {
    const first = addCapture([], { text: "  reminder  " }, 10_000, () => "one");
    const planned = markPlanned(first, ["one"]);
    const dismissed = dismiss(planned, "one");
    let calls = 0;
    const nextId = () => {
      calls++;
      return "two";
    };
    for (const queue of [first, planned, dismissed]) {
      expect(addCapture(queue, { text: "reminder" }, 10_000 + CAPTURE_DEDUPE_MS, nextId)).toBe(queue);
    }
    expect(calls).toBe(0);

    const outside = addCapture(first, { text: "reminder" }, 10_001 + CAPTURE_DEDUPE_MS, nextId);
    expect(outside).toHaveLength(2);
    expect(outside[1]?.id).toBe("two");
    expect(calls).toBe(1);

    // A future-dated entry must not suppress a valid capture after clock correction.
    const rewound = addCapture(first, { text: "reminder" }, 9_999, () => "before");
    expect(rewound).toHaveLength(2);
    expect(addCapture(first, { text: "another reminder" }, 10_100, () => "other")).toHaveLength(2);
  });

  test("caps at 200: discard oldest dismissed, then oldest queued", () => {
    const dismissedFirst: Capture[] = [
      capture("planned", 0, { status: "planned" }),
      capture("dismissed-newer", 9, { status: "dismissed" }),
      capture("dismissed-older", 5, { status: "dismissed" }),
      ...Array.from({ length: 197 }, (_, i) => capture("queued-" + i, i + 10)),
    ];
    expect(dismissedFirst).toHaveLength(MAX_OVERNIGHT_CAPTURES);
    const updated = addCapture(dismissedFirst, { text: "new thought" }, 1_000, () => "fresh");
    expect(updated).toHaveLength(MAX_OVERNIGHT_CAPTURES);
    expect(updated.some(item => item.id === "dismissed-older")).toBe(false);
    expect(updated.some(item => item.id === "dismissed-newer")).toBe(true);
    expect(updated.at(-1)?.id).toBe("fresh");
    expect(dismissedFirst).toHaveLength(MAX_OVERNIGHT_CAPTURES);

    const queued = Array.from({ length: 200 }, (_, i) => capture("q" + i, 200 - i));
    const withoutOldest = addCapture(queued, { text: "latest" }, 300, () => "latest");
    expect(withoutOldest).toHaveLength(200);
    expect(withoutOldest.some(item => item.id === "q199")).toBe(false);
    expect(withoutOldest.at(-1)?.id).toBe("latest");

    // Even a queue full of planned notes cannot swallow a fresh capture.
    const planned = Array.from({ length: 200 }, (_, i) => capture("p" + i, i, { status: "planned" }));
    const full = addCapture(planned, { text: "urgent" }, 201, () => "urgent");
    expect(full).toHaveLength(200);
    expect(full.some(item => item.id === "p0")).toBe(false);
    expect(full.at(-1)?.id).toBe("urgent");
  });

  test("morning list filters by time and queued state, sorts oldest first, then groups by conversation", () => {
    const queue = [
      capture("a", 140, { conversationId: "alpha" }),
      capture("old", 50, { conversationId: "alpha" }),
      capture("b", 100, { conversationId: "beta" }),
      capture("unassigned2", 190),
      capture("alpha2", 160, { conversationId: "alpha" }),
      capture("unassigned1", 130),
      capture("planned", 110, { conversationId: "beta", status: "planned" }),
      capture("dismissed", 120, { status: "dismissed" }),
    ];

    const result = morningList(queue, 100);
    expect(result.map(group => group.conversationId)).toEqual(["beta", undefined, "alpha"]);
    expect(result.map(group => group.captures.map(item => item.id))).toEqual([
      ["b"],
      ["unassigned1", "unassigned2"],
      ["a", "alpha2"],
    ]);
    expect(Object.keys(result[1] ?? {})).toEqual(["captures"]);
    expect(morningList(queue, 191)).toEqual([]);
    expect(morningList(queue, NaN)).toEqual([]);
    expect(morningList(queue, -1)).toEqual([]);
    expect(queue[0]?.id).toBe("a");
  });

  test("planning and dismissal are pure, idempotent and ignore unknown IDs", () => {
    const queue = [
      capture("a", 1),
      capture("b", 2, { status: "planned" }),
      capture("c", 3, { status: "dismissed" }),
    ];
    expect(markPlanned(queue, ["missing"])).toBe(queue);
    expect(markPlanned(queue, [])).toBe(queue);
    const planned = markPlanned(queue, ["a", "b", "c", "missing", "a"]);
    expect(planned.map(item => item.status)).toEqual(["planned", "planned", "dismissed"]);
    expect(queue.map(item => item.status)).toEqual(["queued", "planned", "dismissed"]);
    expect(planned[1]).toBe(queue[1]);
    expect(markPlanned(planned, ["a"])).toBe(planned);

    expect(dismiss(planned, "unknown")).toBe(planned);
    const dismissed = dismiss(planned, "b");
    expect(dismissed.map(item => item.status)).toEqual(["planned", "dismissed", "dismissed"]);
    expect(planned[1]?.status).toBe("planned");
    expect(dismiss(dismissed, "b")).toBe(dismissed);
    expect(markPlanned(dismissed, ["b"])).toBe(dismissed);
  });
});

describe("strict persisted/bridge capture parser", () => {
  test("round-trips valid captures, strips extra fields and preserves optional identity", () => {
    const a = capture("a", 0, { text: "Valid", attachments: 2, conversationId: "chat-1" });
    const b = capture("b", 1.5, { status: "dismissed" });
    const raw = [{ ...a, injected: "ignored" }, JSON.parse(JSON.stringify(b))];
    expect(parseCaptures(raw)).toEqual([a, b]);
    expect(parseCaptures([a, { ...a, text: "collision" }, b])).toEqual([a, b]);
    expect(parseCaptures([a])).not.toBe(raw);
    expect(raw[0]).toHaveProperty("injected");
  });

  test("drops bad rows individually without repairing malformed identities or counts", () => {
    const good = capture("good", 1);
    const next = capture("next", 2);
    const badRows: unknown[] = [
      null, undefined, 0, false, "", [], {}, new Date(0),
      { ...good, id: "" },
      { ...good, id: " " },
      { ...good, id: "white space" },
      { ...good, id: "i".repeat(257) },
      { ...good, text: "" },
      { ...good, text: " " },
      { ...good, text: "  padded  " },
      { ...good, text: "x".repeat(4_001) },
      { ...good, capturedAt: -1 },
      { ...good, capturedAt: Infinity },
      { ...good, capturedAt: NaN },
      { ...good, capturedAt: "123" },
      { ...good, attachments: -1 },
      { ...good, attachments: 0.5 },
      { ...good, attachments: Infinity },
      { ...good, attachments: "1" },
      { ...good, conversationId: null },
      { ...good, conversationId: "" },
      { ...good, conversationId: "bad id" },
      { ...good, status: "sent" },
      { ...good, status: null },
      { ...good, status: undefined },
    ];

    expect(parseCaptures([good, ...badRows, next])).toEqual([good, next]);
    expect(parseCaptures({ entries: [good] })).toEqual([]);
    expect(parseCaptures(null)).toEqual([]);
  });

  test("caps parsed arrays and removes dismissed before queued, regardless of input order", () => {
    const raw = [
      capture("dismissed", 5, { status: "dismissed" }),
      capture("planned", 0, { status: "planned" }),
      ...Array.from({ length: 200 }, (_, i) => capture("queued-" + i, i + 10)),
    ];
    const parsed = parseCaptures(raw);
    expect(parsed).toHaveLength(MAX_OVERNIGHT_CAPTURES);
    expect(parsed.some(item => item.id === "dismissed")).toBe(false);
    expect(parsed.some(item => item.id === "queued-0")).toBe(false);
    expect(parsed.some(item => item.id === "planned")).toBe(true);
    expect(parsed.some(item => item.id === "queued-199")).toBe(true);
  });

  test("never throws on corrupted, cyclic, throwing-getter or fuzzed inputs", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const getter = { get id(): string { throw new Error("invalid persisted getter"); } };
    const revoked = Proxy.revocable([capture("revoked", 1)], {});
    revoked.revoke();

    expect(parseCaptures([getter, capture("safe", 1), cyclic])).toEqual([capture("safe", 1)]);
    expect(() => parseCaptures(revoked.proxy)).not.toThrow();
    expect(parseCaptures(revoked.proxy)).toEqual([]);

    const atoms: unknown[] = [
      null, undefined, true, 42, -1, Infinity, NaN, "text", 1n,
      Symbol("invalid"), cyclic, getter, [cyclic], { status: "queued" },
      capture("valid", 5), { ...capture("oops", 6), attachments: -3 },
    ];
    for (let i = 0; i < 600; i++) {
      const a = atoms[(i * 7) % atoms.length];
      const b = atoms[(i * 11 + 3) % atoms.length];
      const testInput: unknown = i % 4 === 0 ? a : i % 4 === 1 ? [a, b]
        : i % 4 === 2 ? [capture("ok" + i, i), a, b]
          : [{ ...capture("invalid" + i, i), status: a }, b, capture("tail" + i, i)];
      expect(() => parseCaptures(testInput)).not.toThrow();
      expect(parseCaptures(testInput).length).toBeLessThanOrEqual(MAX_OVERNIGHT_CAPTURES);
    }
  });
});
