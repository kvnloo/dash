// Host page for one kvnloo/ephemeral-ui card inside Dash's sandboxed WebView/iframe.
// Bundled by build.mjs with the kit's own modules at a pinned revision: the card that renders is the
// repo's card, not a re-implementation. The model supplies only {kind, app}; no model code runs here.
import { Run, quiet, rng } from "@eui/motion.js";
import { loadThemes, setTheme } from "@eui/themes.js";
import { loadApps, catalog } from "@eui/shell.js";
import { KINDS, HOST_APP_NAMES } from "./registry.js";

function post(message) {
  try {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
    else if (window.parent && window.parent !== window) window.parent.postMessage(message, "*");
  } catch { /* host gone */ }
}

const appOf = (id) => catalog.byId[id] ?? (Object.hasOwn(HOST_APP_NAMES, id) ? { id, name: HOST_APP_NAMES[id], hex: null, cat: "agents", kinds: [] } : null);
// A catalog fixture mounts the way kvnloo/ephemeral-ui tools/card-catalog.mjs mounts it: its own seed and input,
// the clock frozen at catalog.generatedAt, and an app the catalog does not list drawn as { id, name: id, hex: null }.
const fixtureAppOf = (id) => catalog.byId[id] ?? { id, name: id, hex: null };
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const propsOf = (spec) => JSON.stringify(sortKeys(JSON.parse(JSON.stringify(spec ?? null))));

async function frozenAt(at, run) {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return run();
  const RealDate = Date;
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [ms])); } static now() { return ms; } };
  try { return await run(); } finally { globalThis.Date = RealDate; }
}

async function boot() {
  const spec = window.__EUI_SPEC || {};
  const fixture = spec.fixture && typeof spec.fixture === "object" ? spec.fixture : null;
  const root = document.getElementById("eui-root");
  try {
    delete document.startViewTransition;
    await loadThemes();
    setTheme(spec.scheme === "light" ? "t3-light" : "t3-dark");
    await loadApps();
    const kind = Object.hasOwn(KINDS, spec.kind) ? KINDS[spec.kind] : null;
    const app = fixture ? fixtureAppOf(spec.app) : appOf(spec.app);
    if (!kind || !app || !kind.make) throw new Error("unknown card");
    // No fixture: every kind draws the kit's sample data. Fleet and intel-suite draw theirs only on demo.
    const card = fixture
      ? await frozenAt(fixture.at, async () => { const c = kind.make(app, rng(String(fixture.seed)), fixture.input === undefined ? undefined : structuredClone(fixture.input)); await c.done; return c; })
      : kind.make(app, rng(spec.app + spec.kind), undefined, { demo: true });
    root.replaceChildren(card.el);
    await card.done;
    document.documentElement.dataset.euiReady = spec.kind;
    post({ type: "eui:ready", kind: spec.kind, app: spec.app, props: propsOf(card.spec) });
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
