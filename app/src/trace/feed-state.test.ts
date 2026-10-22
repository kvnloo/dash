import { expect, test } from "bun:test";
import { entryLine, feedStatus, unavailableReason } from "./feed-state";
import bundled from "./snapshot.json";
import { parseTraceSnapshot } from "./model";

const snapshot = parseTraceSnapshot(bundled);

test("every non-live phase names why there are no events", () => {
  expect(feedStatus({ phase: "unpaired" }, 0).title).toBe("Live trace unavailable · not paired");
  expect(feedStatus({ phase: "connecting" }, 0).title).toBe("Connecting to bridge…");
  const never = feedStatus({ phase: "unavailable", reason: "Bridge unreachable", at: 0, lastLiveAt: null }, 0);
  expect(never.title).toBe("Live trace unavailable · Bridge unreachable");
  expect(never.detail).toBe("Retrying every 5 s. No events have loaded from this bridge yet.");
  const lost = feedStatus({ phase: "unavailable", reason: "Bridge unreachable", at: 0, lastLiveAt: 1000 }, 31000);
  expect(lost.detail).toBe("Retrying every 5 s. Last live update 30 s ago; its events were cleared, not kept as current.");
  expect(feedStatus({ phase: "live", snapshot, receivedAt: 0, arrived: [] }, 125000).title).toBe("Live from bridge · updated 2 min ago");
});

test("fetch failures map to owner-readable reasons", () => {
  expect(unavailableReason(new Error("Trace unavailable (HTTP 404)"))).toBe("Live trace endpoint unavailable (HTTP 404)");
  expect(unavailableReason(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe("Bridge did not answer within 12 s");
  expect(unavailableReason(new Error("Invalid trace snapshot"))).toBe("Bridge sent an unreadable trace snapshot");
  expect(unavailableReason(new TypeError("Failed to fetch"))).toBe("Bridge unreachable");
});

test("entry card shows counts only from a live snapshot", () => {
  expect(entryLine({ phase: "unpaired" }, false)).toBe("Not paired · live trace unavailable");
  expect(entryLine({ phase: "unpaired" }, true)).toBe("Open to load live events");
  expect(entryLine({ phase: "connecting" }, true)).toBe("Open to load live events");
  expect(entryLine({ phase: "unavailable", reason: "Bridge unreachable", at: 0, lastLiveAt: null }, true)).toBe("Live trace unavailable · Bridge unreachable");
  const st = snapshot.stats;
  expect(entryLine({ phase: "live", snapshot, receivedAt: 0, arrived: [] }, true)).toBe(`${st.live} live · ${st.cut} cut · ${st.asks} need your OK · ${snapshot.rows.length} events`);
});
