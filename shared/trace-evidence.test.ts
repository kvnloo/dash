import { expect, test } from "bun:test";
import { parseTraceEvidence, safeTraceTarget, traceVerdict } from "./trace-evidence";
import { extractIntent } from "../bridge/src/trace-http";
test("evidence decoder preserves separation and fails closed on fake pass", () => {
  const e = extractIntent('OWNER:\n"Make it work"\n\nACCEPTANCE\n- A opens\n- B opens', "/runs/p");
  expect(parseTraceEvidence(e)).toEqual(e);
  expect(traceVerdict(e)).toBe("unknown");
  expect(() => parseTraceEvidence({ ...e, checks: [{ ...e.checks[0], status: "pass", evidence: [] }] })).toThrow();
  expect(traceVerdict({ ...e, checks: [{ id: "a", text: "A opens", status: "pass", evidence: ["/receipt.md"] }, e.checks[1]!] })).toBe("partly");
  expect(traceVerdict({ ...e, checks: [{ id: "a", text: "A opens", status: "fail", evidence: ["/receipt.md"] }] })).toBe("failed");
});
test("targets exclude execution, credentials, URL queries and traversal", () => {
  for (const t of ["javascript:alert(1)", "file:///etc/passwd", "https://u:p@example.com", "https://x.test/?token=abc", "/a/../secret", "dash://Chat"]) expect(safeTraceTarget(t)).toBe(false);
  for (const t of ["https://github.com/kvnloo/dash/pull/101", "dash://Trace", "/runs/proof.png"]) expect(safeTraceTarget(t)).toBe(true);
});
