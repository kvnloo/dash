import { expect, test } from "bun:test";
import { activate, endpointsOf, pickEndpoint, probeBridge, withEditedEndpoint, withPairedEndpoint, withoutEndpoint } from "./bridge-failover";
import { parseSettings, type Settings } from "../model";

const primary: Settings = { address: "primary.test:8787", token: "tg", harness: "hermes", inAppFeedback: true };
const standbyIdentity = { url: "http://100.64.0.2:4788", issuer: "z0bridge:standby", kid: "k".repeat(43), credentialId: "cred_0123456789abcdef" };
const standby: Settings = { address: "standby.test:8787", token: "", harness: "hermes", inAppFeedback: true, identity: standbyIdentity };

test("a single-host settings object is a list of one", () => {
  expect(endpointsOf(primary)).toEqual([{ address: "primary.test:8787", token: "tg" }]);
});

test("pairing a second bridge appends it and makes it the one in use; the primary keeps first place", () => {
  const both = withPairedEndpoint(primary, standby);
  expect(both.address).toBe("standby.test:8787");
  expect(both.identity).toEqual(standbyIdentity);
  expect(endpointsOf(both).map(e => e.address)).toEqual(["primary.test:8787", "standby.test:8787"]);
  const repaired = withPairedEndpoint(both, { ...primary, token: "new" });
  expect(endpointsOf(repaired).map(e => [e.address, e.token])).toEqual([["primary.test:8787", "new"], ["standby.test:8787", ""]]);
});

test("activate swaps credentials, drops a stale identity and keeps the list", () => {
  const both = withPairedEndpoint(primary, standby);
  const back = activate(both, { address: "primary.test:8787", token: "tg" });
  expect(back.address).toBe("primary.test:8787");
  expect(back.token).toBe("tg");
  expect(back.identity).toBeUndefined();
  expect(back.endpoints).toHaveLength(2);
  expect(back.harness).toBe("hermes");
});

test("editing the bridge in use replaces only that entry", () => {
  const both = activate(withPairedEndpoint(primary, standby), { address: "primary.test:8787", token: "tg" });
  const edited = withEditedEndpoint(both, { ...both, address: "primary2.test:8787", token: "t2" });
  expect(endpointsOf(edited).map(e => e.address)).toEqual(["primary2.test:8787", "standby.test:8787"]);
});

test("removing the bridge in use moves to the first remaining one; the last one stays", () => {
  const both = withPairedEndpoint(primary, standby);
  const left = withoutEndpoint(both, "standby.test:8787");
  expect(left.address).toBe("primary.test:8787");
  expect(withoutEndpoint(left, "primary.test:8787").address).toBe("primary.test:8787");
});

test("the endpoint list survives a save/load round trip and drops malformed rows", () => {
  const both = withPairedEndpoint(primary, standby);
  const raw: unknown = JSON.parse(JSON.stringify({ ...both, endpoints: [...(both.endpoints ?? []), { address: 7 }, { address: "x:1", token: "t", identity: { bad: true } }] }));
  expect(parseSettings(raw)?.endpoints?.map(e => e.address)).toEqual(["primary.test:8787", "standby.test:8787"]);
});

test("probe: any HTTP answer (401 from /ws) is alive; 5xx, errors and timeouts are down", async () => {
  const urls: string[] = [];
  expect(await probeBridge("a:1", async url => { urls.push(url); return new Response("unauthorized", { status: 401 }); })).toBe(true);
  expect(urls).toEqual(["http://a:1/ws"]);
  expect(await probeBridge("a:1", async () => new Response("", { status: 502 }))).toBe(false);
  expect(await probeBridge("a:1", async () => { throw new TypeError("Network request failed"); })).toBe(false);
  const started = Date.now();
  expect(await probeBridge("a:1", () => new Promise<Response>(() => {}), 50)).toBe(false);
  expect(Date.now() - started).toBeLessThan(1000);
});

test("pickEndpoint returns the first answering bridge in list order", async () => {
  const both = withPairedEndpoint(primary, standby);
  const seen: string[] = [];
  const pick = await pickEndpoint(both, async address => { seen.push(address); return address.startsWith("standby"); });
  expect(pick?.address).toBe("standby.test:8787");
  expect(seen).toEqual(["primary.test:8787", "standby.test:8787"]);
  expect(await pickEndpoint(both, async () => false)).toBeUndefined();
  expect((await pickEndpoint(both, async () => true))?.address).toBe("primary.test:8787");
});
