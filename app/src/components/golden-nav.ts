/** Exact CSS from golden-nav-relay / nav-probe.html. Used by web AppNav and native WebView. */

export const GOLDEN_NAV_CSS = `:root {
  --ink-2: #B4AFA3;
  --ink-3: #837F74;
  --gold: oklch(0.80 0.075 80);
  --hair-2: rgba(236,232,223,0.16);
  --dev-nav: rgba(12, 13, 11, 0.91);
}
.dash-appnav, .dash-appnav * { box-sizing: border-box; }
.dash-appnav {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 60px;
  gap: 8px;
  padding: 8px 10px;
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
  background: color-mix(in srgb, var(--dev-nav) 96%, transparent);
  color: var(--ink-2);
  backdrop-filter: blur(18px) saturate(1.3);
  -webkit-backdrop-filter: blur(18px) saturate(1.3);
  box-shadow: 0 8px 22px color-mix(in srgb, #000 22%, transparent);
  cursor: pointer;
}
.dev-mobile-immersive-toggle svg { width: 17px; height: 17px; }
.dev-mobile-pager-toggle svg { width: 15px; height: 15px; }
.dev-mobile-pager {
  position: relative;
  width: 144px;
  height: 50px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: 3px;
  border: 1px solid var(--hair-2);
  border-radius: 23px;
  background: color-mix(in srgb, var(--dev-nav) 96%, transparent);
  box-shadow: 0 9px 28px color-mix(in srgb, #000 28%, transparent);
  backdrop-filter: blur(18px) saturate(1.3);
  -webkit-backdrop-filter: blur(18px) saturate(1.3);
}
.dev-mobile-pager-indicator {
  position: absolute;
  z-index: 0;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc((100% - 6px) / 3);
  border: 1px solid color-mix(in srgb, white 36%, var(--gold));
  border-radius: 16px;
  background: color-mix(in srgb, var(--gold) 68%, transparent);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, white 54%, transparent),
    inset 0 -3px 8px color-mix(in srgb, #6f5524 25%, transparent),
    0 8px 18px color-mix(in srgb, var(--gold) 25%, transparent);
  backdrop-filter: blur(12px) saturate(1.35);
  -webkit-backdrop-filter: blur(12px) saturate(1.35);
  pointer-events: none;
  transition: left 220ms cubic-bezier(.2,.75,.2,1);
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
  border-radius: 16px;
  background: transparent;
  color: transparent;
  cursor: pointer;
}
.dev-mobile-pager > button[role="tab"]::after {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--ink-3);
  content: "";
}
.dev-mobile-pager > button[role="tab"].is-active::after { background: #211b10; }
`;

const EXPAND_D =
  "M9 3H3v6M15 3h6v6M9 21H3v-6M21 15v6h-6M3 3l7 7M21 3l-7 7M3 21l7-7M21 21l-7-7";

/** Standalone HTML document for a native WebView. `tab` is 0/1/2. */
export function goldenNavHtml(tab: number): string {
  const t = tab === 0 || tab === 2 ? tab : 1;
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; height: 100%; background: transparent; }
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
      <span class="dev-mobile-pager-indicator" id="indicator" aria-hidden="true"></span>
      <button type="button" role="tab" aria-label="Bots"></button>
      <button type="button" role="tab" aria-label="Chats"></button>
      <button type="button" role="tab" aria-label="Orchestra"></button>
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
    function setTab(i, fromNative) {
      tabs.forEach((el, n) => el.classList.toggle('is-active', n === i));
      indicator.style.left = 'calc(3px + ' + i + ' * (100% - 6px) / 3)';
      if (!fromNative) post({ type: 'tab', index: i });
    }
    window.setTab = (i) => setTab(i, true);
    setTab(${t}, true);
    tabs.forEach((el, i) => el.addEventListener('click', () => setTab(i, false)));
    document.getElementById('expand').addEventListener('click', () => post({ type: 'expand' }));
    document.getElementById('menu').addEventListener('click', () => post({ type: 'menu' }));
  </script>
</body>
</html>`;
}

export const EXPAND_PATH = EXPAND_D;
