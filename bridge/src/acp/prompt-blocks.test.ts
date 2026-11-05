import { describe, expect, test } from "bun:test";
import { ACP_INLINE_IMAGE_BYTES, acpPromptBlocks } from "./client";

const png = { path: "/h/.dash/attachments/t/p.png", name: "p.png", mime: "image/png", size: 4 };
const txt = { path: "/h/.dash/attachments/t/n.txt", name: "n.txt", mime: "text/plain", size: 5 };
const read = () => Buffer.from([1, 2, 3, 4]);

describe("acpPromptBlocks", () => {
  test("plain text turn is one text block", () => {
    expect(acpPromptBlocks({ text: "hi" }, true, read)).toEqual([{ type: "text", text: "hi" }]);
  });
  test("inlines images when the agent supports image prompts", () => {
    const blocks = acpPromptBlocks({ text: "t", attachments: [png, txt] }, true, read);
    expect(blocks[1]).toEqual({ type: "image", mimeType: "image/png", data: "AQIDBA==", uri: "file:///h/.dash/attachments/t/p.png" });
    expect(blocks[2]).toEqual({ type: "resource_link", uri: "file:///h/.dash/attachments/t/n.txt", name: "n.txt", mimeType: "text/plain", size: 5 });
  });
  test("links images when the agent lacks image prompts, the image is too big, or unreadable", () => {
    expect(acpPromptBlocks({ text: "t", attachments: [png] }, false, read)[1]?.type).toBe("resource_link");
    expect(acpPromptBlocks({ text: "t", attachments: [{ ...png, size: ACP_INLINE_IMAGE_BYTES + 1 }] }, true, read)[1]?.type).toBe("resource_link");
    expect(acpPromptBlocks({ text: "t", attachments: [{ ...png, size: ACP_INLINE_IMAGE_BYTES }] }, true, read)[1]?.type).toBe("image");
    expect(acpPromptBlocks({ text: "t", attachments: [{ ...png, mime: "image/heic" }] }, true, read)[1]?.type).toBe("resource_link");
    expect(acpPromptBlocks({ text: "t", attachments: [png] }, true, () => { throw new Error("gone"); })[1]?.type).toBe("resource_link");
  });
  test("escapes paths into file URIs", () => {
    expect(acpPromptBlocks({ text: "t", attachments: [{ ...txt, path: "/a b/#1.txt" }] }, false, read)[1]?.uri).toBe("file:///a%20b/%231.txt");
  });
});
