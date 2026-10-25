// Annotation I/O on Android/iOS: Expo's fetch sends ArrayBuffers natively, and
// recordings are read through Expo File (RN fetch cannot read file:// reliably).
import { File } from "expo-file-system";
import { fetch } from "expo/fetch";
import { uploadAttachment } from "../attachments";
import { arrayBuffer, transcribeRecording as transcribeWith, type BridgeSettings } from "./io-core";
import type { ChatAttachment } from "../../../../shared/protocol";

export type { BridgeSettings };

export function uploadBytes(settings: BridgeSettings, name: string, mime: string, bytes: Uint8Array): Promise<ChatAttachment> {
  return uploadAttachment(settings, { uri: "", name, mime, size: bytes.byteLength, bytes: arrayBuffer(bytes) }, fetch);
}

export async function readRecording(uri: string): Promise<ArrayBuffer> {
  return await new File(uri).arrayBuffer();
}

export function transcribeRecording(settings: BridgeSettings, audio: ArrayBuffer): Promise<string> {
  return transcribeWith(settings, audio, globalThis.fetch);
}
