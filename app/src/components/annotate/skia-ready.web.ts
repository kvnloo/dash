import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

// CanvasKit's wasm is fetched on first use of annotation mode only. The version
// matches the canvaskit-wasm that @shopify/react-native-skia 2.6.2 depends on.
const CANVASKIT = "https://unpkg.com/canvaskit-wasm@0.41.0/bin/full";
let loading: Promise<void> | undefined;

export function loadSkia(): Promise<void> {
  loading ??= LoadSkiaWeb({ locateFile: (file: string) => `${CANVASKIT}/${file}` });
  return loading;
}
