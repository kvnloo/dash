import { uploadAttachment, type PickedFile } from "./attachments";

export function uploadPickedFile(settings: { address: string; token: string }, file: PickedFile) {
  return uploadAttachment(settings, file, fetch);
}
