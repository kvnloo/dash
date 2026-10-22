import { expect, test } from "bun:test";
import { demoSnapshot } from "./source";
import { rowActionsFor, rowClipboardText } from "./row-actions";
import type { TraceRow } from "./model";

const base = demoSnapshot.rows[0];
if (!base) throw new Error("demo row");
const plain: TraceRow = { ...base, evidence: undefined, provenance: undefined };

test("menu offers copy actions only for data the pressed row carries", () => {
  expect(rowActionsFor(plain).map(a => a.id)).toEqual(["open", "zoom", "copy-summary"]);
  const withSource: TraceRow = { ...plain, provenance: { parentSessionId: "", source: "/runs/x/state.db#sessions/1" } };
  expect(rowActionsFor(withSource).map(a => a.id)).toEqual(["open", "zoom", "copy-source", "copy-summary"]);
  expect(rowClipboardText(withSource, "copy-source")).toBe("/runs/x/state.db#sessions/1");
  expect(rowClipboardText(plain, "copy-request")).toBeNull();
  expect(rowClipboardText(plain, "open")).toBeNull();
  expect(rowClipboardText(plain, "copy-summary")).toStartWith(`${plain.project} · ${plain.goal}\n`);
});
