import * as FileSystem from "expo-file-system/legacy";
import type { ConversationFiles } from "./conversation-persistence";
import { CACHE_ENTRY_BYTES } from "./conversation-persistence";

const roots = {
  durable: FileSystem.documentDirectory ? `${FileSystem.documentDirectory}dash-conversations-v2/` : null,
  cache: FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}dash-history-v1/` : null,
};
async function directory(area: "durable" | "cache"): Promise<string> {
  const root = roots[area];
  if (!root) throw new Error("Conversation storage is unavailable");
  await FileSystem.makeDirectoryAsync(root, { intermediates: true });
  return root;
}
function safeName(name: string): boolean { return !name.includes("/") && !name.includes("\\") && name.endsWith(".json"); }
export const conversationFiles: ConversationFiles = {
  async list(area) {
    const root = await directory(area);
    return (await FileSystem.readDirectoryAsync(root)).filter(safeName);
  },
  async read(area, name) {
    if (!safeName(name)) return null;
    const path = `${await directory(area)}${name}`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists || info.isDirectory || (area === "cache" && info.size > CACHE_ENTRY_BYTES)) return null;
    return FileSystem.readAsStringAsync(path);
  },
  async write(area, name, value) {
    if (!safeName(name)) throw new Error("Invalid conversation filename");
    const path = `${await directory(area)}${name}`;
    await FileSystem.writeAsStringAsync(`${path}.tmp`, value);
    await FileSystem.moveAsync({ from: `${path}.tmp`, to: path });
  },
  async remove(area, name) {
    if (safeName(name)) await FileSystem.deleteAsync(`${await directory(area)}${name}`, { idempotent: true });
  },
};
