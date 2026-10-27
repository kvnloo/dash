import { describe, expect, test } from "bun:test";
import { assembleRoster, SelfHost, selfHostFrom } from "./roster";

// groot's MagicDNS label is "0": the roster id the phone stores is "0", the OS hostname is "groot".
const hosts = assembleRoster({
  nodes: [
    { hostName: "groot", dnsName: "0.taila30dc.ts.net.", online: true, os: "linux", ips: ["100.113.138.100"], self: true },
    { hostName: "mbp", dnsName: "mbp.taila30dc.ts.net.", online: true, os: "macOS", ips: ["100.64.0.9"], self: false },
  ],
  ompTabs: [],
  harnesses: [],
  selfFallback: { hostname: "groot" },
});

describe("SelfHost", () => {
  test("roster self id differs from the OS hostname on a renamed tailnet node", () => {
    expect(hosts.find(h => h.self)?.id).toBe("0");
  });

  test("accepts the roster id, the OS hostname and an absent host", () => {
    const self = selfHostFrom(hosts, "groot");
    expect(self.matches("0")).toBe(true);
    expect(self.matches("groot")).toBe(true);
    expect(self.matches(undefined)).toBe(true);
  });

  test("still refuses a different tailnet computer", () => {
    expect(selfHostFrom(hosts, "groot").matches("mbp")).toBe(false);
  });

  test("emits the roster id so the phone's targetHostId keeps matching", () => {
    expect(selfHostFrom(hosts, "groot").id()).toBe("0");
  });

  test("before any roster only the OS hostname is known", () => {
    const self = new SelfHost("groot");
    expect(self.id()).toBe("groot");
    expect(self.matches("0")).toBe(false);
  });

  test("a roster without a self host keeps the previous identity", () => {
    const self = selfHostFrom(hosts, "groot");
    self.remember([]);
    expect(self.id()).toBe("0");
    expect(self.matches("0")).toBe(true);
  });
});
