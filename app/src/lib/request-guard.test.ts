import { describe, expect, test } from "bun:test";
import { createRequestGuard } from "./request-guard";

describe("request guard", () => {
  test("only the latest response applies, even when an older one arrives later", async () => {
    const guard = createRequestGuard();
    const applied: string[] = [];
    const respond = (ticket: ReturnType<typeof guard.next>, value: string, delay: number) =>
      new Promise<void>(resolve => setTimeout(() => { if (ticket.isCurrent()) applied.push(value); resolve(); }, delay));
    const first = guard.next();
    const second = guard.next();
    // seq-2 answers first, then the stale seq-1 answer lands.
    await Promise.all([respond(second, "two", 1), respond(first, "one", 5)]);
    expect(applied).toEqual(["two"]);
    expect(second.seq).toBe(guard.current);
  });
  test("next aborts the previous request; cancel aborts and invalidates", () => {
    const guard = createRequestGuard();
    const a = guard.next();
    const b = guard.next();
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    guard.cancel();
    expect(b.signal.aborted).toBe(true);
    expect(b.isCurrent()).toBe(false);
  });
});
