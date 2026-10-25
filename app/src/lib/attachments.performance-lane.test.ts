import { describe, expect, test } from "bun:test";
import {
  MAX_ATTACHMENTS_PER_TURN,
  canSendDrafts,
  fileRefs,
  readyRefs,
  remainingSlots,
  type DraftAttachment,
} from "./attachments";
import type { ChatAttachment } from "../../../shared/protocol";

/**
 * Performance guard, not a benchmark. All assertions are deterministic outputs
 * or observable property-read counts; no clocks, timers, network or services.
 *
 * Optional manual timing (NOT RUN):
 * Input: 4,096 distinct absolute paths, joined with spaces; cap = 8.
 * From the repository root:
 * bun -e 'import { fileRefs } from "./app/src/lib/attachments.ts"; const text = Array.from({length:4096}, (_, i) => "/workspace/runs/job-" + i + "/result-" + i + ".png").join(" "); const start = performance.now(); for (let i = 0; i < 1000; i++) fileRefs(text, 8); console.log(performance.now() - start);'
 * Local baseline: NOT RUN. Proposed change: NOT RUN. Native/device: NOT RUN.
 * Do not turn these optional timings into test assertions without profiling.
 */
const LARGE_COUNT = 4096;

function reference(index: number): ChatAttachment {
  return {
    id: index.toString(16).padStart(32, "0"),
    name: "result-" + index + ".png",
    mime: "image/png",
    size: index + 1,
  };
}

function draft(
  state: DraftAttachment["state"],
  index: number,
  ref?: ChatAttachment,
  onStateRead?: () => void,
  onRefRead?: () => void,
): DraftAttachment {
  return {
    key: "draft-" + index,
    name: "result-" + index + ".png",
    mime: "image/png",
    uri: "file:///tmp/result-" + index + ".png",
    size: index + 1,
    get state(): DraftAttachment["state"] {
      onStateRead?.();
      return state;
    },
    get ref(): ChatAttachment | undefined {
      onRefRead?.();
      return ref;
    },
  };
}

describe("fileRefs performance lane", () => {
  test("preserves the exact first paths, punctuation, order and deduplication", () => {
    const text = [
      "Saved /work/build/report-final.txt;",
      "inspect (/tmp/dash/screens/shot-1.png)",
      "and '/home/alice/notes/2026-10-25.md'.",
      "Repeated /work/build/report-final.txt.",
    ].join(" ");
    const paths = [
      "/work/build/report-final.txt",
      "/tmp/dash/screens/shot-1.png",
      "/home/alice/notes/2026-10-25.md",
    ];

    expect(fileRefs(text)).toEqual(paths);
    expect(fileRefs(text, 1)).toEqual(paths.slice(0, 1));
    expect(fileRefs(text, 2)).toEqual(paths.slice(0, 2));
    expect(fileRefs(text, MAX_ATTACHMENTS_PER_TURN)).toEqual(paths);
    expect(text).toContain("Repeated /work/build/report-final.txt.");
  });

  test("filters non-host paths and traversal rather than consuming result slots", () => {
    const text = [
      "https://example.test/assets/a.png",
      "~/private/a.png",
      "./relative/a.png",
      "/work/out/../secrets.txt",
      "/single.png",
      "/work/out/directory/",
      "Finished /work/out/valid.png",
    ].join(" ");
    expect(fileRefs(text, 1)).toEqual(["/work/out/valid.png"]);
  });

  test("4,096 file-like paths respect both the default limit and the attachment cap", () => {
    const paths = Array.from(
      { length: LARGE_COUNT },
      (_, index) => "/workspace/runs/job-" + index + "/result-" + index + ".png",
    );
    const text = "https://example.test/art/ignored.png " + paths.join(" ") + " ~/ignored/file.png";

    expect(fileRefs(text)).toEqual(paths.slice(0, 3));
    expect(fileRefs(text, 1)).toEqual(paths.slice(0, 1));
    expect(fileRefs(text, MAX_ATTACHMENTS_PER_TURN)).toEqual(paths.slice(0, MAX_ATTACHMENTS_PER_TURN));
    expect(fileRefs(text, MAX_ATTACHMENTS_PER_TURN + 1)).toEqual(paths.slice(0, MAX_ATTACHMENTS_PER_TURN + 1));
    expect(paths).toHaveLength(LARGE_COUNT);
  });

  test("4,096 duplicates cannot crowd out a distinct late result", () => {
    const first = "/workspace/jobs/first.log";
    const last = "/workspace/jobs/last.png";
    const text = [first, ...Array.from({ length: LARGE_COUNT }, () => first), last].join(" ");

    expect(fileRefs(text, 2)).toEqual([first, last]);
    expect(fileRefs(text, 1)).toEqual([first]);
  });
});

describe("remainingSlots performance lane", () => {
  test("clamps at the source-declared per-turn cap, even for oversized lists", () => {
    for (const count of [0, 1, MAX_ATTACHMENTS_PER_TURN - 1, MAX_ATTACHMENTS_PER_TURN, MAX_ATTACHMENTS_PER_TURN + 1, LARGE_COUNT]) {
      let stateReads = 0;
      let refReads = 0;
      const drafts = Object.freeze(
        Array.from({ length: count }, (_, index) =>
          Object.freeze(draft("ready", index, reference(index), () => { stateReads++; }, () => { refReads++; })),
        ),
      );

      expect(remainingSlots(drafts)).toBe(Math.max(0, MAX_ATTACHMENTS_PER_TURN - count));
      // Remaining slots needs only array.length; do not traverse potentially large items.
      expect(stateReads).toBe(0);
      expect(refReads).toBe(0);
      expect(drafts).toHaveLength(count);
    }
  });
});

describe("readyRefs performance lane", () => {
  test("keeps only ready references, in the same order and identity, inside one full turn", () => {
    const refs = Array.from({ length: MAX_ATTACHMENTS_PER_TURN }, (_, index) => reference(index));
    let stateReads = 0;
    let readyRefReads = 0;
    let nonReadyRefReads = 0;
    const entries = Object.freeze(
      Array.from({ length: MAX_ATTACHMENTS_PER_TURN }, (_, index) => {
        const state: DraftAttachment["state"] =
          index % 4 === 0 ? "ready" : index % 4 === 1 ? "local" : index % 4 === 2 ? "uploading" : "error";
        return Object.freeze(draft(
          state,
          index,
          refs[index],
          () => { stateReads++; },
          () => { if (state === "ready") readyRefReads++; else nonReadyRefReads++; },
        ));
      }),
    );
    const expected = refs.filter((_, index) => index % 4 === 0);

    const actual = readyRefs(entries);
    expect(actual).toEqual(expected);
    for (let index = 0; index < actual.length; index++) {
      expect(actual[index]).toBe(expected[index]);
    }
    expect(actual.length).toBeLessThanOrEqual(MAX_ATTACHMENTS_PER_TURN);
    expect(remainingSlots(entries)).toBe(0);
    expect(stateReads).toBe(MAX_ATTACHMENTS_PER_TURN);
    // Never touch a local/uploading/error ref, even if it holds stale uploaded data.
    expect(nonReadyRefReads).toBe(0);
    expect(readyRefReads).toBeGreaterThanOrEqual(expected.length);
    expect(readyRefReads).toBeLessThanOrEqual(expected.length * 2);
  });

  test("excludes ready chips missing a reference without promoting error refs", () => {
    const valid = reference(7);
    const entries = Object.freeze([
      Object.freeze(draft("ready", 0)),
      Object.freeze(draft("local", 1, reference(1))),
      Object.freeze(draft("uploading", 2, reference(2))),
      Object.freeze(draft("error", 3, reference(3))),
      Object.freeze(draft("ready", 4, valid)),
    ]);
    expect(readyRefs(entries)).toEqual([valid]);
    expect(readyRefs(entries)[0]).toBe(valid);
    expect(entries).toHaveLength(5);
  });
});

describe("canSendDrafts performance lane", () => {
  test("local or uploading drafts block a long text without scanning later entries", () => {
    const blockingStates: DraftAttachment["state"][] = ["uploading", "local"];
    for (const blockedState of blockingStates) {
      const visited: number[] = [];
      const entries = Object.freeze(
        Array.from({ length: LARGE_COUNT }, (_, index) =>
          Object.freeze(draft(
            index === 2 ? blockedState : "ready",
            index,
            reference(index),
            () => { visited.push(index); },
          )),
        ),
      );
      expect(canSendDrafts("A complete message", entries)).toBe(false);
      // Two ready checks each read state twice; the blocker stops the first some().
      expect(visited).toEqual(blockedState === "uploading" ? [0, 0, 1, 1, 2] : [0, 0, 1, 1, 2, 2]);
    }
  });

  test("nonempty text with 4,096 ready drafts does not perform a second ready search", () => {
    let stateReads = 0;
    const entries = Object.freeze(
      Array.from({ length: LARGE_COUNT }, (_, index) =>
        Object.freeze(draft("ready", index, reference(index), () => { stateReads++; })),
      ),
    );
    expect(canSendDrafts(" \n Send \t ", entries)).toBe(true);
    // The blocking scan checks both pending states for each ready entry.
    // Nonempty trimmed text short-circuits the subsequent ready lookup.
    expect(stateReads).toBe(LARGE_COUNT * 2);
  });

  test("empty text visits ready candidates lazily; error alone cannot enable send", () => {
    const visited: number[] = [];
    const entries = Object.freeze(
      Array.from({ length: MAX_ATTACHMENTS_PER_TURN }, (_, index) =>
        Object.freeze(draft(
          index === MAX_ATTACHMENTS_PER_TURN - 1 ? "ready" : "error",
          index,
          reference(index),
          () => { visited.push(index); },
        )),
      ),
    );
    expect(canSendDrafts(" \n\t ", entries)).toBe(true);
    expect(visited).toHaveLength(MAX_ATTACHMENTS_PER_TURN * 3);
    expect(visited.slice(-MAX_ATTACHMENTS_PER_TURN)).toEqual(
      Array.from({ length: MAX_ATTACHMENTS_PER_TURN }, (_, index) => index),
    );

    const errors = Object.freeze([Object.freeze(draft("error", 0, reference(0)))]);
    expect(canSendDrafts(" \n ", errors)).toBe(false);
    expect(canSendDrafts("send", errors)).toBe(true);
    expect(canSendDrafts(" \t ", Object.freeze([]))).toBe(false);
    expect(canSendDrafts("text", Object.freeze([]))).toBe(true);
  });

  test("pure helpers leave frozen inputs and unrelated callbacks untouched", () => {
    let unrelatedCalls = 0;
    const untouched = () => { unrelatedCalls++; };
    const originalRef = Object.freeze(reference(20));
    const originalDraft = Object.freeze({ ...draft("ready", 20, originalRef), unrelated: untouched });
    const entries = Object.freeze([originalDraft]);

    expect(remainingSlots(entries)).toBe(MAX_ATTACHMENTS_PER_TURN - 1);
    expect(readyRefs(entries)).toEqual([originalRef]);
    expect(canSendDrafts("", entries)).toBe(true);
    expect(fileRefs("Look at /work/out/result.png", 1)).toEqual(["/work/out/result.png"]);

    expect(unrelatedCalls).toBe(0);
    expect(entries[0]).toBe(originalDraft);
    expect(entries[0]?.ref).toBe(originalRef);
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(originalDraft)).toBe(true);
  });
});
