import { expect, test } from "bun:test";
import { annotationReceipt } from "./voice-annotation-receipt";

test("an offline/local queued or streaming annotation never clears its drawing as accepted", () => {
  expect(annotationReceipt(undefined)).toBe("pending");
  expect(annotationReceipt({ state: "streaming" })).toBe("pending");
  expect(annotationReceipt({ state: "streaming", delivery: "queued" })).toBe("pending");
  expect(annotationReceipt({ state: "pending", delivery: "queued" })).toBe("pending");
  expect(annotationReceipt({ state: "streaming", delivery: "started" })).toBe("accepted");
  expect(annotationReceipt({ state: "done" })).toBe("final");
  expect(annotationReceipt({ state: "error", delivery: "started" })).toBe("failed");
  expect(annotationReceipt({ state: "interrupted" })).toBe("failed");
});
