import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canRequestDeliveryRetry, describeDeliveryStatus, type DeliveryStage } from "./delivery-status";

const base = { retryNeeded: false, retryBusy: false };

describe("delivery status copy", () => {
  const stages: Array<{ stage: DeliveryStage; label: string; helper: string }> = [
    { stage: "queued", label: "Queued", helper: "local outbox" },
    { stage: "sending", label: "Sending", helper: "explicit bridge receipt" },
    { stage: "received", label: "Received by bridge", helper: "acknowledged receipt" },
    { stage: "started", label: "Started", helper: "execution started" },
  ];

  for (const { stage, label, helper } of stages) {
    test(stage + " has a distinct, spoken status", () => {
      const status = describeDeliveryStatus({ ...base, stage });
      expect(status.label).toBe(label);
      expect(status.helper).toContain(helper);
      expect(status.accessibilityLabel).toContain(label);
      expect(status.accessibilityLabel).toContain(status.helper);
      expect(status.retryVisible).toBe(false);
      expect(status.retryDisabled).toBe(true);
    });
  }

  test("missing ack or socket drop shows exact label without claiming definite nondelivery", () => {
    for (const stage of ["queued", "sending"] satisfies DeliveryStage[]) {
      const status = describeDeliveryStatus({ stage, retryNeeded: true, retryBusy: false });
      expect(status.label).toBe("Not sent · Retry");
      expect(status.helper).toContain("Delivery is unconfirmed.");
      expect(status.helper).toContain("may already have received");
      expect(status.helper).toContain("same client and turn IDs");
      expect(status.helper).toContain("do not create a second turn");
      expect(status.tone).toBe("warning");
      expect(status.retryVisible).toBe(true);
      expect(status.retryDisabled).toBe(false);
      expect(status.accessibilityLabel).toContain("Not sent · Retry");
      expect(status.accessibilityLabel).toContain("Delivery is unconfirmed");
    }
  });

  test("an acknowledged or started turn cannot regress into an unconfirmed Retry warning", () => {
    for (const stage of ["received", "started"] satisfies DeliveryStage[]) {
      const status = describeDeliveryStatus({ stage, retryNeeded: true, retryBusy: true });
      expect(status.label).not.toBe("Not sent · Retry");
      expect(status.retryVisible).toBe(false);
      expect(status.retryDisabled).toBe(true);
      expect(status.retryBusy).toBe(false);
      expect(status.tone).toBe("confirmed");
    }
  });

  test("controlled busy and immediate latch prevent double retry, then allow explicit reset", () => {
    const ready = describeDeliveryStatus({ stage: "sending", retryNeeded: true, retryBusy: false });
    const busy = describeDeliveryStatus({ stage: "sending", retryNeeded: true, retryBusy: true });
    const noRetry = describeDeliveryStatus({ stage: "sending", retryNeeded: false, retryBusy: false });

    let requested = false;
    let calls = 0;
    const press = () => {
      if (!canRequestDeliveryRetry(ready, requested)) return;
      requested = true;
      calls++;
    };
    press();
    press();
    expect(calls).toBe(1);
    expect(canRequestDeliveryRetry(busy, false)).toBe(false);
    expect(busy.retryDisabled).toBe(true);
    expect(busy.retryBusy).toBe(true);
    expect(canRequestDeliveryRetry(noRetry, false)).toBe(false);
    requested = false; // Same reset used after a parent busy cycle.
    expect(canRequestDeliveryRetry(ready, requested)).toBe(true);
  });

  test("busy without an outstanding retry is not accidentally announced", () => {
    const status = describeDeliveryStatus({ stage: "queued", retryNeeded: false, retryBusy: true });
    expect(status.retryVisible).toBe(false);
    expect(status.retryDisabled).toBe(true);
    expect(status.retryBusy).toBe(false);
  });

  test("optional note is spoken without replacing the safety explanation", () => {
    const status = describeDeliveryStatus({
      stage: "sending", retryNeeded: true, retryBusy: false, note: "  Connection dropped  ",
    });
    expect(status.note).toBe("Connection dropped");
    expect(status.accessibilityLabel).toContain("Connection dropped");
    expect(status.accessibilityLabel).toContain("may already have received");
    expect(describeDeliveryStatus({ ...base, stage: "queued", note: "  " }).note).toBeNull();
  });
});

// Source-backed native interaction checklist. These are NOT rendered or phone tests;
// Hermes must focus/test the control with TalkBack/VoiceOver, repeated taps and reduced motion.
test("component exposes a live status, descriptive retry control, busy gating and 44-DIP targets", () => {
  const component = readFileSync(new URL("../components/DeliveryStatus.tsx", import.meta.url), "utf8");
  expect(component).toContain('testID="delivery-status"');
  expect(component).toContain('accessibilityLiveRegion={status.retryVisible ? "assertive" : "polite"}');
  expect(component).toContain("accessibilityLabel={status.accessibilityLabel}");
  expect(component).toContain('accessibilityRole="button"');
  expect(component).toContain("accessibilityHint=");
  expect(component).toContain("accessibilityState={{ disabled: status.retryDisabled, busy: status.retryBusy }}");
  expect(component).toContain("disabled={status.retryDisabled}");
  expect(component).toContain("requestLatched.current = true");
  expect(component).toContain("canRequestDeliveryRetry(status, requestLatched.current)");
  expect(component).toContain("minHeight: controlMin");
  expect(component).toContain("minWidth: controlMin");
  expect(component).not.toContain("../store/app");
  expect(component).not.toContain("../net/bridge");
});
