import { expect, test } from "bun:test";
import { claimLivePair, claimPairCode, claimPairAt, startSonicPair, hearPairTones, triggerPairBeep } from "./pair-api";

test("every enrollment path authenticates using a separate bootstrap header", async () => {
  const paths: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    expect(request.headers.get("authorization")).toBe("Bearer fixture-bootstrap");
    const url = new URL(request.url);
    expect(url.searchParams.has("token")).toBe(false);
    paths.push(url.pathname);
    return Response.json(url.pathname === "/pair"
      ? { code: "ABC123", address: "127.0.0.1", host: "fixture" }
      : { address: "127.0.0.1", token: "fixture-execution", host: "fixture", cwd: "/project", harnesses: [] });
  } });
  const address = `127.0.0.1:${server.port}`;
  const key = new Uint8Array(32);
  try {
    expect((await claimLivePair(address, "fixture-bootstrap")).token).toBe("fixture-execution");
    await claimPairCode(address, "ABC123", undefined, "fixture-bootstrap");
    await claimPairAt(address, "ABC123", undefined, "fixture-bootstrap");
    await startSonicPair(address, key, "fixture-bootstrap");
    await hearPairTones(address, key, new Uint8Array([1]), "audio/wav", "fixture-bootstrap");
    await triggerPairBeep(address, "fixture-bootstrap");
    expect(paths).toEqual(["/pair", "/pair/claim", "/pair/claim", "/pair/claim", "/pair/intent", "/pair/hear", "/pair/beep"]);
  } finally { await server.stop(true); }
});

test("missing bootstrap stops before network admission", async () => {
  await expect(claimLivePair("127.0.0.1:1")).rejects.toThrow("bootstrap");
});
