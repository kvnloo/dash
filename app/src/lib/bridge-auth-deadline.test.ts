import { expect, mock, test } from "bun:test";
import { clearIdentityTokens, executionToken } from "./bridge-auth";

// Bridge.connectNow awaits executionToken before the socket (and its connect timer) exists.
// If the token path never settles, connectNow never reaches onClosed, so no retry is ever
// scheduled and the app sits offline with no socket. The token step must be bounded.
test("identity token acquisition that never settles rejects instead of hanging the connect", async () => {
  mock.module("./secure", () => ({ getSecret: () => new Promise<string | null>(() => {}), setSecret: async () => {} }));
  clearIdentityTokens();
  const settings = {
    token: "legacy",
    identity: { url: "http://100.113.138.100:4788", issuer: "z0bridge:test", kid: "k".repeat(43), credentialId: "cred_0123456789abcdef" },
  };
  const started = Date.now();
  const outcome = await Promise.race([
    executionToken(settings, 50).then(() => "resolved", (error: unknown) => (error instanceof Error ? error.message : String(error))),
    new Promise<string>(resolve => setTimeout(() => resolve("hung"), 1000)),
  ]);
  expect(outcome).not.toBe("hung");
  expect(outcome).toMatch(/timed out/i);
  expect(Date.now() - started).toBeLessThan(900);
});

test("legacy settings still return the token immediately", async () => {
  expect(await executionToken({ token: "legacy" }, 50)).toBe("legacy");
});
