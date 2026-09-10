/** Collapsed zerOS pager CSS. oklch/color-mix kept for web; sRGB listed first so Android WebView still paints. */

export const GOLD_SRGB = "#d7b986";
export const GOLD_68 = "rgba(215, 185, 134, 0.68)";
export const GOLD_RIM = "rgb(230, 210, 178)";
export const GOLD_GLOW = "rgba(215, 185, 134, 0.25)";
export const DEV_NAV_96 = "rgba(12, 13, 11, 0.874)";

export const NAV_CHROME_HEIGHT = 60;
export const NAV_PAGER_WIDTH = 144;
export const NAV_PAGER_HEIGHT = 50;
export const NAV_PAGER_PAD = 3;
/** Same squircle as the gold pill — stadium 23px made the outline look rounder than the indicator. */
export const NAV_PAGER_RADIUS = 16;
export const NAV_PILL_RADIUS = 16;
/** Inner slot: (144 − 6) / 3. Native translateX uses this, not CSS %. */
export const NAV_SLOT_WIDTH = (NAV_PAGER_WIDTH - NAV_PAGER_PAD * 2) / 3;
export const NAV_PILL_HEIGHT = NAV_PAGER_HEIGHT - NAV_PAGER_PAD * 2;
export const PAGE_LAST = 2;
/** Dummy-page extent past 0 and PAGE_LAST. Pill can travel a fraction of a slot past the stadium. */
export const OVERSCROLL = 1;
export const PILL_TRAVEL = 0.55;

export const GOLDEN_NAV_CSS = `:root {
  --ink-2: #B4AFA3;
  --ink-3: #837F74;
  --gold: ${GOLD_SRGB};
  --gold: oklch(0.80 0.075 80);
  --gold-68: ${GOLD_68};
  --gold-rim: ${GOLD_RIM};
  --gold-glow: ${GOLD_GLOW};
  --hair-2: rgba(236,232,223,0.16);
  --dev-nav: rgba(12, 13, 11, 0.91);
  --dev-nav-96: ${DEV_NAV_96};
}
html, body {
  margin: 0;
  height: 100%;
  background: transparent;
  overflow: visible;
}
.dash-appnav, .dash-appnav * { box-sizing: border-box; }
.dash-appnav {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  padding: 15px 16px;
  overflow: visible;
}
.dev-mobile-immersive-toggle,
.dev-mobile-pager-toggle {
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--hair-2);
  border-radius: 50%;
  background: var(--dev-nav-96);
  background: color-mix(in srgb, var(--dev-nav) 96%, transparent);
  color: var(--ink-2);
  backdrop-filter: blur(18px) saturate(1.3);
  -webkit-backdrop-filter: blur(18px) saturate(1.3);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22);
  cursor: pointer;
}
.dev-mobile-immersive-toggle svg { width: 17px; height: 17px; }
.dev-mobile-pager-toggle svg { width: 15px; height: 15px; }
.dev-mobile-pager {
  position: relative;
  width: ${NAV_PAGER_WIDTH}px;
  height: 50px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: ${NAV_PAGER_PAD}px;
  border: 1px solid var(--hair-2);
  border-radius: ${NAV_PAGER_RADIUS}px;
  overflow: visible;
  background: var(--dev-nav-96);
  background: color-mix(in srgb, var(--dev-nav) 96%, transparent);
  box-shadow: 0 9px 28px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(18px) saturate(1.3);
  -webkit-backdrop-filter: blur(18px) saturate(1.3);
}
.dev-mobile-pager-indicator {
  position: absolute;
  z-index: 0;
  top: ${NAV_PAGER_PAD}px;
  bottom: ${NAV_PAGER_PAD}px;
  left: ${NAV_PAGER_PAD}px;
  width: calc((100% - ${NAV_PAGER_PAD * 2}px) / 3);
  border: 1px solid ${GOLD_RIM};
  border: 1px solid color-mix(in srgb, white 36%, var(--gold));
  border-radius: ${NAV_PILL_RADIUS}px;
  background: ${GOLD_68};
  background: color-mix(in srgb, var(--gold) 68%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.54),
    inset 0 -3px 8px rgba(111, 85, 36, 0.25),
    0 4px 10px ${GOLD_GLOW};
  pointer-events: none;
  transform: translate3d(0, 0, 0);
  transform-origin: 50% 50%;
  transition: none;
  will-change: transform;
}
.dev-mobile-pager > button[role="tab"] {
  position: relative;
  z-index: 1;
  min-width: 0;
  min-height: 44px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: ${NAV_PILL_RADIUS}px;
  background: transparent;
  color: transparent;
  cursor: pointer;
}
.dev-mobile-pager-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #837F74;
  pointer-events: none;
}
.dev-mobile-pager > button[role="tab"].is-active .dev-mobile-pager-dot {
  background: #211b10;
}
`;

const EXPAND_D =
  "M9 3H3v6M15 3h6v6M9 21H3v-6M21 15v6h-6M3 3l7 7M21 3l-7 7M3 21l7-7M21 21l-7-7";
export const EXPAND_PATH = EXPAND_D;

export const TAB_LABELS = ["Bots", "Chats", "Orchestra"] as const;

export function clampTab(tab: number): 0 | 1 | 2 {
  const n = Math.round(tab);
  if (n <= 0) return 0;
  if (n >= 2) return 2;
  return 1;
}

export function clampProgress(progress: number): number {
  "worklet";
  if (!Number.isFinite(progress)) return 0;
  if (progress < -OVERSCROLL) return -OVERSCROLL;
  if (progress > PAGE_LAST + OVERSCROLL) return PAGE_LAST + OVERSCROLL;
  return progress;
}

/** Snap to a real tab. Overscroll is only for the drag; settle is always 0/1/2. */
export function clampSettled(progress: number): number {
  "worklet";
  if (!Number.isFinite(progress)) return 0;
  if (progress <= 0) return 0;
  if (progress >= PAGE_LAST) return PAGE_LAST;
  return progress;
}

/** PagerView onPageScroll: progress is position + offset. Negative = pulling toward page -1. */
export function pageProgress(position: number, offset: number): number {
  return clampProgress(position + offset);
}

export function indicatorTransform(progress: number): string {
  return `translate3d(calc(${clampProgress(progress)} * 100%), 0, 0)`;
}

export function indicatorTranslateX(progress: number): number {
  "worklet";
  return clampProgress(progress) * NAV_SLOT_WIDTH;
}

/** Underdamped gel: visible overshoot, still settles in one swipe. */
export const PILL_MASS = 0.4;
export const PILL_STIFFNESS = 240;
export const PILL_DAMPING = 13;
export const PILL_STRETCH = 0.28;
export const PILL_STRETCH_CAP = 1.34;
export const PILL_VOLUME = 0.38;

export function pillStep(pos: number, vel: number, target: number, dt: number): { pos: number; vel: number } {
  "worklet";
  const step = dt < 0.033 ? dt : 0.033;
  if (step <= 0) return { pos, vel };
  const pull = pos - target;
  const absPull = pull < 0 ? -pull : pull;
  const absVel = vel < 0 ? -vel : vel;
  if (absPull < 0.0008 && absVel < 0.002) return { pos: target, vel: 0 };
  const acc = (-PILL_STIFFNESS * pull - PILL_DAMPING * vel) / PILL_MASS;
  const nextVel = vel + acc * step;
  let nextPos = pos + nextVel * step;
  if (nextPos < -PILL_TRAVEL) return { pos: -PILL_TRAVEL, vel: 0 };
  if (nextPos > PAGE_LAST + PILL_TRAVEL) return { pos: PAGE_LAST + PILL_TRAVEL, vel: 0 };
  return { pos: nextPos, vel: nextVel };
}

/** Stretch in travel, squash on Y so the gold keeps volume instead of looking like a flat scale. */
export function pillStretch(pos: number, target: number, vel: number): { scaleX: number; scaleY: number } {
  "worklet";
  const pull = target - pos;
  const absPull = pull < 0 ? -pull : pull;
  const speed = vel < 0 ? -vel : vel;
  const floor = target < 0 ? 0 : Math.floor(target);
  const frac = target - floor;
  const mid = Math.sin(frac * Math.PI);
  const extra = PILL_STRETCH * Math.min(1, absPull * 2.2 + speed * 0.22 + 0.45 * mid);
  const scaleX = 1 + extra > PILL_STRETCH_CAP ? PILL_STRETCH_CAP : 1 + extra;
  const scaleY = 1 / Math.pow(scaleX, PILL_VOLUME);
  return { scaleX, scaleY };
}

/** Same gel family as the pill, more mass — the page is larger so it accelerates less. */
export const PAGE_MASS = 1.15;
export const PAGE_STIFFNESS = 150;
export const PAGE_DAMPING = 17;
export const PAGE_STRETCH = 0.1;
export const PAGE_STRETCH_CAP = 1.12;
export const PAGE_VOLUME = 0.38;
/** Extra translate (px per page of follow lag). Transform only; PagerView still owns the swipe. */
export const PAGE_LAG_PX = 26;

export function pageStep(pos: number, vel: number, target: number, dt: number): { pos: number; vel: number } {
  "worklet";
  const step = dt < 0.033 ? dt : 0.033;
  if (step <= 0) return { pos, vel };
  const pull = pos - target;
  const absPull = pull < 0 ? -pull : pull;
  const absVel = vel < 0 ? -vel : vel;
  if (absPull < 0.0008 && absVel < 0.002) return { pos: target, vel: 0 };
  const acc = (-PAGE_STIFFNESS * pull - PAGE_DAMPING * vel) / PAGE_MASS;
  const nextVel = vel + acc * step;
  let nextPos = pos + nextVel * step;
  if (nextPos < -OVERSCROLL) return { pos: -OVERSCROLL, vel: 0 };
  if (nextPos > PAGE_LAST + OVERSCROLL) return { pos: PAGE_LAST + OVERSCROLL, vel: 0 };
  return { pos: nextPos, vel: nextVel };
}

export function pageStretch(pos: number, target: number, vel: number): { scaleX: number; scaleY: number } {
  "worklet";
  const pull = target - pos;
  const absPull = pull < 0 ? -pull : pull;
  const speed = vel < 0 ? -vel : vel;
  const floor = target < 0 ? 0 : Math.floor(target);
  const frac = target - floor;
  const mid = Math.sin(frac * Math.PI);
  const extra = PAGE_STRETCH * Math.min(1, absPull * 2.2 + speed * 0.22 + 0.45 * mid);
  const scaleX = 1 + extra > PAGE_STRETCH_CAP ? PAGE_STRETCH_CAP : 1 + extra;
  const scaleY = 1 / Math.pow(scaleX, PAGE_VOLUME);
  return { scaleX, scaleY };
}

/** Pager settle samples: translateX at from→to inclusive, `steps` intervals. */
export function indicatorFrames(from: number, to: number, steps: number): number[] {
  const frames: number[] = [];
  for (let i = 0; i <= steps; i++) {
    frames.push(indicatorTranslateX(from + ((to - from) * i) / steps));
  }
  return frames;
}

export function indicatorLeft(tab: number): string {
  return `calc(3px + ${clampProgress(tab)} * (100% - 6px) / 3)`;
}

export type NavMessage = { type: "tab"; index: 0 | 1 | 2 } | { type: "expand" } | { type: "menu" };

export function parseNavMessage(raw: string): NavMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || !("type" in value)) return null;
    const type = (value as { type: unknown }).type;
    if (type === "expand" || type === "menu") return { type };
    if (type === "tab" && "index" in value && typeof (value as { index: unknown }).index === "number") {
      const index = (value as { index: number }).index;
      if (index === 0 || index === 1 || index === 2) return { type: "tab", index };
    }
    return null;
  } catch {
    return null;
  }
}

function applyProgressJs(progress: number): string {
  const p = clampProgress(progress);
  const i = clampTab(p);
  const transform = indicatorTransform(p);
  return `var p=${p};var i=${i};var tabs=document.querySelectorAll('[role="tab"]');var ind=document.getElementById('indicator');if(!ind)return true;ind.style.transition='none';ind.style.transform='${transform}';for(var n=0;n<tabs.length;n++)tabs[n].classList.toggle('is-active',n===i);window.__dashProgress=p;`;
}

/** Web / probe helper. Native no longer injects this on swipe. */
export function navSetProgressScript(progress: number): string {
  return `(function(){${applyProgressJs(progress)}})(); true;`;
}

/** Settled-page helper — same transform path as scroll so tap and swipe cannot diverge. */
export function navSetTabScript(tab: number): string {
  return navSetProgressScript(clampTab(tab));
}

/** Standalone HTML document for the CSS probe. `tab` is 0/1/2. */
export function goldenNavHtml(tab: number): string {
  const t = clampTab(tab);
  const buttons = TAB_LABELS.map(
    (label, i) =>
      `<button type="button" role="tab" aria-label="${label}"${i === t ? ' class="is-active"' : ""}><span class="dev-mobile-pager-dot" aria-hidden="true"></span></button>`,
  ).join("");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  ${GOLDEN_NAV_CSS}
</style>
<body>
  <div class="dash-appnav">
    <button type="button" class="dev-mobile-immersive-toggle" aria-label="Expand" id="expand">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="${EXPAND_D}"/>
      </svg>
    </button>
    <nav class="dev-mobile-pager" aria-label="Primary mobile workspace">
      <span class="dev-mobile-pager-indicator" id="indicator" aria-hidden="true" style="transform:${indicatorTransform(t)}"></span>
      ${buttons}
    </nav>
    <button type="button" class="dev-mobile-pager-toggle" aria-label="Menu" id="menu">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6"/>
      </svg>
    </button>
  </div>
  <script>
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const indicator = document.getElementById('indicator');
    function post(msg) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
    function setProgress(p, fromNative) {
      var n = p < 0 ? 0 : p > 2 ? 2 : p;
      indicator.style.transition = 'none';
      indicator.style.transform = 'translate3d(calc(' + n + ' * 100%), 0, 0)';
      var i = Math.round(n);
      if (i < 0) i = 0;
      if (i > 2) i = 2;
      tabs.forEach((el, idx) => el.classList.toggle('is-active', idx === i));
      window.__dashProgress = n;
      if (!fromNative) post({ type: 'tab', index: i });
    }
    window.setProgress = (p) => setProgress(p, true);
    window.setTab = (i) => setProgress(i, true);
    setProgress(${t}, true);
    tabs.forEach((el, i) => el.addEventListener('click', () => post({ type: 'tab', index: i })));
    document.getElementById('expand').addEventListener('click', () => post({ type: 'expand' }));
    document.getElementById('menu').addEventListener('click', () => post({ type: 'menu' }));
  </script>
</body>
</html>`;
}
