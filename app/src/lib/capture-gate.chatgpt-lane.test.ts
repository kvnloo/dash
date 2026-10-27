import { describe, expect, test } from "bun:test";
import {
  MAX_CAPTURE_OVERRIDE_MS,
  captureGate,
  createCaptureOverride,
  type CaptureGateInput,
} from "./capture-gate";

const NOW = Date.parse("2026-10-27T03:00:00Z");
const base: CaptureGateInput = {
  captureMode: false,
  captureEnforced: false,
  text: "A thought for tomorrow",
  attachments: [],
  isStopAction: false,
};

function decide(input: Partial<CaptureGateInput> = {}, now = NOW) {
  return captureGate({ ...base, ...input }, now);
}

describe("DASH-41: bedtime capture-only composer gate", () => {
  test("truth table: capture × enforcement × Stop × override states", () => {
    const overrides = [
      { name: "none", override: undefined, active: false },
      { name: "valid", override: createCaptureOverride(NOW), active: true },
      { name: "expired", override: { until: NOW }, active: false },
      { name: "over-long", override: { issuedAt: NOW, until: NOW + 60 * 60_000 }, active: true },
    ];
    for (const captureMode of [false, true]) {
      for (const captureEnforced of [false, true]) {
        for (const isStopAction of [false, true]) {
          for (const item of overrides) {
            const result = decide({ captureMode, captureEnforced, isStopAction, override: item.override });
            const expected = isStopAction
              ? "stop" : captureMode && captureEnforced && !item.active ? "capture" : "send";
            expect(result.action).toBe(expected);
            expect(result.enabled).toBe(true);
            if (isStopAction) expect(result.label).toBe("Stop");
            if (captureMode && captureEnforced && !isStopAction && item.active) {
              expect(result.label).toBe("Send anyway");
            }
          }
        }
      }
    }
  });

  test("ordinary Send has no bedtime hint or capture placeholder", () => {
    expect(decide({ captureMode: false, captureEnforced: true })).toEqual({
      action: "send", label: "Send", enabled: true,
    });
    expect(decide({ captureMode: false, override: createCaptureOverride(NOW) })).toEqual({
      action: "send", label: "Send", enabled: true,
    });
  });

  test("shadow mode sends now and explicitly discloses it", () => {
    for (const captureEnforced of [false]) {
      expect(decide({ captureMode: true, captureEnforced })).toEqual({
        action: "send",
        label: "Send",
        enabled: true,
        hint: "Bedtime: this will be sent now",
      });
    }
  });

  test("enforced capture shows the exact label and placeholder without sending", () => {
    expect(decide({ captureMode: true, captureEnforced: true })).toEqual({
      action: "capture",
      label: "Save for tomorrow",
      placeholder: "Capture a thought for tomorrow",
      hint: "Capture-only mode: do not send to agents",
      enabled: true,
    });
  });

  test("one-shot explicit exception sends now only while the token is active", () => {
    const override = createCaptureOverride(NOW, NOW + 2 * 60_000);
    const bedtime = { captureMode: true, captureEnforced: true };
    expect(decide({ ...bedtime, override }, NOW).action).toBe("send");
    expect(decide({ ...bedtime, override }, NOW + 2 * 60_000 - 1)).toMatchObject({
      action: "send", label: "Send anyway",
      hint: "One-time bedtime exception: this will be sent now",
    });
    expect(decide({ ...bedtime, override }, NOW + 2 * 60_000).action).toBe("capture");
    // The submit handler consumes the token after the first accepted send.
    expect(decide({ ...bedtime, override: undefined }, NOW + 1).action).toBe("capture");
  });

  test("plain { until } tokens work when bounded and ignore expired/future-unsafe tokens", () => {
    const bedtime = { captureMode: true, captureEnforced: true };
    expect(decide({ ...bedtime, override: { until: NOW + 5_000 } }).action).toBe("send");
    expect(decide({ ...bedtime, override: { until: NOW } }).action).toBe("capture");
    expect(decide({ ...bedtime, override: { until: NOW - 1 } }).action).toBe("capture");
    expect(decide({ ...bedtime, override: { until: NOW + MAX_CAPTURE_OVERRIDE_MS + 1 } }).action).toBe("capture");
    expect(decide({ ...bedtime, override: null }).action).toBe("capture");
  });

  test("long exceptions clamp to 15 minutes from original grant, not each render", () => {
    const bedtime = { captureMode: true, captureEnforced: true };
    const requested = createCaptureOverride(NOW, NOW + 60 * 60_000);
    expect(requested).toEqual({ issuedAt: NOW, until: NOW + MAX_CAPTURE_OVERRIDE_MS });
    expect(decide({ ...bedtime, override: requested }, NOW + MAX_CAPTURE_OVERRIDE_MS - 1).action).toBe("send");
    expect(decide({ ...bedtime, override: requested }, NOW + MAX_CAPTURE_OVERRIDE_MS).action).toBe("capture");
    expect(createCaptureOverride(NOW, NOW - 1).until).toBe(NOW);

    // Even a malformed producer that skipped mint-time clamping cannot extend
    // the lifetime when it supplies the original issuance timestamp.
    const overLong = { issuedAt: NOW, until: NOW + 60 * 60_000 };
    expect(decide({ ...bedtime, override: overLong }, NOW + MAX_CAPTURE_OVERRIDE_MS - 1).action).toBe("send");
    expect(decide({ ...bedtime, override: overLong }, NOW + MAX_CAPTURE_OVERRIDE_MS).action).toBe("capture");
  });

  test("rejects invalid or not-yet-granted override timestamps", () => {
    const bedtime = { captureMode: true, captureEnforced: true };
    for (const override of [
      { until: Number.NaN },
      { until: Number.POSITIVE_INFINITY },
      { until: NOW + 60_000, issuedAt: Number.NaN },
      { until: NOW + 60_000, issuedAt: NOW + 1 },
    ]) {
      expect(decide({ ...bedtime, override }).action).toBe("capture");
    }
    expect(decide({ ...bedtime, override: createCaptureOverride(Number.NaN) }).action).toBe("capture");
    expect(decide({ ...bedtime, override: createCaptureOverride(NOW) }, Number.NaN).action).toBe("capture");
  });

  test("whitespace-only or empty draft disables Send/Capture, attachments enable both", () => {
    for (const captureMode of [false, true]) {
      for (const captureEnforced of [false, true]) {
        const flags = { captureMode, captureEnforced };
        for (const text of ["", " \t \n "]) {
          const empty = decide({ ...flags, text, attachments: [] });
          expect(empty.enabled).toBe(false);
          expect(empty.action).toBe(captureMode && captureEnforced ? "capture" : "send");
          expect(decide({ ...flags, text, attachments: [{ id: "file-1" }] }).enabled).toBe(true);
        }
      }
    }
  });

  test("Stop stays enabled with an empty draft even under capture-only enforcement", () => {
    const result = decide({
      captureMode: true, captureEnforced: true,
      isStopAction: true, text: " ", attachments: [], override: null,
    });
    expect(result).toEqual({ action: "stop", label: "Stop", enabled: true });
  });

  test("does not mutate the input or exception token", () => {
    const override = Object.freeze(createCaptureOverride(NOW));
    const input = Object.freeze({
      ...base, captureMode: true, captureEnforced: true,
      attachments: Object.freeze([{ id: "file" }]), override,
    });
    expect(captureGate(input, NOW).action).toBe("send");
    expect(override.until).toBe(NOW + MAX_CAPTURE_OVERRIDE_MS);
    expect(input.text).toBe(base.text);
  });
});
