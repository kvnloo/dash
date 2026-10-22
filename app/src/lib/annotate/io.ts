// Annotation I/O on web: upload composed bytes and transcribe the tray mic.
import { uploadAttachment } from "../attachments";
import { arrayBuffer, transcribeRecording, type BridgeSettings } from "./io-core";
import type { ChatAttachment } from "../../../../shared/protocol";

export { transcribeRecording, type BridgeSettings };

export function uploadBytes(settings: BridgeSettings, name: string, mime: string, bytes: Uint8Array): Promise<ChatAttachment> {
  return uploadAttachment(settings, { uri: "", name, mime, size: bytes.byteLength, bytes: arrayBuffer(bytes) }, fetch);
}

export async function readRecording(uri: string): Promise<ArrayBuffer> {
  return await (await fetch(uri)).arrayBuffer();
}
