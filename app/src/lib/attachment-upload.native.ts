// RN fetch cannot reliably read Android content:// providers. Expo File + expo/fetch
// uploads the native file itself, not an HTTP-like "File not found" response blob.
import { File } from "expo-file-system";
import { fetch } from "expo/fetch";
import { uploadAttachment, rejectReason, type PickedFile } from "./attachments";

export async function uploadPickedFile(settings: { address: string; token: string }, file: PickedFile) {
  const source = new File(file.uri);
  if (!source.exists || source.size === 0) {
    throw new Error("Could not read the selected file. Select it again from Files or Photos.");
  }
  const reason = rejectReason({ name: file.name, size: source.size });
  if (reason) throw new Error(reason);
  return uploadAttachment(settings, { ...file, bytes: await source.arrayBuffer() }, fetch);
}
