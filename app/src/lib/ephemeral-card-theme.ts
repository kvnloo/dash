import type { CardStyle } from "../store/card-style";
import { colors, controlMin, glass, proofMono, radius } from "../theme";
import { glide } from "./glide-theme";
import type { ThemeMode } from "./theme-mode";

const sans = '"Hanken Grotesk", system-ui, sans-serif';
const mono = '"IBM Plex Mono", ui-monospace, monospace';
const dash = {
  ...glide.color.dark,
  bg: colors.bg, card: glass.fill, cardSolid: glass.fillRaised,
  popover: colors.surfaceRaised, muted: glass.quiet, accent: glass.quiet,
  fg: colors.text, mutedFg: colors.textMuted, border: glass.hair, input: glass.hair2,
  primary: colors.gold, primaryFg: colors.onAccent,
  success: colors.ok, successFg: colors.ok, info: colors.information,
  warning: colors.warn, danger: colors.danger, dangerFg: colors.danger,
  font: proofMono ? mono : sans, mono,
  radius: radius.card, shadow: "none", density: 1,
};

const brands: Readonly<Record<string, Partial<{ [Key in keyof typeof dash]: typeof dash[Key] extends string ? string : number }>>> = {
  gmail: {
    card: "#1f1f1f", cardSolid: "#1f1f1f", popover: "#2d2f31", muted: "#2d2f31",
    fg: "#e3e3e3", mutedFg: "#c4c7c5", border: "#444746", input: "#666a68",
    primary: "#a8c7fa", primaryFg: "#062e6f", radius: 20,
    font: '"Google Sans Text", Roboto, system-ui, sans-serif',
  },
  github: {
    card: "#0d1117", cardSolid: "#0d1117", popover: "#21262d", muted: "#161b22",
    fg: "#f0f6fc", mutedFg: "#9198a1", border: "#30363d", input: "#484f58",
    primary: "#58a6ff", primaryFg: "#0d1117", success: "#3fb950", successFg: "#3fb950", radius: 8,
    font: "system-ui, sans-serif",
  },
  stripe: {
    card: "#191d30", cardSolid: "#191d30", popover: "#282d46", muted: "#22263c",
    fg: "#f3f1ff", mutedFg: "#b9bfdb", border: "#3c4260", input: "#60688a",
    primary: "#b9a7ff", primaryFg: "#211448", radius: 12, font: "system-ui, sans-serif",
  },
  spotify: {
    card: "#121212", cardSolid: "#121212", popover: "#282828", muted: "#202020",
    fg: "#fff", mutedFg: "#b3b3b3", border: "#333", input: "#555",
    primary: "#1ed760", primaryFg: "#101410", radius: 12, font: "system-ui, sans-serif",
  },
};

export function ephemeralCardTheme(app: string, mode: ThemeMode, style: CardStyle) {
  const brand = style === "app" && !proofMono && Object.hasOwn(brands, app) ? brands[app] : undefined;
  const blueprint = mode === "blueprint" && !proofMono
    ? { card: "rgba(18, 24, 32, .78)", cardSolid: "rgba(18, 24, 32, .88)", border: "rgba(216, 225, 238, .20)" }
    : undefined;
  const palette = { ...dash, ...blueprint, ...brand };
  return {
    // Kit bootstraps with the OS scheme before the host selects t3-dark.
    data: { themes: ["t3-dark", "t3-light"].map(id => ({ ...palette, card: brand?.card ?? colors.surfaceRaised, id, scheme: "dark", host: glide.id, label: glide.name })) },
    css: `
      :root { color-scheme: dark; --h-card: ${palette.card} !important; --h-card-solid: ${palette.cardSolid} !important; }
      #eui-root { padding: 0; }
      #eui-root > .eu-card {
        --a: var(--h-primary) !important;
        --a-ink: ${palette.primaryFg} !important;
        width: 100%;
        background: ${palette.cardSolid};
        border-radius: ${palette.radius}px;
        box-shadow: none;
      }
      .eu-card .eu-h, .eu-card .eu-b, .eu-card .eu-f { padding-inline: 16px; }
      .eu-card .eu-b { font-size: 15px; overflow-wrap: anywhere; }
      .eu-card :is(.eu-list, .eu-grid, .eu-h > *, .eu-b > *, .eu-f > *) { min-width: 0; max-width: 100%; }
      .eu-card .eu-list li { font-size: 15px; }
      .eu-card :is(button, a.eu-btn, [role="option"], [role="button"], input:not([type="checkbox"], [type="radio"]), select) {
        min-height: ${controlMin}px;
      }
      .eu-card .player .pp { min-width: ${controlMin}px; }
      .eu-card .eu-ttl { min-width: ${controlMin}px; padding: 11px; }
      .eu-card .eu-f button { font-size: 14px; white-space: normal; }
      .eu-card :is(.eu-btn, .eu-chip) { border-radius: ${app === "github" && brand ? "6px" : "999px"}; }
      .eu-card .eu-btn:not(.hold) { touch-action: manipulation; }
      .eu-card .inbox li { gap: 12px; min-height: 68px; padding: 10px 0; margin: 0; border-radius: 0; }
      .eu-card[data-kind="inbox"] .eu-h { gap: 8px; }
      .eu-card[data-kind="inbox"] .eu-verb { white-space: normal; line-height: 1.25; }
      .eu-card .inbox .eu-av { width: 34px; height: 34px; font-size: 12px; }
      .eu-card .inbox .row1 { align-items: baseline; gap: 8px; font-size: 15px; }
      .eu-card .inbox .row1 b, .eu-card .inbox .subj { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .eu-card .inbox time { flex: none; font-size: 11px; }
      .eu-card .inbox .subj { font-size: 15px; line-height: 21px; }
      .eu-card .inbox .snip { font-size: 13px; line-height: 18px; }
      .eu-card .inbox li.unread::before { left: -9px; top: 20px; width: 5px; height: 5px; }
      .eu-card .inbox li.hit { background: transparent; }
      .eu-card .inbox mark { color: var(--a); background: transparent; font-weight: 650; }
      @media (pointer: coarse) {
        .eu-card :is(kbd, .eu-hint) { display: none; }
      }
      .eu-card .eu-ico:has(.mark) .mono { display: none; }
      .eu-card .eu-ico .mark { display: block; }
      ${brand && app === "spotify" ? `
        .eu-card .player .pp { background: var(--a); }
        .eu-card .player .pp.on i { background: var(--a-ink); }
        .eu-card .player .pp:not(.on) i:first-child { border-left-color: var(--a-ink); }
      ` : ""}
      ${brand && app === "gmail" ? `
        .eu-card .eu-h .eu-ico { background: transparent; color: #ea4335; box-shadow: none; }
        .eu-card .eu-h .eu-ico .mark { width: 82%; height: 82%; }
        .eu-card[data-kind="inbox"] .eu-h { background: var(--h-muted); margin: 10px 12px 6px; border-radius: 999px; }
        .eu-card[data-kind="inbox"] .eu-f > button:first-child { background: var(--a); color: var(--a-ink); border-color: transparent; }
        .eu-card[data-kind="inbox"] .eu-f > button.ghost { background: var(--h-muted); color: var(--h-fg); }
        .eu-card .inbox .eu-av { width: 40px; height: 40px; font-size: 14px; }
        .eu-card .inbox li { gap: 14px; }
        .eu-card .inbox mark { color: #ffe082; background: #5c4a00; border-radius: 3px; }
      ` : `
        .eu-card .eu-ico {
          --tile: color-mix(in srgb, var(--a) 12%, transparent) !important;
          --tile-ink: var(--a) !important;
        }
        .eu-card .inbox .eu-av {
          color: var(--h-fg);
          background: color-mix(in srgb, var(--a) 9%, var(--h-card-solid));
          border: 1px solid var(--h-border);
          box-shadow: none;
        }
        .eu-card .inbox li + li { border-top: 1px solid var(--h-border); }
        .eu-card[data-kind="inbox"] .eu-f > button:first-child { color: var(--a); background: color-mix(in srgb, var(--a) 8%, transparent); }
      `}
    `,
  };
}
