// Host page for one kvnloo/ephemeral-ui card inside Dash's sandboxed WebView/iframe.
// Bundled by build.mjs with the kit's own modules at a pinned revision: the card that renders is the
// repo's card, not a re-implementation. The model supplies only {kind, app}; no model code runs here.
import { Run, quiet, rng } from "@eui/motion.js";
import { loadThemes, setTheme } from "@eui/themes.js";
import { loadApps, catalog } from "@eui/shell.js";
import { KINDS_A } from "@eui/kinds-a.js";
import { KINDS_B } from "@eui/kinds-b.js";
import { KINDS_C } from "@eui/kinds-c.js";
import { KINDS_3D } from "@eui/kinds-3d.js";
import { KINDS_E } from "@eui/kinds-e.js";
import { KINDS_P } from "@eui/kinds-p.js";
import { KINDS_F } from "@eui/kinds-f.js";
import { KINDS_T } from "@eui/kinds-t.js";
import { KINDS_I } from "@eui/kinds-i.js";
import { KINDS_INFRA } from "@eui/kinds-infra.js";

const KINDS = { ...KINDS_A, ...KINDS_B, ...KINDS_3D, ...KINDS_C, ...KINDS_E, ...KINDS_P, ...KINDS_F, ...KINDS_T, ...KINDS_I, ...KINDS_INFRA };

function post(message) {
  try {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
    else if (window.parent && window.parent !== window) window.parent.postMessage(message, "*");
  } catch { /* host gone */ }
}

async function boot() {
  const spec = window.__EUI_SPEC || {};
  const root = document.getElementById("eui-root");
  try {
    delete document.startViewTransition;
    await loadThemes();
    setTheme(spec.scheme === "light" ? "t3-light" : "t3-dark");
    await loadApps();
    const kind = KINDS[spec.kind];
    const app = catalog.byId[spec.app];
    if (!kind || !app || !kind.make) throw new Error("unknown card");
    const card = kind.make(app, rng(spec.app + spec.kind), undefined, {});
    root.replaceChildren(card.el);
    document.documentElement.dataset.euiReady = spec.kind;
    post({ type: "eui:ready", kind: spec.kind, app: spec.app });
    if (card.play) quiet(card.play(new Run()));
  } catch (error) {
    root.textContent = "This card could not be drawn.";
    root.setAttribute("role", "alert");
    document.documentElement.dataset.euiReady = "error";
    post({ type: "eui:error", kind: spec.kind, app: spec.app, reason: String(error && error.message || error).slice(0, 200) });
  }
}

// Hand every card intent (typed ids only) to the host; the host decides what reaches the agent.
document.addEventListener("eui:intent", (event) => post({ type: "eui:intent", detail: event.detail }));
let last = 0;
new ResizeObserver(() => {
  const height = Math.ceil(document.getElementById("eui-root").getBoundingClientRect().height) + 2;
  if (Math.abs(height - last) > 1) { last = height; post({ type: "eui:size", height }); }
}).observe(document.getElementById("eui-root"));
boot();
