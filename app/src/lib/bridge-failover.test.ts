import { expect, test } from "bun:test";
import { activate, endpointsOf, pickEndpoint, probeBridge, withEditedEndpoint, withPairedEndpoint, withoutEndpoint } from "./bridge-failover";
import { parseSettings, type Settings } from "../model";

const groot: Settings = { address: "groot.test:8787", token: "tg", harness: "hermes", inAppFeedback: true };
const mbpIdentity = { url: "http://mbp.test:9797", issuer: "z0bridge:mbp", kid: "k".repeat(43), credentialId: "cred_0123456789abcdef" };
const mbp: Settings = { address: "mbp.test:8787", token: "", harness: "hermes", inAppFeedback: true, identity: mbpIdentity };

test("a single-host settings object is a list of one", () => {
  expect(endpointsOf(groot)).toEqual([{ address: "groot.test:8787", token: "tg" }]);
});

test("pairing a second bridge appends it and makes it the one in use; the primary keeps first place", () => {
  const both = withPairedEndpoint(groot, mbp);
  expect(both.address).toBe("mbp.test:8787");
  expect(both.identity).toEqual(mbpIdentity);
  expect(endpointsOf(both).map(e => e.address)).toEqual(["groot.test:8787", "mbp.test:8787"]);
  const repaired = withPairedEndpoint(both, { ...groot, token: "new" });
  expect(endpointsOf(repaired).map(e => [e.address, e.token])).toEqual([["groot.test:8787", "new"], ["mbp.test:8787", ""]]);
});

test("activate swaps credentials, drops a stale identity and keeps the list", () => {
  const both = withPairedEndpoint(groot, mbp);
  const back = activate(both, { address: "groot.test:8787", token: "tg" });
  expect(back.address).toBe("groot.test:8787");
  expect(back.token).toBe("tg");
  expect(back.identity).toBeUndefined();
  expect(back.endpoints).toHaveLength(2);
  expect(back.harness).toBe("hermes");
});

test("editing the bridge in use replaces only that entry", () => {
  const both = activate(withPairedEndpoint(groot, mbp), { address: "groot.test:8787", token: "tg" });
  const edited = withEditedEndpoint(both, { ...both, address: "groot2.test:8787", token: "t2" });
  expect(endpointsOf(edited).map(e => e.address)).toEqual(["groot2.test:8787", "mbp.test:8787"]);
});

test("removing the bridge in use moves to the first remaining one; the last one stays", () => {
  const both = withPairedEndpoint(groot, mbp);
  const left = withoutEndpoint(both, "mbp.test:8787");
  expect(left.address).toBe("groot.test:8787");
  expect(withoutEndpoint(left, "groot.test:8787").address).toBe("groot.test:8787");
});

test("the endpoint list survives a save/load round trip and drops malformed rows", () => {
  const both = withPairedEndpoint(groot, mbp);
  const raw: unknown = JSON.parse(JSON.stringify({ ...both, endpoints: [...(both.endpoints ?? []), { address: 7 }, { address: "x:1", token: "t", identity: { bad: true } }] }));
  expect(parseSettings(raw)?.endpoints?.map(e => e.address)).toEqual(["groot.test:8787", "mbp.test:8787"]);
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
  const both = withPairedEndpoint(groot, mbp);
  const seen: string[] = [];
  const pick = await pickEndpoint(both, async address => { seen.push(address); return address.startsWith("mbp"); });
  expect(pick?.address).toBe("mbp.test:8787");
  expect(seen).toEqual(["groot.test:8787", "mbp.test:8787"]);
  expect(await pickEndpoint(both, async () => false)).toBeUndefined();
  expect((await pickEndpoint(both, async () => true))?.address).toBe("groot.test:8787");
});
