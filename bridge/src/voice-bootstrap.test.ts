import { expect, test } from "bun:test";
import { voiceBootstrap } from "./voice-bootstrap";
const req = (body: unknown = { profile: "test", session: "session-exact" }) => new Request("http://100.64.0.1:4747/voice/bootstrap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
test("voice bootstrap requires online identity, explicit deployment, and exact attached target", async () => {
  expect((await voiceBootstrap(req(), false, () => true, true))?.status).toBe(401);
  expect((await voiceBootstrap(req(), true, () => true, false))?.status).toBe(503);
  expect((await voiceBootstrap(req(), true, () => false, true))?.status).toBe(400);
  const response = await voiceBootstrap(req(), true, (p, s) => p === "test" && s === "session-exact", true);
  expect(response?.status).toBe(200);
  expect(await response?.json()).toMatchObject({ profile: "test", session: "session-exact", requiredScope: "z0live:voice", backgroundMicrophone: false });
});
test("bootstrap neither accepts extra token fields nor admits browser origins", async () => {
  expect((await voiceBootstrap(req({ profile: "test", session: "session-exact", token: "not-a-token" }), true, () => true, true))?.status).toBe(400);
  const browser = req(); browser.headers.set("origin", "http://100.64.0.1:4747");
  expect((await voiceBootstrap(browser, true, () => true, true))?.status).toBe(401);
});
