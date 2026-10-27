import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

// Metro copies the lockfile-pinned CanvasKit into the same-origin web export.
// Bootstrap and annotation must both work without contacting a third-party CDN.
const CANVASKIT = "/canvaskit.wasm";
let loading: Promise<void> | undefined;

export function loadSkia(): Promise<void> {
  loading ??= LoadSkiaWeb({ locateFile: () => CANVASKIT });
  return loading;
}
