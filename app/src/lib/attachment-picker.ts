// Thin wrappers over the Expo SDK pickers (Expo Go safe). Everything testable lives in
// attachments.ts; this file only maps picker results into PickedFile.
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { nameFromUri, type PickedFile } from "./attachments";

export async function pickFiles(limit: number): Promise<PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: limit > 1, copyToCacheDirectory: true });
  if (result.canceled) return [];
  return result.assets.slice(0, limit).map(asset => ({
    uri: asset.uri,
    name: asset.name || nameFromUri(asset.uri),
    mime: asset.mimeType ?? "application/octet-stream",
    size: asset.size,
    blob: asset.file,
  }));
}

export async function pickPhotos(limit: number): Promise<PickedFile[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 1,
  });
  if (result.canceled) return [];
  return result.assets.slice(0, limit).map(asset => ({
    uri: asset.uri,
    name: asset.fileName || nameFromUri(asset.uri, "photo.jpg"),
    mime: asset.mimeType ?? "image/jpeg",
    size: asset.fileSize,
    blob: asset.file,
  }));
}
