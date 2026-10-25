import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { IncomingShare } from "../lib/incoming-share";
import { consumeSharedDraft, sharedDrafts, stageSharedDraft } from "./shared-drafts";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

function incoming(id: string, text: string): IncomingShare {
  return {
    id,
    text,
    files: [
      {
        uri: "file:///incoming-shares/" + id + "/fixture.png",
        name: "fixture.png",
        mime: "image/png",
        size: 256,
      },
    ],
    errors: ["Unable to copy notes.txt"],
  };
}

// The producer is a singleton; leave it empty for both neighboring files and later tests.
beforeEach(() => sharedDrafts.set({}));
afterEach(() => sharedDrafts.set({}));

describe("shared draft staging and exact-id consumption", () => {
  test("different conversations can stage the same share id without stealing one another's text", () => {
    const forA = incoming(FIRST_ID, "From A");
    const forB = incoming(FIRST_ID, "From B");

    expect(stageSharedDraft("chat-a", forA)).toBe(true);
    expect(stageSharedDraft("chat-b", forB)).toBe(true);
    expect(sharedDrafts.get()["chat-a"]).toEqual(forA);
    expect(sharedDrafts.get()["chat-b"]).toEqual(forB);

    consumeSharedDraft("chat-a", FIRST_ID);
    expect(sharedDrafts.get()["chat-a"]).toBeUndefined();
    expect(sharedDrafts.get()["chat-b"]).toEqual(forB);
    expect(Object.keys(sharedDrafts.get())).toEqual(["chat-b"]);

    consumeSharedDraft("chat-b", FIRST_ID);
    expect(sharedDrafts.get()).toEqual({});
  });

  test("occupied conversation rejects both same-id and different-id replacements", () => {
    const original = incoming(FIRST_ID, "Original, unread");
    const sameIdReplacement = incoming(FIRST_ID, "Different data, same share id");
    const otherIdReplacement = incoming(SECOND_ID, "Different data, new share id");

    expect(stageSharedDraft("chat-a", original)).toBe(true);
    const beforeCollision = sharedDrafts.get();
    expect(stageSharedDraft("chat-a", sameIdReplacement)).toBe(false);
    expect(stageSharedDraft("chat-a", otherIdReplacement)).toBe(false);
    expect(sharedDrafts.get()).toBe(beforeCollision);
    expect(sharedDrafts.get()["chat-a"]).toEqual(original);

    // A collision in one destination must not block another destination.
    expect(stageSharedDraft("chat-b", otherIdReplacement)).toBe(true);
    expect(sharedDrafts.get()["chat-a"]).toEqual(original);
    expect(sharedDrafts.get()["chat-b"]).toEqual(otherIdReplacement);
  });

  test("a different chat's id cannot consume the current chat's draft", () => {
    const forA = incoming(FIRST_ID, "A");
    const forB = incoming(SECOND_ID, "B");
    expect(stageSharedDraft("chat-a", forA)).toBe(true);
    expect(stageSharedDraft("chat-b", forB)).toBe(true);

    const previous = sharedDrafts.get();
    consumeSharedDraft("chat-a", SECOND_ID);
    consumeSharedDraft("chat-b", FIRST_ID);
    consumeSharedDraft("missing-chat", FIRST_ID);

    expect(sharedDrafts.get()).toBe(previous);
    expect(sharedDrafts.get()["chat-a"]).toEqual(forA);
    expect(sharedDrafts.get()["chat-b"]).toEqual(forB);

    consumeSharedDraft("chat-b", SECOND_ID);
    expect(sharedDrafts.get()["chat-a"]).toEqual(forA);
    expect(sharedDrafts.get()["chat-b"]).toBeUndefined();
  });

  test("wrong and repeated consumes do not notify; a consumed slot accepts a new id", () => {
    const first = incoming(FIRST_ID, "First");
    const next = incoming(SECOND_ID, "Next");
    let notifications = 0;
    const unsubscribe = sharedDrafts.subscribe(() => {
      notifications += 1;
    });

    try {
      expect(stageSharedDraft("chat-a", first)).toBe(true);
      expect(notifications).toBe(1);

      const occupied = sharedDrafts.get();
      consumeSharedDraft("chat-a", SECOND_ID);
      expect(sharedDrafts.get()).toBe(occupied);
      expect(notifications).toBe(1);

      consumeSharedDraft("chat-a", FIRST_ID);
      expect(sharedDrafts.get()).toEqual({});
      expect(Object.keys(sharedDrafts.get())).toEqual([]);
      expect(notifications).toBe(2);

      const cleared = sharedDrafts.get();
      consumeSharedDraft("chat-a", FIRST_ID);
      expect(sharedDrafts.get()).toBe(cleared);
      expect(notifications).toBe(2);

      expect(stageSharedDraft("chat-a", next)).toBe(true);
      expect(notifications).toBe(3);
      const restaged = sharedDrafts.get();
      consumeSharedDraft("chat-a", FIRST_ID); // Late completion from the previous share.
      expect(sharedDrafts.get()).toBe(restaged);
      expect(sharedDrafts.get()["chat-a"]).toEqual(next);
      expect(notifications).toBe(3);

      consumeSharedDraft("chat-a", SECOND_ID);
      expect(sharedDrafts.get()).toEqual({});
      expect(notifications).toBe(4);
    } finally {
      unsubscribe();
    }
  });

  test("staging, collision rejection and consumption preserve files, text and errors", () => {
    const file = {
      uri: "file:///incoming-shares/" + FIRST_ID + "/annotated.png",
      name: "annotated.png",
      mime: "image/png",
      size: 512,
    };
    const share: IncomingShare = {
      id: FIRST_ID,
      text: "First line\nSecond line with Unicode: café",
      files: [file],
      errors: ["Failed to copy archive.zip", "Unknown file type"],
    };
    const expected = {
      id: share.id,
      text: share.text,
      files: [{ ...file }],
      errors: [...share.errors],
    };
    // Mutation of the supplied payload must fail instead of changing attachment/error data.
    Object.freeze(file);
    Object.freeze(share.files);
    Object.freeze(share.errors);
    Object.freeze(share);

    expect(stageSharedDraft("chat-a", share)).toBe(true);
    expect(sharedDrafts.get()["chat-a"]).toEqual(expected);
    expect(stageSharedDraft("chat-a", incoming(SECOND_ID, "Overwrite"))).toBe(false);
    expect(sharedDrafts.get()["chat-a"]).toEqual(expected);
    consumeSharedDraft("chat-a", SECOND_ID);
    expect(sharedDrafts.get()["chat-a"]).toEqual(expected);
    consumeSharedDraft("chat-a", FIRST_ID);
    expect(sharedDrafts.get()["chat-a"]).toBeUndefined();
    expect(share).toEqual(expected);
  });
});
