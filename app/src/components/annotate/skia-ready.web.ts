import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

// Metro copies the lockfile-pinned CanvasKit into the same-origin web export.
// Bootstrap and annotation must both work without contacting a third-party CDN.
const CANVASKIT = "/canvaskit.wasm";
let loading: Promise<void> | undefined;

/**
 * Loopback-only army probe (?inkWasmProbe=1): every loadSkia() call re-fetches the WASM first, so a
 * request aborted after pairing reaches annotation's real skia-load error and Retry path. Without
 * the probe, ShimmerText's bootstrap load is cached and a later abort could never be observed.
 */
function readWasmProbe(): boolean {
  return typeof location !== "undefined" &&
    (location.hostname === "localhost" || location.hostname === "127.0.0.1") &&
    new URLSearchParams(location.search).get("inkWasmProbe") === "1";
}
// Read once at load: navigation later rewrites the URL and drops the query string.
const wasmProbe = readWasmProbe();

export function loadSkia(): Promise<void> {
  loading ??= LoadSkiaWeb({ locateFile: () => CANVASKIT }).catch(error => {
    // Failed attempts are never cached; Retry must be able to fetch again.
    loading = undefined;
    throw error;
  });
  if (!wasmProbe) return loading;
  const ready = loading;
  return fetch(CANVASKIT, { cache: "no-store" }).then(response => {
    if (!response.ok) throw new Error("CanvasKit probe HTTP " + response.status);
    return ready;
  });
}
