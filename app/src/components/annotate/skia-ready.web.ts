import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

// Metro copies the lockfile-pinned CanvasKit into the same-origin web export.
// Bootstrap and annotation must both work without contacting a third-party CDN.
const CANVASKIT = "/canvaskit.wasm";
let loading: Promise<void> | undefined;

async function prepareSkia(): Promise<void> {
  // ShimmerText loads CanvasKit during bootstrap, before annotation can be opened.
  // Only the loopback army probe re-fetches WASM so an aborted request can exercise
  // annotation's real skia-load error/retry path without breaking app bootstrap.
  if (typeof location !== "undefined" &&
      (location.hostname === "localhost" || location.hostname === "127.0.0.1") &&
      new URLSearchParams(location.search).get("inkWasmProbe") === "1") {
    const response = await fetch(CANVASKIT, { cache: "no-store" });
    if (!response.ok) throw new Error("CanvasKit probe HTTP " + response.status);
  }
  await LoadSkiaWeb({ locateFile: () => CANVASKIT });
}

export function loadSkia(): Promise<void> {
  loading ??= prepareSkia().catch(error => {
    // Failed attempts are never cached; Retry must be able to fetch again.
    loading = undefined;
    throw error;
  });
  return loading;
}
