// Vendored from kvnloo/blueprint 2817939 (GPL-3.0-only). See README.md.
/**
 * One-shot capability gate for the Living Ruins wallpaper (ported from the
 * .files player). The poster is always painted first by index.html; this only
 * decides whether to enhance it with the WebGL player.
 */
export type WallpaperTier = 'webgl' | 'poster';

export type CapabilityOptions = {
  /** Force a tier (tests / debugging). */
  forceTier?: WallpaperTier | null;
};

type NavigatorExtras = Navigator & {
  connection?: { saveData?: boolean; downlink?: number; effectiveType?: string };
  deviceMemory?: number;
};

/** `?wallpaper=poster|webgl` overrides detection (used by tests and for debugging). */
export function tierFromUrl(search = typeof location !== 'undefined' ? location.search : ''): WallpaperTier | null {
  const v = new URLSearchParams(search).get('wallpaper');
  return v === 'poster' || v === 'webgl' ? v : null;
}

export async function detectWallpaperTier(opts: CapabilityOptions = {}): Promise<WallpaperTier> {
  if (typeof window === 'undefined') return 'poster';
  if (opts.forceTier) return opts.forceTier;

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return 'poster';

  const nav = navigator as NavigatorExtras;
  // Save-Data opts out. Bandwidth estimates do not: the player reuses the poster
  // plate already in cache and adds ~0.4 MB of maps, while Chrome's downlink
  // estimate dips on any slow first fetch and used to pin the poster for the session.
  if (nav.connection?.saveData) return 'poster';
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 && nav.deviceMemory <= 2) return 'poster';

  // No WebGL, or a CPU rasteriser (SwiftShader, llvmpipe, WARP) that would starve the page.
  if (await probeWebGL() !== 'hardware') return 'poster';
  return 'webgl';
}

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

type WebGLCapability = 'none' | 'software' | 'hardware';
let probeResult: Promise<WebGLCapability> | undefined;

/** Share both pending and resolved results for this page session. Never probe during mount. */
export function probeWebGL(): Promise<WebGLCapability> {
  if (typeof window === 'undefined') return Promise.resolve('none');
  return probeResult ??= new Promise((resolve) => {
    const run = () => resolve(probeNow());
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 2000 });
    } else {
      setTimeout(run, 1000);
    }
  });
}

function probeNow(): WebGLCapability {
  let gl: WebGLRenderingContext | null = null;
  try {
    const c = document.createElement('canvas');
    gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'none';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';

    return SOFTWARE_GL.test(renderer) ? 'software' : 'hardware';
  } catch {
    return 'none';
  } finally {
    // Release even when renderer inspection fails.
    try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* driver unavailable */ }
  }
}

export async function hasWebGL(): Promise<boolean> {
  return await probeWebGL() !== 'none';
}
