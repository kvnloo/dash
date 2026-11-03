/**
 * Slice 0: useZ0LiveEvents — SSE-based wake for z0live call state.
 *
 * Connects to GET /z0live/events on the bridge. Fires a callback on each
 * z0live_start / z0live_phase / z0live_end event. Falls back gracefully when
 * running on web or when the endpoint is unavailable (treats as no events).
 *
 * The existing useZ0LiveState poll continues to run in parallel and provides
 * the full state object; this hook purely wakes the native orb service faster.
 */
import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { executionToken } from "./bridge-auth";
import type { Settings } from "../model";

export type Z0LiveEventName = "z0live_start" | "z0live_phase" | "z0live_end";

export interface Z0LiveEvent {
  name: Z0LiveEventName;
  data: {
    sessionId?: string;
    phase?: string;
    muted?: boolean;
  };
}

/**
 * Subscribe to z0live SSE push events from the bridge.
 * Reconnects on error with a 3 s backoff; pauses when backgrounded.
 */
export function useZ0LiveEvents(
  settings: Settings | null,
  enabled: boolean,
  onEvent: (e: Z0LiveEvent) => void
): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!settings || !enabled) return;

    let disposed = false;
    let controller: AbortController | undefined;
    let retryTimer: ReturnType<typeof setTimeout>;
    let appState = AppState.currentState;

    const connect = async () => {
      if (disposed) return;
      if (appState === "background") {
        // Retry when foregrounded (we can't stream while backgrounded from JS side)
        retryTimer = setTimeout(connect, 5000);
        return;
      }

      try {
        const token = await executionToken(settings);
        controller = new AbortController();
        const res = await fetch(`http://${settings.address}/z0live/events`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          // Endpoint missing or not yet deployed — fail silently, retry
          retryTimer = setTimeout(connect, 20000);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (!disposed) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          // Parse SSE frame(s)
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const eventLine = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
            const dataLine  = frame.match(/^data:\s*(.+)$/m)?.[1]?.trim();
            if (!eventLine || !dataLine) continue;
            if (!["z0live_start", "z0live_phase", "z0live_end"].includes(eventLine)) continue;
            try {
              const data = JSON.parse(dataLine);
              onEventRef.current({ name: eventLine as Z0LiveEventName, data });
            } catch { /* malformed data */ }
          }
        }
      } catch (err: unknown) {
        // AbortError = intentional close; other errors → reconnect
        if (err instanceof Error && err.name === "AbortError") return;
        if (!disposed) retryTimer = setTimeout(connect, 3000);
        return;
      }

      // Graceful end-of-stream → reconnect
      if (!disposed) retryTimer = setTimeout(connect, 1000);
    };

    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      appState = state;
      if (state === "active" && !controller && !disposed) {
        void connect();
      } else if (state === "background") {
        controller?.abort();
        controller = undefined;
      }
    });

    void connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      controller?.abort();
      sub.remove();
    };
  }, [settings?.address, settings?.token, enabled]);
}
