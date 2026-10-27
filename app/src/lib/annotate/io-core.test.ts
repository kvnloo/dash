import { expect, test } from "bun:test";
import { transcribeRecording } from "./io-core";
const settings = { address: "127.0.0.1:4747", token: "fixture" };
test("annotation transcription preserves a safe identity failure instead of claiming bridge network failure", async () => {
  let requested = false;
  await expect(transcribeRecording(settings, new ArrayBuffer(2), async () => { requested = true; return Response.json({ text: "unused" }); }, async () => { throw new Error("z0bridge /v1/token: HTTP 403"); })).rejects.toThrow("z0bridge /v1/token: HTTP 403");
  expect(requested).toBe(false);
});
test("annotation transcription distinguishes transport, HTTP refusal and actual transcript", async () => {
  await expect(transcribeRecording(settings, new ArrayBuffer(2), async () => { throw new Error("offline"); })).rejects.toThrow("Could not reach the bridge");
  await expect(transcribeRecording(settings, new ArrayBuffer(2), async () => Response.json({ error: "Speech-to-text is not available on this host." }, { status: 503 }))).rejects.toThrow("Speech-to-text is not available");
  expect(await transcribeRecording(settings, new ArrayBuffer(2), async () => Response.json({ text: "the marked button" }))).toBe("the marked button");
});
