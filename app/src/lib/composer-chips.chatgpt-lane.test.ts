import { describe, expect, test } from "bun:test";
import { spawn } from "bun";
import { fileURLToPath } from "node:url";
import { composerChips, modelChipLabel } from "./composer-chips";

describe("modelChipLabel", () => {
  const examples = [
    { model: "anthropic/claude-x-1", provider: "anthropic", expected: "claude-x-1" },
    { model: "anthropic/claude-x-1", expected: "claude-x-1" },
    { model: "openai/gpt-x-2024-08-06", provider: "openai", expected: "gpt-x" },
    { model: "openai/gpt-x-2024-08-06", provider: "other", expected: "gpt-x" },
    { model: "model@2025-01-01", expected: "model" },
    { model: "gpt-4.1-20250101", expected: "gpt-4.1" },
    { model: "gpt-4.1-latest", expected: "gpt-4.1" },
    { model: "openai/gpt-4.1-latest@2025-01-01", expected: "gpt-4.1" },
    { model: "gpt-4.1-2025-01-01-latest", expected: "gpt-4.1" },
    { model: "org/claude-v-2.7", expected: "claude-v-2.7" },
    { model: "  Anthropic/claude-v3  ", provider: "anthropic", expected: "claude-v3" },
  ];

  for (const entry of examples) {
    test("cleans aliases without dropping versions: " + entry.model, () => {
      expect(modelChipLabel(entry.model, entry.provider)).toEqual({
        short: entry.expected,
        full: entry.expected,
      });
    });
  }

  test("middle truncates at 18 characters while retaining the full screen-reader name", () => {
    const full = "super-long-model-family-version-12.7";
    const result = modelChipLabel(full);
    expect(result).toEqual({ short: full.slice(0, 9) + "…" + full.slice(-8), full });
    expect(result?.short.length).toBe(18);
    expect(result?.short.endsWith("ion-12.7")).toBe(true);
  });

  test("does not truncate an 18-character label", () => {
    const full = "0123456789abcdefgh";
    expect(modelChipLabel(full)).toEqual({ short: full, full });
  });

  test("suppresses empty and unknown model readings", () => {
    expect(modelChipLabel()).toBeNull();
    for (const model of ["", "   ", "unknown", "MODEL UNKNOWN", "n/a", "none", "unavailable", "anthropic/model unknown", "anthropic/", "gpt-4-latest-20250101"]) {
      const result = modelChipLabel(model);
      if (model === "gpt-4-latest-20250101") {
        expect(result).toEqual({ short: "gpt-4", full: "gpt-4" });
      } else {
        expect(result).toBeNull();
      }
    }
  });
});

test("slash-containing unknown readings stay hidden before and after provider normalization", () => {
  for (const provider of [undefined, "n", "openai"]) {
    for (const model of ["n/a", " N/A ", "openai/n/a", "openai/model unknown"]) {
      expect(modelChipLabel(model, provider)).toBeNull();
      expect(composerChips({ model, provider, streaming: false })).toEqual([]);
    }
  }
  expect(modelChipLabel("n/actual-model", "n")).toEqual({ short: "actual-model", full: "actual-model" });
});

// Render the real component through React DOM and the existing RN web adapter.
// Isolate the native-module alias in a child so it cannot leak to other suites.
async function checkChipRender(assertions: string) {
  const code = `
    import { expect, mock } from "bun:test";
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    const nativeWeb = await import("react-native-web");
    mock.module("react-native", () => nativeWeb);
    const { ComposerStatChips } = await import("../components/ComposerStatChips.tsx");
    const render = props => renderToStaticMarkup(createElement(ComposerStatChips, props));
    const cssFor = markup => {
      const classes = [...markup.matchAll(/class="([^"]+)"/g)].flatMap(match => match[1].split(" "));
      const css = nativeWeb.StyleSheet.getSheet().textContent;
      return css.split("}").filter(rule => classes.some(name => rule.includes("." + name + "{"))).join("}");
    };
    ${assertions}
  `;
  const child = spawn([process.execPath, "-e", code], {
    cwd: fileURLToPath(new URL(".", import.meta.url)), stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: "", stderr: "" });
}

describe("ComposerStatChips rendering", () => {
  test("renders ordered passive accessible chips with estimated speed and full model identity", async () => {
    await checkChipRender(`
      const full = "unusually-extended-model-series-version-12.7";
      const html = render({ model: full, streaming: true, rateLabel: "≈42 tok/s" });
      expect(html).toContain('aria-label="Model: ' + full + '"');
      expect(html).toContain('aria-label="Speed: 42 tokens per second, estimated"');
      expect(html.indexOf('data-testid="composer-stat-model"')).toBeLessThan(html.indexOf('data-testid="composer-stat-rate"'));
      expect(cssFor(html)).toContain('font-size:12px');
      expect(html).not.toMatch(/<button|role="button"|tabindex="0"/);
    `);
  });

  test("reserves the same fixed rate slot before, during, and after samples", async () => {
    await checkChipRender(`
      for (const state of [
        { streaming: false },
        { streaming: true },
        { streaming: true, rateLabel: "≈42 tok/s" },
        { streaming: false, recent: true, rateLabel: "42 tok/s" },
        { streaming: false, recent: false, rateLabel: "42 tok/s" },
      ]) {
        const html = render({ model: "gpt-4.1", ...state });
        const slot = html.match(/<div[^>]*data-testid="composer-stat-rate-slot"[^>]*>/)?.[0];
        expect(slot).toBeDefined();
        const css = cssFor(slot ?? "");
        expect(css).toContain('min-width:112px');
        expect(css).toContain('{width:112px');
        expect(css).toContain('height:28px');
        expect(css).toContain('flex-shrink:0');
        expect(html.includes('data-testid="composer-stat-rate"')).toBe(Boolean(state.rateLabel && (state.streaming || state.recent)));
      }
    `);
  });

  test("hides unknown idle identity and renders speed without a model", async () => {
    await checkChipRender(`
      expect(render({ model: "n/a", streaming: false })).toBe("");
      const waiting = render({ streaming: true });
      expect(waiting).toContain('data-testid="composer-stat-rate-slot"');
      expect(waiting).not.toContain('data-testid="composer-stat-rate"');
      const speed = render({ streaming: true, rateLabel: "42 tok/s" });
      expect(speed).toContain('aria-label="Speed: 42 tokens per second"');
      expect(speed).not.toContain('data-testid="composer-stat-model"');
      expect(speed).not.toContain('estimated');
    `);
  });
});

describe("composerChips", () => {
  test("orders model first, then estimated speed with fully spoken labels", () => {
    expect(composerChips({
      model: "anthropic/claude-x-1",
      provider: "anthropic",
      rateLabel: "≈42 tok/s",
      streaming: true,
    })).toEqual([
      { id: "model", label: "claude-x-1", accessibilityLabel: "Model: claude-x-1" },
      { id: "rate", label: "≈42 tok/s", accessibilityLabel: "Speed: 42 tokens per second, estimated" },
    ]);
  });

  test("measured speeds do not claim to be estimates", () => {
    expect(composerChips({ model: "gpt-4.1", rateLabel: "9.9 tok/s", streaming: true })[1])
      .toEqual({ id: "rate", label: "9.9 tok/s", accessibilityLabel: "Speed: 9.9 tokens per second" });
  });

  test("an estimate is announced even with whitespace after the approximation marker", () => {
    expect(composerChips({ rateLabel: "  ≈ 9.4 tok/s  ", streaming: true }))
      .toEqual([{ id: "rate", label: "≈ 9.4 tok/s", accessibilityLabel: "Speed: 9.4 tokens per second, estimated" }]);
  });

  test("retains speed for the caller's five-second recent window, but not when idle", () => {
    const input = { model: "gpt-4.1", rateLabel: "42 tok/s", streaming: false };
    expect(composerChips({ ...input, recent: true }).map(chip => chip.id)).toEqual(["model", "rate"]);
    expect(composerChips({ ...input, recent: false }).map(chip => chip.id)).toEqual(["model"]);
    expect(composerChips(input).map(chip => chip.id)).toEqual(["model"]);
  });

  test("allows speed without a model and model without a speed", () => {
    expect(composerChips({ streaming: true, rateLabel: "42 tok/s" }))
      .toEqual([{ id: "rate", label: "42 tok/s", accessibilityLabel: "Speed: 42 tokens per second" }]);
    expect(composerChips({ model: "gpt-4.1", streaming: true, rateLabel: null }))
      .toEqual([{ id: "model", label: "gpt-4.1", accessibilityLabel: "Model: gpt-4.1" }]);
  });

  test("never announces the unknown sentinel or invents a rate", () => {
    expect(composerChips({ model: "model unknown", streaming: false })).toEqual([]);
    expect(composerChips({ model: "unknown", streaming: true, rateLabel: null })).toEqual([]);
    for (const rateLabel of ["NaN tok/s", "Infinity tok/s", "-2 tok/s", "≈", "awaiting samples", ""]) {
      expect(composerChips({ streaming: true, rateLabel })).toEqual([]);
    }
  });

  test("uses the full model name in accessibility even when truncated on screen", () => {
    const full = "unusually-extended-model-series-version-12.7";
    const chips = composerChips({ model: full, streaming: false });
    expect(chips).toHaveLength(1);
    expect(chips[0]?.label.length).toBeLessThanOrEqual(18);
    expect(chips[0]?.accessibilityLabel).toBe("Model: " + full);
  });
});
