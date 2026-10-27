import { describe, expect, test } from "bun:test";
import { linkifyMarkdown } from "./linkify-paths";

const tick = String.fromCharCode(96);
const codeFence = tick.repeat(3);

describe("DASH-15: bare Markdown links", () => {
  test("URLs and source files become Markdown links on completed lines", () => {
    expect(linkifyMarkdown("Open https://example.com/docs now.\n")).toBe(
      "Open [https://example.com/docs](https://example.com/docs) now.\n",
    );
    expect(linkifyMarkdown("Read src/app.ts:42, then src/app.ts:42:7.\n")).toBe(
      "Read [src/app.ts:42](src/app.ts:42), then [src/app.ts:42:7](src/app.ts:42:7).\n",
    );
    expect(linkifyMarkdown("Open /home/user/app.ts, ~/work/logs, ./src/file.ts or ../src/app.ts.\n")).toBe(
      "Open [/home/user/app.ts](/home/user/app.ts), [~/work/logs](~/work/logs), " +
      "[./src/file.ts](./src/file.ts) or [../src/app.ts](../src/app.ts).\n",
    );
    expect(linkifyMarkdown("Tap https://example.com/a?q=2#head and http://localhost:8080/a.\n")).toBe(
      "Tap [https://example.com/a?q=2#head](https://example.com/a?q=2#head) and " +
      "[http://localhost:8080/a](http://localhost:8080/a).\n",
    );
  });

  test("trailing punctuation stays outside and balanced URL parentheses stay inside", () => {
    const input = "See https://example.com/(release). and https://example.com/help). Also src/main.ts:9; okay!\n";
    expect(linkifyMarkdown(input)).toBe(
      "See [https://example.com/(release)](https://example.com/(release)). and " +
      "[https://example.com/help](https://example.com/help)). Also " +
      "[src/main.ts:9](src/main.ts:9); okay!\n",
    );
    expect(linkifyMarkdown("URL https://example.com/a(b)c)!\n")).toBe(
      "URL [https://example.com/a(b)c](https://example.com/a(b)c))!\n",
    );
    expect(linkifyMarkdown("See (src/app.ts:8), https://x.test/a? \n")).toBe(
      "See ([src/app.ts:8](src/app.ts:8)), [https://x.test/a](https://x.test/a)? \n",
    );
  });

  test("inline code (including multiline and variable-width delimiters) is unchanged", () => {
    const inline = tick + "https://inside.test src/app.ts" + tick;
    const double = tick.repeat(2) + tick + "src/main.ts" + tick + tick.repeat(2);
    expect(linkifyMarkdown("Code " + inline + " then https://outside.test \n")).toBe(
      "Code " + inline + " then [https://outside.test](https://outside.test) \n",
    );
    const acrossLines = "Start " + tick + "https://inside.test\n" +
      "src/app.ts" + tick + " and src/real.ts\n";
    expect(linkifyMarkdown(acrossLines)).toBe(
      "Start " + tick + "https://inside.test\n" +
      "src/app.ts" + tick + " and [src/real.ts](src/real.ts)\n",
    );
    expect(linkifyMarkdown(double + " src/app.ts \n")).toBe(
      double + " [src/app.ts](src/app.ts) \n",
    );
  });

  test("both Markdown fence styles and indented code keep their contents", () => {
    const input = [
      "https://outside.test",
      codeFence + "typescript",
      "https://inside.test src/app.ts:42",
      codeFence,
      "~~~sh",
      "src/tool.ts and https://hidden.test",
      "~~~",
      "    src/indented.ts https://indented.test",
      "\tsrc/tabbed.ts",
      "src/visible.ts",
      "",
    ].join("\n");
    const expected = [
      "[https://outside.test](https://outside.test)",
      codeFence + "typescript",
      "https://inside.test src/app.ts:42",
      codeFence,
      "~~~sh",
      "src/tool.ts and https://hidden.test",
      "~~~",
      "    src/indented.ts https://indented.test",
      "\tsrc/tabbed.ts",
      "[src/visible.ts](src/visible.ts)",
      "",
    ].join("\n");
    expect(linkifyMarkdown(input)).toBe(expected);
  });

  test("existing Markdown links, reference links, images and autolinks stay byte-identical", () => {
    const input = [
      "[already](https://existing.test)",
      "![asset](https://images.test/a.png)",
      "[guide][details] and [shortcut]",
      "[details]: https://existing.test/docs",
      "<https://autolink.test/path> <ftp://another.test/log> <dev@example.com>",
      "new https://new.test",
      "",
    ].join("\n");
    expect(linkifyMarkdown(input)).toBe([
      "[already](https://existing.test)",
      "![asset](https://images.test/a.png)",
      "[guide][details] and [shortcut]",
      "[details]: https://existing.test/docs",
      "<https://autolink.test/path> <ftp://another.test/log> <dev@example.com>",
      "new [https://new.test](https://new.test)",
      "",
    ].join("\n"));
  });

  test("multiline links, reference labels, and images remain protected", () => {
    const input = [
      "[multiline label",
      "https://inside.test/doc](../docs/guide.md) followed by src/outside.ts",
      "![image caption",
      "src/inside.png](https://assets.test/asset.png) then https://public.test",
      "[destination](",
      "https://inside.test/wrapped",
      ") and ./outside.ts",
      "[reference text",
      "https://reference.test][ref]",
      "[plain] plus https://after.test",
      "",
    ].join("\n");
    const expected = [
      "[multiline label",
      "https://inside.test/doc](../docs/guide.md) followed by [src/outside.ts](src/outside.ts)",
      "![image caption",
      "src/inside.png](https://assets.test/asset.png) then [https://public.test](https://public.test)",
      "[destination](",
      "https://inside.test/wrapped",
      ") and [./outside.ts](./outside.ts)",
      "[reference text",
      "https://reference.test][ref]",
      "[plain] plus [https://after.test](https://after.test)",
      "",
    ].join("\n");
    expect(linkifyMarkdown(input)).toBe(expected);
    expect(linkifyMarkdown(expected)).toBe(expected);
  });

  test("unbalanced opening and internal closing URL parentheses have safe hrefs", () => {
    const open = "See https://example.test/a(b now \n";
    const escapedOpen = "See [https://example.test/a(b](https://example.test/a\\(b) now \n";
    expect(linkifyMarkdown(open)).toBe(escapedOpen);
    expect(linkifyMarkdown(escapedOpen)).toBe(escapedOpen);

    const close = "See https://example.test/a)b?q=1 now \n";
    const escapedClose = "See [https://example.test/a)b?q=1](https://example.test/a\\)b?q=1) now \n";
    expect(linkifyMarkdown(close)).toBe(escapedClose);
    expect(linkifyMarkdown(escapedClose)).toBe(escapedClose);
    expect(linkifyMarkdown("See https://example.test/a(b)c now \n")).toBe(
      "See [https://example.test/a(b)c](https://example.test/a(b)c) now \n",
    );
  });

  test("HTML elements, attributes, bodies and comments are left unchanged", () => {
    const input = [
      '<a href="https://inside.test">src/app.ts</a> https://outside.test',
      '<span data-url="https://attribute.test">https://body.test</span> src/after.ts',
      "<!-- https://comment.test",
      "src/comment.ts --> https://visible.test",
      '<div class="sample">',
      "https://nested.test src/code.ts",
      "</div>",
      "<br> https://void.test",
      "",
    ].join("\n");
    expect(linkifyMarkdown(input)).toBe([
      '<a href="https://inside.test">src/app.ts</a> [https://outside.test](https://outside.test)',
      '<span data-url="https://attribute.test">https://body.test</span> [src/after.ts](src/after.ts)',
      "<!-- https://comment.test",
      "src/comment.ts --> [https://visible.test](https://visible.test)",
      '<div class="sample">',
      "https://nested.test src/code.ts",
      "</div>",
      "<br> [https://void.test](https://void.test)",
      "",
    ].join("\n"));
  });

  test("negative controls do not invent links", () => {
    const negatives = [
      "1.2.3", "a/b", "and/or", "me@example.com", "me@example.com/file.ts",
      "word/thing", "foo.bar", "42.17", "https://", "./", "../", "~/",
    ];
    for (const input of negatives) {
      expect(linkifyMarkdown(input + " \n")).toBe(input + " \n");
    }
    expect(linkifyMarkdown("foo/thing.txt src/real.ts\n")).toBe(
      "[foo/thing.txt](foo/thing.txt) [src/real.ts](src/real.ts)\n",
    );
  });

  test("do not linkify an unfinished streaming tail until it ends in whitespace", () => {
    expect(linkifyMarkdown("See https://example.test")).toBe("See https://example.test");
    expect(linkifyMarkdown("Read src/app.ts:4")).toBe("Read src/app.ts:4");
    expect(linkifyMarkdown("Read src/app.ts:4 ")).toBe(
      "Read [src/app.ts:4](src/app.ts:4) ",
    );
    expect(linkifyMarkdown("See https://example.test\t")).toBe(
      "See [https://example.test](https://example.test)\t",
    );
    expect(linkifyMarkdown("Done src/ok.ts\nNext src/par")).toBe(
      "Done [src/ok.ts](src/ok.ts)\nNext src/par",
    );
  });

  test("transformation is idempotent over normal, code, HTML and partial-line fixtures", () => {
    const fixtures = [
      "Open https://example.test and src/app.ts:4 \n",
      "Go https://example.test/(foo). \n",
      "Go https://example.test/odd). \n",
      "See https://example.test/a(b now \n",
      "[label\nhttps://inside.test](target) and src/after.ts\n",
      tick + "https://example.test" + tick + " src/real.ts \n",
      codeFence + "ts\nsrc/no.ts\n" + codeFence + "\nsrc/yes.ts\n",
      "~~~\nhttps://no.test\n~~~\nhttps://yes.test\n",
      "[x](https://existing.test) ![img](src/file.png) src/yes.ts\n",
      "<https://autolink.test> <a href='https://inside.test'>src/no.ts</a> src/yes.ts\n",
      "1.2.3 and/or me@example.com src/yes.ts\n",
      "A trailing https://not-yet.test",
    ];
    for (const fixture of fixtures) {
      const once = linkifyMarkdown(fixture);
      expect(linkifyMarkdown(once)).toBe(once);
    }
  });

  test("input size is bounded; long slash lines do not backtrack", () => {
    // A complete, linkifiable first line is essential: a partial tail would
    // stay unchanged for streaming reasons even if the size guard were removed.
    const firstLine = "src/app.ts \n";
    const padding = "x".repeat(200_000 - firstLine.length);
    const atLimit = firstLine + padding;
    expect(atLimit.length).toBe(200_000);
    expect(linkifyMarkdown(atLimit)).toBe("[src/app.ts](src/app.ts) \n" + padding);
    const oversized = atLimit + "x";
    expect(oversized.length).toBe(200_001);
    expect(linkifyMarkdown(oversized)).toBe(oversized);
    const slashLine = "/".repeat(50_000) + " src/ok.ts \n";
    expect(linkifyMarkdown(slashLine)).toBe(
      "/".repeat(50_000) + " [src/ok.ts](src/ok.ts) \n",
    );
  });
});
