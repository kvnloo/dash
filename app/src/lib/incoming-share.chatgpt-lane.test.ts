import { describe, expect, test } from "bun:test";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_TURN } from "./attachments";
import { isShareLink, parseIncomingShare } from "./incoming-share";

const ID = "a1b2c3d4-1122-4333-8444-556677889900";
const OTHER_ID = "b1c2d3e4-2233-4444-8555-667788990011";
const SHARE_ROOT = "file:///data/user/0/dash/cache/incoming-shares/" + ID + "/";

function sharedFile(overrides: Record<string, unknown> = {}) {
  return {
    uri: SHARE_ROOT + "0-R%C3%A9sum%C3%A9.png",
    name: "Résumé 🧾.PNG",
    mime: "image/PNG",
    size: 13,
    ...overrides,
  };
}

function share(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    text: "  Keep spacing\nhttps://example.org/a?b=1  ",
    files: [sharedFile()],
    errors: [],
    ...overrides,
  };
}

describe("parseIncomingShare: positive boundary controls", () => {
  test("preserves id, text, file URI/name/MIME/size and errors, but never promotes untrusted metadata", () => {
    const sourceFile = Object.freeze(sharedFile({
      ref: { id: "already-uploaded" },
      blob: new Uint8Array([1, 2]),
      state: "ready",
      sessionId: "spoofed-session",
    }));
    const source = Object.freeze({
      id: ID,
      text: "  exact text & URL\n",
      files: Object.freeze([sourceFile]),
      errors: Object.freeze(["Unreadable: attachment #2", "Failed: 🧾"]),
      targetId: "spoofed-target",
      optionId: "spoofed-option",
    });

    const parsed = parseIncomingShare(source);
    expect(parsed).toEqual({
      id: ID,
      text: "  exact text & URL\n",
      files: [{
        uri: SHARE_ROOT + "0-R%C3%A9sum%C3%A9.png",
        name: "Résumé 🧾.PNG",
        mime: "image/PNG",
        size: 13,
      }],
      errors: ["Unreadable: attachment #2", "Failed: 🧾"],
    });
    expect(parsed?.files[0]).not.toBe(sourceFile);
    expect(Object.keys(parsed ?? {})).toEqual(["id", "text", "files", "errors"]);
  });

  test("accepts text-only and file-only shares without inventing a target, file, or text", () => {
    const textOnly = parseIncomingShare(share({ text: "https://example.org/path", files: [] }));
    expect(textOnly).toEqual({
      id: ID,
      text: "https://example.org/path",
      files: [],
      errors: [],
    });

    const fileOnly = parseIncomingShare(share({ text: "" }));
    expect(fileOnly?.text).toBe("");
    expect(fileOnly?.files).toEqual([sharedFile()]);
    expect(fileOnly?.id).toBe(ID);
  });

  test("keeps ordered files and allows exactly the per-turn maximum", () => {
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_TURN }, (_, index) =>
      sharedFile({
        uri: SHARE_ROOT + index + "-image.jpg",
        name: index + "-image.jpg",
        mime: "image/jpeg",
        size: index + 1,
      }),
    );
    expect(parseIncomingShare(share({ files }))?.files).toEqual(files);
    expect(parseIncomingShare(share({ files: [...files, sharedFile()] }))).toBeNull();
  });

  test("accepts the exact text, name, and byte-size limits", () => {
    const maxText = "x".repeat(60_000);
    expect(parseIncomingShare(share({ text: maxText }))?.text).toBe(maxText);
    expect(parseIncomingShare(share({
      files: [sharedFile({ name: "n".repeat(255), size: MAX_ATTACHMENT_BYTES })],
    }))?.files[0]?.name).toBe("n".repeat(255));
    expect(parseIncomingShare(share({
      files: [
        sharedFile({ size: MAX_ATTACHMENT_BYTES }),
        sharedFile({ name: "second.bin", size: MAX_ATTACHMENT_BYTES }),
      ],
    }))?.files).toHaveLength(2);
  });
});

describe("parseIncomingShare: rejected boundaries", () => {
  test("rejects missing, null, scalar, array and unrelated roots", () => {
    const inputs: unknown[] = [
      undefined, null, true, 0, "share", [], [share()], {}, new Date(0),
      { id: ID }, { text: "text", files: [], errors: [] },
    ];
    for (const input of inputs) expect(parseIncomingShare(input)).toBeNull();
  });

  test("rejects missing, null, wrongly typed, upper-case and wrong-length identifiers", () => {
    const invalid: unknown[] = [
      undefined, null, 0, false, [], {}, "", ID.toUpperCase(),
      ID.slice(1), ID + "0", "g" + ID.slice(1), ID.replace("-", "_"),
    ];
    for (const id of invalid) {
      expect(parseIncomingShare(share({ id, files: [] }))).toBeNull();
    }
    expect(parseIncomingShare(share({ id: OTHER_ID, files: [] }))?.id).toBe(OTHER_ID);
    expect(parseIncomingShare(share({
      id: OTHER_ID,
      files: [sharedFile()],
    }))).toBeNull();
  });

  test("rejects missing/wrong-type/over-limit text, file arrays and error arrays", () => {
    for (const text of [undefined, null, 123, false, [], {}, "x".repeat(60_001)]) {
      expect(parseIncomingShare(share({ text }))).toBeNull();
    }
    for (const files of [undefined, null, "[]", {}, 1, [null], [[]], ["file"]]) {
      expect(parseIncomingShare(share({ files }))).toBeNull();
    }
    for (const errors of [undefined, null, "error", {}, 0, [null], [1], [[]], [{}]]) {
      expect(parseIncomingShare(share({ errors }))).toBeNull();
    }
    expect(parseIncomingShare(share({ errors: ["", "error"], files: [] }))?.errors).toEqual(["", "error"]);
  });

  test("rejects wrong file field types and invalid size representations", () => {
    const invalidFiles: unknown[] = [
      {}, { uri: SHARE_ROOT + "0.png" },
      sharedFile({ uri: undefined }),
      sharedFile({ uri: null }),
      sharedFile({ uri: 1 }),
      sharedFile({ name: undefined }),
      sharedFile({ name: null }),
      sharedFile({ name: "" }),
      sharedFile({ name: 1 }),
      sharedFile({ name: "n".repeat(256) }),
      sharedFile({ mime: undefined }),
      sharedFile({ mime: null }),
      sharedFile({ mime: [] }),
      sharedFile({ size: undefined }),
      sharedFile({ size: null }),
      sharedFile({ size: "13" }),
      sharedFile({ size: NaN }),
      sharedFile({ size: Infinity }),
      sharedFile({ size: -Infinity }),
      sharedFile({ size: 0 }),
      sharedFile({ size: -1 }),
      sharedFile({ size: 1.5 }),
      sharedFile({ size: Number.MAX_SAFE_INTEGER + 1 }),
      sharedFile({ size: MAX_ATTACHMENT_BYTES + 1 }),
    ];
    for (const bad of invalidFiles) {
      expect(parseIncomingShare(share({ files: [bad] }))).toBeNull();
    }
  });

  test("rejects non-file schemes, foreign share ids, off-root paths and literal traversal", () => {
    const invalidUris = [
      "https://example.com/incoming-shares/" + ID + "/file.txt",
      "content://provider/incoming-shares/" + ID + "/file.txt",
      "file:///cache/other-share/file.txt",
      "file:///cache/incoming-shares/" + OTHER_ID + "/file.txt",
      "file:///cache/incoming-shares/" + ID + "-other/file.txt",
      SHARE_ROOT + "../secret.txt",
      SHARE_ROOT + "nested/../../secret.txt",
    ];
    for (const uri of invalidUris) {
      expect(parseIncomingShare(share({ files: [sharedFile({ uri })] }))).toBeNull();
    }
  });

  test("rejects combined files beyond 50 MiB without losing the per-file cap", () => {
    const tooMuch = [
      sharedFile({ size: MAX_ATTACHMENT_BYTES }),
      sharedFile({ size: MAX_ATTACHMENT_BYTES }),
      sharedFile({ size: 1 }),
    ];
    expect(parseIncomingShare(share({ files: tooMuch }))).toBeNull();
  });

  test("regression: rejects a 36-character hyphen-only impostor, not a UUID", () => {
    expect(parseIncomingShare(share({ id: "-".repeat(36), files: [] }))).toBeNull();
  });

  test("regression: rejects encoded parent traversal inside the incoming-share cache", () => {
    const encodedTraversal = SHARE_ROOT + "%2e%2e/secret.txt";
    expect(parseIncomingShare(share({
      files: [sharedFile({ uri: encodedTraversal })],
    }))).toBeNull();
  });
});

describe("isShareLink: URL-origin boundaries", () => {
  test("recognizes the intended scheme and exact host, including callback URLs", () => {
    for (const url of [
      "dash://expo-sharing",
      "dash://expo-sharing/",
      "dash://expo-sharing/inbox?item=1#file",
      "DASH://EXPO-SHARING",
    ]) expect(isShareLink(url)).toBe(true);
  });

  test("rejects null, malformed URLs, other schemes/hosts and lookalike redirections", () => {
    for (const url of [
      null, "", "   ", "dash://", "dash:/expo-sharing",
      "dash:expo-sharing", "https://expo-sharing", "file://expo-sharing",
      "dash://expo-sharing.attacker.invalid",
      "dash://expo-sharing-other",
      "dash://other?redirect=dash://expo-sharing",
      "dash://other#expo-sharing",
      "dash://expo-sharing@attacker.invalid",
      "dash://expo-sharing:bad-port",
      "this is not a url",
    ]) expect(isShareLink(url)).toBe(false);
  });
});
