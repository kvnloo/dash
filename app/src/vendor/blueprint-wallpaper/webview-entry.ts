/**
 * Entry of the page the native app runs in a WebView (bundled by
 * scripts/build-themed-assets.ts into player.generated.ts). The app injects
 * `window.__DASH_WALLPAPER__` with data-URI assets before this runs.
 */
import { mountLivingWallpaper } from "./mount";
import type { WallpaperAssets } from "./livingPlayer";

function post(message: Record<string, unknown>) {
  const bridge: unknown = Reflect.get(window, "ReactNativeWebView");
  if (!bridge || typeof bridge !== "object") return;
  const send: unknown = Reflect.get(bridge, "postMessage");
  if (typeof send === "function") send.call(bridge, JSON.stringify(message));
}
function readConfig(): { assets: WallpaperAssets; force: "webgl" | "poster" | null } | null {
  const raw: unknown = Reflect.get(window, "__DASH_WALLPAPER__");
  if (!raw || typeof raw !== "object") return null;
  const assets: unknown = Reflect.get(raw, "assets");
  if (!assets || typeof assets !== "object") return null;
  const pick = (key: string) => { const v: unknown = Reflect.get(assets, key); return typeof v === "string" ? v : null; };
  const base = pick("base"), masks = pick("masks"), flow = pick("flow"), depth = pick("depth");
  if (!base || !masks || !flow || !depth) return null;
  const force: unknown = Reflect.get(raw, "force");
  return { assets: { base, masks, flow, depth }, force: force === "webgl" || force === "poster" ? force : null };
}
const config = readConfig();
const host = document.getElementById("wallpaper");
if (!config || !host) post({ type: "fail", reason: "config" });
else {
  let reported = 0;
  mountLivingWallpaper(host, config.assets, {
    onTier: (tier, why) => post({ type: "tier", tier, why }),
    onReady: () => post({ type: "ready" }),
    onFps: fps => { const now = Date.now(); if (now - reported > 5000) { reported = now; post({ type: "fps", fps }); } },
    onFail: reason => post({ type: "fail", reason }),
  }, { force: config.force });
}
