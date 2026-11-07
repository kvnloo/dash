import * as Clipboard from "expo-clipboard";
import { Platform } from "react-native";
import { clipboardPng } from "./clipboard-paste";
import { rejectReason, type PickedFile } from "./attachments";

let sequence = 0;
/** Native-only: no clipboard permissions or filesystem access on web. */
export async function clipboardImageFile(): Promise<PickedFile | null> {
  if (Platform.OS === "web" || !await Clipboard.hasImageAsync()) return null;
  const image = await Clipboard.getImageAsync({ format: "png" });
  if (!image) return null;
  const payload = clipboardPng(image.data);
  if (!payload) throw new Error("Could not read the clipboard image as PNG.");
  const name = `paste-${Date.now()}-${++sequence}.png`;
  const reason = rejectReason({ name, size: payload.size });
  if (reason) throw new Error(reason);
  const { File, Paths } = require("expo-file-system") as typeof import("expo-file-system");
  const file = new File(Paths.cache, name);
  try {
    file.create();
    file.write(payload.base64, { encoding: "base64" });
    return { uri: file.uri, name, mime: "image/png", size: file.size };
  } catch (error) {
    if (file.exists) file.delete();
    throw error;
  }
}
