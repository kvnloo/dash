// Platform-neutral annotation I/O helpers.
import { executionToken, type AuthSettings } from "../bridge-auth";
import { rejectReason } from "../attachments";
import { MAX_ATTACHMENTS_PER_TURN, type ChatAttachment } from "../../../../shared/protocol";
import type { ComposerDraft } from "../../store/composer-drafts";
import { attachmentNames, circleDraftText, closedPenLoopRegion, visibleTextInRegion, type CircleRegion, type ScreenInfo, type VisibleTextBox } from "./compose";
import type { Stroke } from "./strokes";

export type BridgeSettings = { address: string } & AuthSettings;

export function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

/** Host STT through the bridge's POST /transcribe. */
export async function transcribeRecording(settings: BridgeSettings, audio: ArrayBuffer, fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch, authorize = executionToken): Promise<string> {
  // Identity failure is not a network failure to /transcribe. Keep its safe stage/status.
  const token = await authorize(settings);
  let res: Response;
  try {
    res = await fetchImpl(`http://${settings.address}/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: audio,
    });
  } catch {
    throw new Error("Could not reach the bridge to transcribe.");
  }
  const body: unknown = await res.json().catch(() => undefined);
  const text = typeof body === "object" && body !== null ? Reflect.get(body, "text") : undefined;
  if (!res.ok || typeof text !== "string") {
    const error = typeof body === "object" && body !== null ? Reflect.get(body, "error") : undefined;
    throw new Error(typeof error === "string" ? error : `Transcription failed (${res.status}).`);
  }
  return text;
}


/** Round outwards when mapping screen-DIP bounds to a higher-density PNG. */
export function pixelCrop(region: CircleRegion, screen: ScreenInfo, imageWidth: number, imageHeight: number): CircleRegion {
  if (![screen.width, screen.height, imageWidth, imageHeight].every(n => Number.isFinite(n) && n > 0) ||
      !Number.isInteger(imageWidth) || !Number.isInteger(imageHeight) ||
      ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
      region.width <= 0 || region.height <= 0) {
    throw new Error("Invalid annotation image or crop dimensions.");
  }
  const x = Math.max(0, Math.min(imageWidth - 1, Math.floor(region.x * imageWidth / screen.width)));
  const y = Math.max(0, Math.min(imageHeight - 1, Math.floor(region.y * imageHeight / screen.height)));
  const right = Math.max(x + 1, Math.min(imageWidth, Math.ceil((region.x + region.width) * imageWidth / screen.width)));
  const bottom = Math.max(y + 1, Math.min(imageHeight, Math.ceil((region.y + region.height) * imageHeight / screen.height)));
  return { x, y, width: right - x, height: bottom - y };
}

export interface CroppedPng { bytes: Uint8Array; dataUri: string }
export type CropMarkedPng = (png: Uint8Array, screen: ScreenInfo, region: CircleRegion) => Promise<CroppedPng>;

/**
 * Crop the composited screenshot (already containing the pen ink) with Skia.
 * Load Skia only on actual capture, so the pure Bun tests do not load native modules.
 */
export async function cropMarkedPng(png: Uint8Array, screen: ScreenInfo, region: CircleRegion): Promise<CroppedPng> {
  if (png.byteLength === 0) throw new Error("The marked screenshot is empty.");
  const { Skia } = await import("@shopify/react-native-skia");
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(png));
  if (!image) throw new Error("Could not decode the marked screenshot.");
  const rect = pixelCrop(region, screen, image.width(), image.height());
  const surface = Skia.Surface.Make(rect.width, rect.height);
  if (!surface) throw new Error("Could not allocate the cropped screenshot.");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("transparent"));
  canvas.drawImage(image, -rect.x, -rect.y);
  surface.flush();
  const cropped = surface.makeImageSnapshot();
  return { bytes: cropped.encodeToBytes(), dataUri: `data:image/png;base64,${cropped.encodeToBase64()}` };
}

export interface CircleDraftRequest {
  stroke: Stroke;
  screen: ScreenInfo;
  /** A composited, marked, full-screen PNG. Do not pass an unmarked screenshot. */
  markedPng: Uint8Array;
  /** Only text visible inside the circled rectangle is added to the draft. */
  visibleText?: readonly VisibleTextBox[];
  createdAt: number;
  /** The functional writer of the active conversation's composer draft. */
  updateDraft(change: (draft: ComposerDraft) => ComposerDraft): void;
  /** Uploads the cropped PNG, but never sends a chat message. */
  uploadPng(name: string, bytes: Uint8Array): Promise<ChatAttachment>;
  /** Override for deterministic unit tests; production uses Skia. */
  crop?: CropMarkedPng;
}

/**
 * Stage a pending chip immediately; replace its preview on crop, then mark ready
 * after bridge upload. A removed chip stays removed, and upload failures stay
 * visible for retry/removal. No send/steer/sink API exists in this flow.
 */
export async function attachClosedPenLoop(request: CircleDraftRequest): Promise<"ignored" | "full" | "ready" | "error"> {
  const region = closedPenLoopRegion(request.stroke, request.screen);
  if (!region) return "ignored";
  const key = `spen-circle-${request.screen.id}-${request.stroke.id}-${request.stroke.startedAt}`;
  const name = attachmentNames(request.createdAt).image.replace(/^annotation-/, `spen-circle-${request.stroke.id}-`);
  let inserted = false, full = false;
  request.updateDraft(draft => {
    if (draft.attachments.some(chip => chip.key === key)) return draft;
    if (draft.attachments.length >= MAX_ATTACHMENTS_PER_TURN) { full = true; return draft; }
    inserted = true;
    return { ...draft, attachments: [...draft.attachments, { key, name, mime: "image/png", uri: "", state: "uploading" }] };
  });
  if (!inserted) return full ? "full" : "ignored";

  try {
    const cropped = await (request.crop ?? cropMarkedPng)(request.markedPng, request.screen, region);
    if (!cropped.bytes.byteLength || !cropped.dataUri.startsWith("data:image/png;base64,")) {
      throw new Error("Could not create the cropped PNG.");
    }
    const reason = rejectReason({ name, size: cropped.bytes.byteLength });
    if (reason) throw new Error(reason);
    const text = visibleTextInRegion(region, request.visibleText ?? []);
    let attached = false;
    request.updateDraft(draft => {
      if (!draft.attachments.some(chip => chip.key === key)) return draft;
      attached = true;
      return {
        ...draft,
        text: circleDraftText(draft.text, request.screen.route, text),
        attachments: draft.attachments.map(chip => chip.key === key
          ? { ...chip, uri: cropped.dataUri, size: cropped.bytes.byteLength }
          : chip),
      };
    });
    if (!attached) return "ignored";
    const ref = await request.uploadPng(name, cropped.bytes);
    request.updateDraft(draft => ({
      ...draft,
      attachments: draft.attachments.map(chip => chip.key === key
        ? { ...chip, state: "ready", ref, size: ref.size }
        : chip),
    }));
    return "ready";
  } catch (error) {
    request.updateDraft(draft => ({
      ...draft,
      attachments: draft.attachments.map(chip => chip.key === key
        ? { ...chip, state: "error", error: error instanceof Error ? error.message : "Could not attach the marked screenshot." }
        : chip),
    }));
    return "error";
  }
}
