import { describe, expect, test } from "bun:test";
import type { Settings } from "../model";
import { endpointsOf, recoveryEndpoint } from "./bridge-failover";

const primary = { address: "100.64.0.1:8787", token: "a" };
const fallback = { address: "100.64.0.2:8787", token: "b" };

function settings(address: string): Settings {
  return {
    address,
    token: address === primary.address ? "a" : "b",
    harness: "claude",
    inAppFeedback: false,
    endpoints: [primary, fallback],
  };
}

describe("recoveryEndpoint", () => {
  test("returns the open chat's owning bridge, not the primary", () => {
    expect(recoveryEndpoint(settings(primary.address), fallback.address)?.address).toBe(fallback.address);
  });

  test("returns the owning bridge after failover moved away from it", () => {
    expect(recoveryEndpoint(settings(fallback.address), primary.address)?.address).toBe(primary.address);
  });

  test("falls back to the primary when the chat has no or an unknown owner", () => {
    expect(recoveryEndpoint(settings(fallback.address))?.address).toBe(primary.address);
    expect(recoveryEndpoint(settings(fallback.address), "100.64.0.9:8787")?.address).toBe(primary.address);
  });

  test("keeps failover order unchanged", () => {
    expect(endpointsOf(settings(fallback.address)).map(e => e.address)).toEqual([primary.address, fallback.address]);
  });
});
