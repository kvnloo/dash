// Dash's design language (app/src/theme.ts, DESIGN.md) for the Tern pane: Living Night canvas,
// cream ink, gold only for the selection, status hues only for status. Motion follows Dash's
// timing (enter 240 ms, settle easing); a changed item glows once and reduced motion drops it.
import { css, type Palette } from '@stencil-hq/tern'

/** Living Night (app/src/theme.ts `night`). */
export const NIGHT = {
  bg: '#0c0c0a',
  raised: '#151611',
  text: '#ECE8DF',
  muted: '#B4AFA3',
  tertiary: '#837F74',
  faint: '#5e5b52',
  gold: '#d7b986',
  goldStrong: '#eccd8c',
  ok: '#98cf8b',
  info: '#81b9da',
  warn: '#e7a875',
  danger: '#e37f65',
  hair: 'rgba(236,232,223,.10)',
  hair2: 'rgba(236,232,223,.16)',
  quiet: 'rgba(236,232,223,.06)'
} as const

export const PALETTE: Palette = {
  dark: {
    accent: NIGHT.gold,
    text: NIGHT.text,
    muted: NIGHT.muted,
    dim: NIGHT.tertiary,
    success: NIGHT.ok,
    warning: NIGHT.warn,
    error: NIGHT.danger,
    info: NIGHT.info,
    mdLink: NIGHT.info,
    selectedBg: NIGHT.raised
  },
  name: { dark: 'dash-living-night' }
}

export const STYLES = css`
  /* Tern scopes a program's sheet inside its region, so the root is our own col. */
  [data-role~='dash.root'] {
    background: ${NIGHT.bg};
    color: ${NIGHT.text};
    min-height: 100%;
    padding: 12px 14px 16px;
    border-radius: 10px;
  }
  [data-role~='dash.root'], [data-role~='dash.root'] :is(.sf-text, .sf-kv, .sf-badge, .sf-elapsed):not([data-role~='dash.brand'], [data-role~='dash.pri'], [data-role~='dash.pct']) {
    font-family: 'Hanken Grotesk', Inter, system-ui, sans-serif !important;
  }
  [data-role~='dash.root'] .sf-text { font-size: 13px; line-height: 19px; }

  [data-role~='dash.top'] { padding-bottom: 8px; margin-bottom: 4px; box-shadow: inset 0 -1px 0 ${NIGHT.hair}; }
  [data-role~='dash.brand'] { font: 500 22px/28px 'Cormorant Garamond', Georgia, serif !important; color: ${NIGHT.text}; }
  [data-role~='dash.overall'] { color: ${NIGHT.muted}; font-variant-numeric: tabular-nums; }
  [data-role~='dash.hint'], [data-role~='dash.age'] { color: ${NIGHT.tertiary}; font-size: 12px !important; font-variant-numeric: tabular-nums; }

  [data-role~='dash.head'] { margin: 14px 0 6px; }
  [data-role~='dash.label'] { font: 600 12px/16px 'Hanken Grotesk', Inter, system-ui, sans-serif !important; letter-spacing: .4px; color: ${NIGHT.muted}; }
  [data-role~='dash.count'] { font-size: 12px !important; color: ${NIGHT.tertiary}; font-variant-numeric: tabular-nums; }

  /* Rows: quiet until selected. Gold marks only the selection (a 2px rail), never a wash. */
  [data-role~='dash.item'] {
    padding: 6px 10px;
    border-radius: 8px;
    box-shadow: inset 2px 0 0 transparent;
    transition: background 240ms cubic-bezier(.2,.75,.2,1), box-shadow 240ms cubic-bezier(.2,.75,.2,1);
    cursor: default;
  }
  [data-role~='dash.item']:hover { background: ${NIGHT.quiet}; }
  [data-role~='dash.item'][data-role~='sel'] { background: ${NIGHT.raised}; box-shadow: inset 2px 0 0 ${NIGHT.gold}; }
  [data-role~='dash.title'] { color: ${NIGHT.text}; }

  /* Waiting on you: the one place with weight. A warm hairline, the action in cream. */
  [data-role~='dash.you'] { border: 1px solid ${NIGHT.hair2}; background: rgba(231,168,117,.05); margin-bottom: 2px; }
  [data-role~='dash.you'] [data-role~='dash.title'] { font-weight: 600; }
  [data-role~='dash.next'] { color: ${NIGHT.muted}; margin-top: 2px; }

  [data-role~='dash.livedot'] { color: ${NIGHT.ok}; font-size: 9px !important; opacity: .9; }

  [data-role~='dash.pri'] { width: 2.4ch; flex: none; font: 600 11px/20px 'IBM Plex Mono', 'Berkeley Mono', monospace !important; color: ${NIGHT.tertiary}; }
  [data-role~='dash.row'] .sf-meter, [data-role~='dash.bar'] { flex: none; width: 56px; }
  [data-role~='dash.pct'] { flex: none; width: 4ch; text-align: right; font: 400 12px/20px 'IBM Plex Mono', 'Berkeley Mono', monospace !important; color: ${NIGHT.muted}; font-variant-numeric: tabular-nums; }
  [data-role~='dash.done'] [data-role~='dash.title'] { color: ${NIGHT.tertiary}; }

  [data-role~='dash.more'] { margin: 6px 0 4px 3ch; font-size: 13px !important; color: ${NIGHT.muted}; }
  [data-role~='dash.error'] { margin: 8px 0; color: ${NIGHT.danger}; }
  [data-role~='dash.keys'] { margin-top: 16px; color: ${NIGHT.faint}; font-size: 12px !important; }

  /* A changed item glows once, then settles. */
  @keyframes dash-changed {
    0% { background: rgba(215,185,134,.22); }
    100% { background: transparent; }
  }
  [data-role~='dash.item'][data-role~='changed'] { animation: dash-changed 1.6s cubic-bezier(.2,.75,.2,1) 1; }
  @media (prefers-reduced-motion: reduce) {
    [data-role~='dash.item'] { transition: none; }
    [data-role~='dash.item'][data-role~='changed'] { animation: none; box-shadow: inset 2px 0 0 ${NIGHT.tertiary}; }
  }
`
