import { describe, expect, test } from "bun:test";
import { createSentenceChunker } from "./tts-sentence-chunker";

const tick = String.fromCharCode(96);
const fence = tick.repeat(3);

function collect(source: string, maxWords = 24): string[] {
  const chunker = createSentenceChunker({ maxWords });
  return [...chunker.push(source), ...chunker.flush()];
}

describe("streaming first-audible sentence chunks", () => {
  test("emits sentence one on its first terminator plus whitespace, not at flush", () => {
    const chunker = createSentenceChunker();
    for (const char of "Hello there.") expect(chunker.push(char)).toEqual([]);
    expect(chunker.push(" ")).toEqual(["Hello there."]);
    for (const char of "Second sentence!") expect(chunker.push(char)).toEqual([]);
    expect(chunker.flush()).toEqual(["Second sentence!"]);
    expect(chunker.flush()).toEqual([]);
  });

  test("keeps a closing quotation mark with the sentence", () => {
    expect(collect('She said "Hello there." Then we walked on.')).toEqual([
      'She said "Hello there."',
      "Then we walked on.",
    ]);
  });

  test("does not cut numeric decimals, versions or URLs mid-token", () => {
    expect(collect("Value is 3.5 in v1.2 at https://x.y/z. Next sentence now."))
      .toEqual(["Value is 3.5 in v1.2 at https://x.y/z.", "Next sentence now."]);
  });

  test("defers abbreviations until the following word resolves them", () => {
    const text = "Use e.g. this example, i.e. the working version, vs. other options " +
      "with Dr. Smith and Mr. Jones. We are finished.";
    expect(collect(text)).toEqual([
      "Use e.g. this example, i.e. the working version, vs. other options with Dr. Smith and Mr. Jones.",
      "We are finished.",
    ]);
    expect(collect("We considered etc. Another sentence follows."))
      .toEqual(["We considered etc.", "Another sentence follows."]);
  });

  test("does not emit a one-word sentence until minWords is satisfied", () => {
    const chunker = createSentenceChunker({ minWords: 2 });
    expect(chunker.push("Yes. ")).toEqual([]);
    expect(chunker.push("Absolutely. ")).toEqual(["Yes. Absolutely."]);
    expect(chunker.flush()).toEqual([]);
  });

  test("a 40-word run-on prefers the last comma inside the 24-word window", () => {
    const words = Array.from({ length: 40 }, (_, index) => "word" + (index + 1));
    words[16] += ",";
    const chunker = createSentenceChunker();
    const completed = chunker.push(words.join(" "));
    expect(completed).toEqual([words.slice(0, 17).join(" ")]);
    expect(chunker.flush()).toEqual([words.slice(17).join(" ")]);
  });

  test("hard-breaks exactly at maxWords when there is no clause punctuation", () => {
    const words = Array.from({ length: 40 }, (_, index) => "term" + (index + 1));
    expect(collect(words.join(" "))).toEqual([
      words.slice(0, 24).join(" "),
      words.slice(24).join(" "),
    ]);
  });

  test("drops complete generated-UI and code fences with all contents", () => {
    const stream = [
      "Read these words.",
      fence + "openui",
      '{"ui":"NEVER_SPEAK_UI"}',
      fence,
      "Read more text.",
      "~~~typescript",
      'const key = "NEVER_SPEAK_CODE";',
      "~~~",
      "And finish here.",
    ].join("\n");
    const spoken = collect(stream);
    expect(spoken).toEqual(["Read these words.", "Read more text.", "And finish here."]);
    expect(spoken.join(" ")).not.toContain("NEVER_SPEAK");
  });

  test("an unclosed fence and its partial information label stay silent", () => {
    const chunker = createSentenceChunker();
    const source = "Hear these words.\n" + fence + "genui\n" + '{"data":"NEVER_SPEAK"}';
    const chunks: string[] = [];
    for (const char of source) chunks.push(...chunker.push(char));
    chunks.push(...chunker.flush());
    expect(chunks).toEqual(["Hear these words."]);
    expect(chunks.join(" ")).not.toContain("NEVER_SPEAK");
  });

  test("honors longer CRLF fences and will not treat a short fence as closure", () => {
    const wide = tick.repeat(4);
    const source = "Read this part.\r\n" + wide + "json\r\n" +
      fence + " not a matching close\r\n" +
      "NEVER_SPEAK\r\n" + wide + "\r\n" + "End of story.";
    expect(collect(source)).toEqual(["Read this part.", "End of story."]);
  });

  test("strips inline code, heading/emphasis markers and link URLs", () => {
    const source = "## **Explain** [the result](https://secret.test/a(b)) and " +
      tick + "const secret = 42;" + tick + " finish here.";
    expect(collect(source)).toEqual(["Explain the result and finish here."]);
    expect(collect("Use " + tick + "PRIVATE_OPEN_CODE"))
      .toEqual(["Use"]);
  });

  test("flush trims the remainder, never emits empty text, and permits reuse", () => {
    const chunker = createSentenceChunker();
    expect(chunker.push("  Complete words. ")).toEqual(["Complete words."]);
    expect(chunker.flush()).toEqual([]);
    expect(chunker.push("  Another unfinished reply  ")).toEqual([]);
    expect(chunker.flush()).toEqual(["Another unfinished reply"]);
    expect(chunker.flush()).toEqual([]);
    expect(collect("  " + fence + "openui")).toEqual([]);
  });

  test("rejects invalid word limits rather than silently changing timing", () => {
    expect(() => createSentenceChunker({ maxWords: 0 })).toThrow(RangeError);
    expect(() => createSentenceChunker({ minWords: -1 })).toThrow(RangeError);
    expect(() => createSentenceChunker({ maxWords: 1, minWords: 2 })).toThrow(RangeError);
  });

  test("20 pseudorandom delta partitions match a whole-push reference", () => {
    const fixture = [
      "Start speaking here. Numbers like 3.5 and versions v1.2 need care.",
      "Use e.g. this link [the archive](https://example.org/a(b)) for the details.",
      fence + "genui",
      '{"title":"NEVER_SPEAK_GENERATED_UI"}',
      fence,
      "After the fence, speak ordinary words; the clauses include commas, " +
        "and another collection of words with no early period to test limits.",
      "Finally, the last two words.",
    ].join("\n");

    const expected = collect(fixture, 12);
    expect(expected.length).toBeGreaterThan(3);
    expect(expected.join(" ")).not.toContain("NEVER_SPEAK");

    for (let seed = 1; seed <= 20; seed++) {
      const chunker = createSentenceChunker({ maxWords: 12 });
      let state = seed;
      let offset = 0;
      const actual: string[] = [];
      while (offset < fixture.length) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const length = 1 + (state % 13);
        actual.push(...chunker.push(fixture.slice(offset, offset + length)));
        offset += length;
      }
      actual.push(...chunker.flush());
      expect(actual).toEqual(expected);
    }
  });
});
