import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import type { NoticeMode } from "../../../shared/protocol";

interface WorkerModeModule {
  isWorkerMode(): boolean;
  addListener(event: "workerModeChanged", changed: () => void): { remove(): void };
}

const native = Platform.OS === "android" ? requireOptionalNativeModule<WorkerModeModule>("DashWorkerMode") : null;

// Read the shared native preference at the point of delivery, not a cached JS
// event. A shade tap can happen while the JavaScript runtime is suspended.
export function nativeNoticeMode(): NoticeMode | undefined {
  return native ? (native.isWorkerMode() ? "worker" : "me") : undefined;
}

export function subscribeToWorkerMode(changed: () => void): () => void {
  const sub = native?.addListener("workerModeChanged", changed);
  return () => sub?.remove();
}
