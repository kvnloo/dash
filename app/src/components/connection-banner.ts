import type { Connection } from "../model";

type Reachability = Readonly<Pick<Connection, "status" | "error">>;

export interface ConnectionBannerState {
  connecting: boolean;
  heading: string;
  detail: string;
  retryLabel: string;
  retryText: string;
  liveRegion: "none" | "polite";
}

/** UI decisions only: no bridge, store, theme, or React Native imports. */
export function connectionBannerFor(connection: Reachability): ConnectionBannerState | null {
  if (connection.status === "online" || connection.status === "idle") return null;

  const connecting = connection.status === "connecting";
  const failure = connection.error?.trim();

  return {
    connecting,
    heading: connecting ? "Connecting to bridge" : "Bridge unreachable",
    detail: connecting
      ? "Waiting for the saved bridge to respond."
      : (failure || "No response. Check Tailscale on your phone and computer.") + " · Queued drafts kept",
    retryLabel: connecting ? "Connecting to bridge" : "Retry bridge connection",
    retryText: connecting ? "Trying…" : "Retry",
    liveRegion: connecting ? "none" : "polite",
  };
}

/** One retry per displayed offline attempt; a subsequent failed render gets a new guard. */
export function createConnectionRetry(connecting: boolean, retryBridge: () => void): () => void {
  let requested = false;

  return () => {
    if (connecting || requested) return;
    requested = true;
    try {
      retryBridge();
    } catch (error) {
      requested = false;
      throw error;
    }
  };
}
