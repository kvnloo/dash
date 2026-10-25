import { describe, expect, test } from "bun:test";
import { createKeyedStore } from "./text";

interface ManualFrames {
  pending(): number;
  requested(): number;
  flush(): void;
}

/** A synchronous frame clock; never installs a global mock.module or real timers. */
function withManualFrames(check: (clock: ManualFrames) => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  const callbacks: FrameRequestCallback[] = [];
  let requests = 0;

  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback): number => {
      callbacks.push(callback);
      requests += 1;
      return requests;
    },
  });

  try {
    check({
      pending: () => callbacks.length,
      requested: () => requests,
      flush: () => {
        // A callback queued during a flush belongs to the *next* frame.
        const frame = callbacks.splice(0);
        for (const callback of frame) callback(0);
      },
    });
  } finally {
    callbacks.length = 0;
    if (original) Object.defineProperty(globalThis, "requestAnimationFrame", original);
    else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  }
}

describe("createKeyedStore per-reply rAF notifications", () => {
  test("coalesces a burst of same-frame appends and retains every byte", () => {
    withManualFrames((clock) => {
      const store = createKeyedStore();
      let aCalls = 0;
      let bCalls = 0;
      const unsubscribeA = store.subscribe("reply-a", () => { aCalls += 1; });
      const unsubscribeB = store.subscribe("reply-b", () => { bCalls += 1; });

      try {
        const chunks = Array.from({ length: 256 }, (_, n) => "piece-" + n + "|");
        store.set("reply-a", "prefix:");
        for (const chunk of chunks) store.append("reply-a", chunk);

        expect(store.get("reply-a")).toBe("prefix:" + chunks.join(""));
        expect(store.get("reply-b")).toBe("");
        expect(clock.requested()).toBe(1);
        expect(clock.pending()).toBe(1);
        expect(aCalls).toBe(0);
        expect(bCalls).toBe(0);

        clock.flush();
        expect(clock.pending()).toBe(0);
        expect(aCalls).toBe(1);
        expect(bCalls).toBe(0);

        store.append("reply-a", "tail");
        expect(clock.requested()).toBe(2);
        clock.flush();
        expect(aCalls).toBe(2);
        expect(bCalls).toBe(0);
        expect(store.get("reply-a")).toBe("prefix:" + chunks.join("") + "tail");
      } finally {
        unsubscribeA();
        unsubscribeB();
      }
    });
  });

  test("one shared frame notifies only the specific dirty reply keys", () => {
    withManualFrames((clock) => {
      const store = createKeyedStore();
      const calls = { left: 0, right: 0, untouched: 0 };
      const stopLeft = store.subscribe("left", () => { calls.left += 1; });
      const stopRight = store.subscribe("right", () => { calls.right += 1; });
      const stopUntouched = store.subscribe("untouched", () => { calls.untouched += 1; });

      try {
        store.append("left", "a");
        store.append("right", "x");
        store.append("left", "b");
        store.set("right", "xyz");
        expect(clock.requested()).toBe(1);
        expect(clock.pending()).toBe(1);
        clock.flush();
        expect(calls).toEqual({ left: 1, right: 1, untouched: 0 });
        expect(store.get("left")).toBe("ab");
        expect(store.get("right")).toBe("xyz");

        store.clear("left");
        expect(clock.requested()).toBe(2);
        clock.flush();
        expect(calls).toEqual({ left: 2, right: 1, untouched: 0 });
        expect(store.get("left")).toBe("");
        expect(store.get("right")).toBe("xyz");
      } finally {
        stopLeft();
        stopRight();
        stopUntouched();
      }
    });
  });

  test("absent clears, unsubscribe, listener-free writes and later resubscribe stay isolated", () => {
    withManualFrames((clock) => {
      const store = createKeyedStore();
      let oldCalls = 0;
      let newCalls = 0;

      store.clear("not-present");
      expect(clock.pending()).toBe(0);

      const stopOld = store.subscribe("reply", () => { oldCalls += 1; });
      store.append("reply", "old");
      stopOld();
      clock.flush();
      expect(oldCalls).toBe(0);

      // No listener exists for this update, so it must not notify the old one.
      store.append("reply", "-in-background");
      clock.flush();
      expect(oldCalls).toBe(0);

      const stopNew = store.subscribe("reply", () => { newCalls += 1; });
      try {
        expect(store.get("reply")).toBe("old-in-background");
        store.clear("reply");
        clock.flush();
        expect(store.get("reply")).toBe("");
        expect(newCalls).toBe(1);
        expect(oldCalls).toBe(0);

        store.clear("reply");
        expect(clock.pending()).toBe(0);
        expect(newCalls).toBe(1);
      } finally {
        stopNew();
      }

      store.set("reply", "after-unsubscribe");
      clock.flush();
      expect(newCalls).toBe(1);
      expect(oldCalls).toBe(0);
    });
  });

  test("a replacement subscriber does not inherit a previous subscriber's pending frame", () => {
    // Regression guard: the current producer holds only dirty ids, not the
    // listener registrations at write time. This case exposes that gap.
    withManualFrames((clock) => {
      const store = createKeyedStore();
      let oldCalls = 0;
      let replacementCalls = 0;
      const stopOld = store.subscribe("reply", () => { oldCalls += 1; });

      store.append("reply", "before-unsubscribe");
      expect(clock.pending()).toBe(1);
      stopOld();

      const stopReplacement = store.subscribe("reply", () => { replacementCalls += 1; });
      try {
        clock.flush();
        expect(oldCalls).toBe(0);
        expect(replacementCalls).toBe(0);

        store.append("reply", "+fresh");
        clock.flush();
        expect(replacementCalls).toBe(1);
        expect(store.get("reply")).toBe("before-unsubscribe+fresh");
      } finally {
        stopReplacement();
      }
    });
  });
});
