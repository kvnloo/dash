import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { attachInkPersistence } from "../lib/annotate/ink-persistence";
import { annotate, setAnnotationStatus } from "./annotate";

const KEY = "dash.flowInk.v1";
// Keep write ordering across Fast Refresh / effect remount, not just within one mount.
declare global {
  var __dashInkWriteQueue: Promise<void> | undefined;
  var __dashInkUnmounted: Promise<void> | undefined;
}

export function connectAnnotationDraft() {
  const priorUnmount = globalThis.__dashInkUnmounted;
  const runtime = attachInkPersistence(annotate, {
    async read() {
      await priorUnmount;
      await globalThis.__dashInkWriteQueue;
      return AsyncStorage.getItem(KEY);
    },
    write(raw) {
      const write = (globalThis.__dashInkWriteQueue ?? Promise.resolve()).then(() => AsyncStorage.setItem(KEY, raw));
      globalThis.__dashInkWriteQueue = write.catch(() => {});
      return write;
    },
    onBackground(flush) {
      const subscription = AppState.addEventListener("change", state => { if (state !== "active") flush(); });
      return () => subscription.remove();
    },
    onError() { setAnnotationStatus("error", { error: "Ink is kept in memory, but could not be saved. Keep Dash open and retry." }); },
  });
  return { ...runtime, dispose() { globalThis.__dashInkUnmounted = runtime.dispose(); } };
}
