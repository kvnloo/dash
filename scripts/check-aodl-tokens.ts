import { createHash } from "node:crypto";
import { join } from "node:path";

const revision = "636f3883add07aa450f1ce37c0c749caf1fc32d8";
const upstream = `https://raw.githubusercontent.com/kvnloo/aodl/${revision}`;
const root = join(import.meta.dir, "..");

async function readUpstream(path: string) {
  const response = await fetch(`${upstream}/${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`AODL ${path} at ${revision}: HTTP ${response.status}`);
  return response;
}

function sha256(bytes: ArrayBuffer) {
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

// AODL ships OKLCH; Dash ships rounded 8-bit sRGB for React Native.
function oklchToHex(value: string) {
  const match = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/.exec(value);
  if (!match) throw new Error(`Unsupported AODL colour: ${value}`);
  const lightness = Number(match[1]);
  const chroma = Number(match[2]);
  const radians = Number(match[3]) * Math.PI / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  return "#" + rgb.map((channel) => {
    const clamped = Math.min(1, Math.max(0, channel));
    const srgb = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(255 * srgb).toString(16).padStart(2, "0");
  }).join("");
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s/g, "").replace(/(^|[,\s(])0?\.(\d*?[1-9])0*\b/g, "$1.$2");
}

async function main() {
  // Import the actual default exports, never Proof Mono or source-code comments.
  delete process.env.EXPO_PUBLIC_ZEROS_THEME;
  const { colors, fonts } = await import("../app/src/theme");
  const [visual, css, localVisual, design] = await Promise.all([
    readUpstream("encodings/visual.json"),
    readUpstream("language/src/theme.css").then((response) => response.text()),
    Bun.file(join(root, "app/src/catalog/encodings/visual.json")).arrayBuffer(),
    Bun.file(join(root, "DESIGN.md")).text(),
  ]);
  const failures: string[] = [];
  function compare(label: string, actual: string | undefined, expected: string, simplify = (value: string) => value) {
    if (actual === undefined || simplify(actual) !== simplify(expected)) {
      failures.push(`${label}: expected ${expected}; got ${actual ?? "(missing)"}`);
    }
  }

  const upstreamHash = sha256(await visual.arrayBuffer());
  compare("visual.json sha256", sha256(localVisual), upstreamHash);

  const cssRoot = /^\s*:root\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
  function token(name: string) {
    const value = new RegExp(`^\\s*--${name}:\\s*([^;]+);`, "m").exec(cssRoot)?.[1]?.trim();
    if (!value) throw new Error(`Missing AODL token --${name}`);
    return value;
  }
  const directColors = {
    ink: colors.text, "ink-2": colors.textMuted, "ink-3": colors.textTertiary,
    "ink-4": colors.textFaint, "dm-page": colors.bg, hair: colors.hair, "hair-2": colors.hair2,
  };
  for (const [name, actual] of Object.entries(directColors)) {
    compare(`AODL --${name}`, actual, token(name), normalize);
  }
  compare("AODL --gold (sRGB)", colors.accent, oklchToHex(token("gold")), normalize);
  compare("AODL --green (sRGB)", colors.ok, oklchToHex(token("green")), normalize);
  const fontFaces = [
    { name: "serif", actual: fonts.editorial, face: "500Medium" },
    { name: "sans", actual: fonts.body, face: "400Regular" },
    { name: "sans", actual: fonts.semibold, face: "600SemiBold" },
  ];
  for (const { name, actual, face } of fontFaces) {
    // React Native uses registered face names rather than CSS fallback stacks.
    const family = /^"([^"]+)"/.exec(token(name))?.[1]?.replace(/\s/g, "");
    if (!family) throw new Error(`Unsupported AODL font stack --${name}`);
    compare(`AODL --${name} (${face})`, actual, `${family}_${face}`);
  }

  // The DESIGN.md colors block is a flat map of double-quoted string scalars.
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(design)?.[1];
  const block = /^colors:\r?\n((?: +[^\r\n]+\r?\n)+)/m.exec(frontmatter ?? "")?.[1];
  if (!block) throw new Error("Missing DESIGN.md frontmatter colors block");
  const documented = new Map<string, string>();
  for (const line of block.trimEnd().split(/\r?\n/)) {
    const [, key, value] = /^  (\w+): "([^"]+)"$/.exec(line) ?? [];
    if (!key || value === undefined || documented.has(key)) throw new Error(`Invalid DESIGN.md color line: ${line}`);
    documented.set(key, value);
  }
  for (const [key, actual] of Object.entries(colors)) {
    compare(`DESIGN.md colors.${key}`, documented.get(key), actual, normalize);
    documented.delete(key);
  }
  for (const key of documented.keys()) failures.push(`DESIGN.md colors.${key}: not exported by theme.ts`);

  if (failures.length) throw new Error(failures.join("\n"));
  console.log(`AODL ${revision}: visual.json sha256 ${upstreamHash}; 11 tokens match; DESIGN.md matches all ${Object.keys(colors).length} Living Night colors.`);
}

main().catch((error: unknown) => {
  console.error(`check-aodl-tokens: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
