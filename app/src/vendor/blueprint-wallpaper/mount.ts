/**
 * DOM driver for the Living Ruins player, adapted from blueprint's
 * website/src/components/wallpaper/LivingWallpaper.tsx (2817939) for Dash:
 * no page scroll drift, Explore, 8K inspection or tilt; a host element instead of the page.
 * Shared by the web build and the native WebView page. See README.md (GPL-3.0-only).
 */
import { LivingPlayer, type WallpaperAssets, type WallpaperQuality } from "./livingPlayer";
import { probeWebGL } from "./capability";

export type WallpaperTier = "webgl" | "poster";
export type WallpaperEvents = {
  onTier?: (tier: WallpaperTier, why: string) => void;
  onReady?: () => void;
  onFps?: (fps: number) => void;
  onFail?: (reason: "error" | "slow") => void;
};

/** Poster when motion is reduced, Save-Data is on, or WebGL is missing or a CPU rasteriser. */
export async function detectTier(force: WallpaperTier | null): Promise<{ tier: WallpaperTier; why: string }> {
  if (force) return { tier: force, why: "forced" };
  if (typeof window === "undefined") return { tier: "poster", why: "no-window" };
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return { tier: "poster", why: "reduced-motion" };
  const gl = await probeWebGL();
  return gl === "hardware" ? { tier: "webgl", why: "hardware" } : { tier: "poster", why: `webgl-${gl}` };
}

/** Mount the player in `host` (a positioned element). Returns the cleanup. */
export function mountLivingWallpaper(host: HTMLElement, assets: WallpaperAssets, events: WallpaperEvents = {}, opts: { force?: WallpaperTier | null; quality?: WallpaperQuality } = {}): () => void {
  let cancelled = false;
  let player: LivingPlayer | null = null;
  const cleanups: (() => void)[] = [];
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity 1.2s ease-out";
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.testid = "blueprint-wallpaper-live";
  canvas.dataset.ready = "0";
  const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
    window.addEventListener(type, fn, { passive: true });
    cleanups.push(() => window.removeEventListener(type, fn));
  };
  const fail = (reason: "error" | "slow") => {
    if (cancelled) return;
    cancelled = true;
    canvas.style.opacity = "0";
    canvas.dataset.ready = "0";
    events.onFail?.(reason);
  };
  void (async () => {
    const { tier, why } = await detectTier(opts.force ?? null);
    if (cancelled) return;
    host.dataset.tier = tier;
    events.onTier?.(tier, why);
    if (tier !== "webgl") return;
    host.appendChild(canvas);
    try {
      player = new LivingPlayer({
        canvas, assets, quality: opts.quality ?? "low", adaptive: opts.force !== "webgl",
        onContextLost: () => { canvas.style.transition = "none"; canvas.style.opacity = "0"; canvas.dataset.ready = "0"; },
        onReady: () => {
          if (cancelled) return;
          canvas.style.transition = "opacity 1.2s ease-out";
          canvas.style.opacity = "1";
          canvas.dataset.ready = "1";
          events.onReady?.();
        },
        onFps: fps => { canvas.dataset.fps = fps.toFixed(1); events.onFps?.(fps); },
        onGiveUp: () => fail("slow"),
      });
      await player.init();
      if (cancelled) { player.dispose(); return; }
      const p = player;
      const ro = new ResizeObserver(() => p.resize());
      ro.observe(canvas);
      cleanups.push(() => ro.disconnect());
      const visibility = () => p.setVisible(!document.hidden);
      document.addEventListener("visibilitychange", visibility);
      cleanups.push(() => document.removeEventListener("visibilitychange", visibility));
      // Pointer parallax and ripples on the water, as on the blueprint site.
      let last = { x: -1, y: -1, t: 0 };
      on("pointermove", e => {
        const sx = e.clientX / window.innerWidth;
        const sy = e.clientY / window.innerHeight;
        p.setPointer(sx * 2 - 1, sy * 2 - 1);
        const now = performance.now();
        if (Math.hypot(sx - last.x, sy - last.y) > 0.035 && now - last.t > 140) {
          p.addRipple(sx, sy, 0.45);
          last = { x: sx, y: sy, t: now };
        }
      });
      on("pointerdown", e => p.addRipple(e.clientX / window.innerWidth, e.clientY / window.innerHeight, 1));
      p.start();
    } catch (error) {
      console.warn("[wallpaper] WebGL player unavailable, keeping the poster:", error);
      player?.dispose();
      fail("error");
    }
  })();
  return () => {
    cancelled = true;
    for (const c of cleanups) c();
    player?.dispose();
    canvas.remove();
  };
}
