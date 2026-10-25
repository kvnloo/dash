// Platform-neutral annotation I/O helpers.
import { executionToken, type AuthSettings } from "../bridge-auth";

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
