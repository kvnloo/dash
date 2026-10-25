import { describe, expect, test } from "bun:test";
import { attachClosedPenLoop, pixelCrop, transcribeRecording } from "./io-core";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_TURN, type ChatAttachment } from "../../../../shared/protocol";
import type { ComposerDraft } from "../../store/composer-drafts";
import type { DraftAttachment } from "../attachments";
import type { CircleRegion, ScreenInfo } from "./compose";
import type { Stroke } from "./strokes";
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


describe("S Pen cropped attachment draft lifecycle", () => {
  const phone = { id: "chat-1", route: "Chat", width: 400, height: 800 };
  const loop: Stroke = {
    id: 3, tool: "circle", color: "accent", pointer: "stylus", startedAt: 1000, endedAt: 1050,
    points: [{ x: 0.25, y: 0.25, p: 0.5, t: 1000 }, { x: 0.75, y: 0.75, p: 0.5, t: 1050 }],
  };
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const dataUri = "data:image/png;base64,iVBORw0KGgo=";
  const ref: ChatAttachment = { id: "0123456789abcdef0123456789abcdef", name: "circle.png", mime: "image/png", size: png.byteLength };
  const crop = async (_bytes: Uint8Array, _screen: ScreenInfo, _region: CircleRegion) => ({ bytes: png, dataUri });
  const text = [{ text: "error on submit", x: 100, y: 250, width: 100, height: 20 }];

  test("screen DIPs round outwards to exact screenshot pixel bounds", () => {
    expect(pixelCrop({ x: 88, y: 188, width: 224, height: 424 }, phone, 1200, 2400))
      .toEqual({ x: 264, y: 564, width: 672, height: 1272 });
    expect(pixelCrop({ x: 390, y: 790, width: 100, height: 100 }, phone, 1200, 2400))
      .toEqual({ x: 1170, y: 2370, width: 30, height: 30 });
    expect(() => pixelCrop({ x: 0, y: 0, width: 0, height: 2 }, phone, 1200, 2400)).toThrow("Invalid annotation");
    expect(() => pixelCrop({ x: 1, y: 1, width: 3, height: 3 }, phone, 0, 10)).toThrow("Invalid annotation");
  });

  test("closed loop creates only a composer chip and visible text, never a sent turn", async () => {
    let draft: ComposerDraft = { text: "Fix this", attachments: [] };
    const updateDraft = (change: (value: ComposerDraft) => ComposerDraft) => { draft = change(draft); };
    const calls: { name: string; bytes: Uint8Array }[] = [];
    const uploadPng = async (name: string, bytes: Uint8Array): Promise<ChatAttachment> => {
      expect(draft.attachments[0]?.state).toBe("uploading");
      expect(draft.attachments[0]?.uri).toBe(dataUri);
      calls.push({ name, bytes });
      return { ...ref, name };
    };
    const input = { stroke: loop, screen: phone, markedPng: png, visibleText: text, createdAt: Date.UTC(2026, 9, 25), updateDraft, uploadPng, crop };
    expect(await attachClosedPenLoop(input)).toBe("ready");
    expect(draft.text).toBe("Fix this\n\nCircled on Chat:\nerror on submit");
    expect(draft.attachments).toHaveLength(1);
    expect(draft.attachments[0]).toMatchObject({ mime: "image/png", state: "ready", uri: dataUri, size: 8, ref: { id: ref.id } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("spen-circle-3-2026-10-25T00-00-00-000Z.png");
    expect(calls[0]?.bytes).toEqual(png);
    expect(await attachClosedPenLoop(input)).toBe("ignored");
    expect(draft.attachments).toHaveLength(1);
    expect(draft.text.match(/Circled on Chat/g)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test("finger, full draft and removed pending chip never upload", async () => {
    let draft: ComposerDraft = { text: "Original", attachments: [] };
    const updateDraft = (change: (value: ComposerDraft) => ComposerDraft) => { draft = change(draft); };
    let uploads = 0;
    const uploadPng = async () => { uploads++; return ref; };
    const common = { screen: phone, markedPng: png, createdAt: 12, updateDraft, uploadPng, crop };
    expect(await attachClosedPenLoop({ ...common, stroke: { ...loop, pointer: "touch" } })).toBe("ignored");
    expect(draft).toEqual({ text: "Original", attachments: [] });
    draft = { text: "Original", attachments: Array.from({ length: MAX_ATTACHMENTS_PER_TURN }, (_, n): DraftAttachment => ({
      key: String(n), name: "old.png", mime: "image/png", uri: "", state: "ready",
    })) };
    expect(await attachClosedPenLoop({ ...common, stroke: loop })).toBe("full");
    expect(uploads).toBe(0);
    draft = { text: "Original", attachments: [] };
    expect(await attachClosedPenLoop({ ...common, stroke: loop, crop: async () => {
      updateDraft(value => ({ ...value, attachments: [] }));
      return { bytes: png, dataUri };
    } })).toBe("ignored");
    expect(draft.text).toBe("Original");
    expect(uploads).toBe(0);
  });

  test("upload failure remains an error chip and preserves the unsent draft", async () => {
    let draft: ComposerDraft = { text: "Existing words", attachments: [] };
    const updateDraft = (change: (value: ComposerDraft) => ComposerDraft) => { draft = change(draft); };
    const result = await attachClosedPenLoop({
      stroke: loop, screen: phone, markedPng: png, createdAt: 12, updateDraft, crop,
      uploadPng: async () => { throw new Error("Bridge offline"); },
    });
    expect(result).toBe("error");
    expect(draft.text).toContain("Existing words");
    expect(draft.attachments[0]).toMatchObject({ state: "error", error: "Bridge offline", uri: dataUri });
  });

  test("oversized cropped PNG cannot be uploaded", async () => {
    let draft: ComposerDraft = { text: "", attachments: [] };
    const updateDraft = (change: (value: ComposerDraft) => ComposerDraft) => { draft = change(draft); };
    let called = false;
    expect(await attachClosedPenLoop({
      stroke: loop, screen: phone, markedPng: png, createdAt: 12, updateDraft,
      crop: async () => ({ bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1), dataUri }),
      uploadPng: async () => { called = true; return ref; },
    })).toBe("error");
    expect(called).toBe(false);
    expect(draft.attachments[0]?.error).toContain("limit");
  });
});
