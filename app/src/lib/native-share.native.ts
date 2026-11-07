import Constants, { ExecutionEnvironment } from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import { parseIncomingShare, type IncomingShare } from "./incoming-share";
interface ShareModule { consume(): Promise<string | null>; discard(id: string): Promise<void> }
function nativeShare() {
  return Platform.OS === "android" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
    ? requireOptionalNativeModule<ShareModule>("DashShareFiles") : null;
}
export async function consumeNativeShare(): Promise<IncomingShare | null> {
  const raw = await nativeShare()?.consume();
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  const parsed = parseIncomingShare(value);
  if (!parsed) throw new Error("The shared content could not be read safely. Share it again.");
  return parsed;
}
export async function discardNativeShare(id: string): Promise<void> { await nativeShare()?.discard(id); }
