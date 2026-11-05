import { executionToken } from "./bridge-auth";
import { useEffect } from "react";
import { AppState } from "react-native";
import { parseServerMessage } from "../../../shared/protocol";
import type { Settings } from "../model";
import { applyLiveHistory } from "../store/app";

/** Foreground, one request at a time; full snapshots replace by native message/call ID. */
export function useSessionActivity(settings: Settings | null, online: boolean, profile?: string, session?: string, host?: string) {
  useEffect(() => {
    if (!settings || !online || !profile || !session) return;
    let stopped = false; let etag = "";
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const poll = async () => {
      if (stopped) return;
      if (AppState.currentState !== "background" && AppState.currentState !== "inactive") {
        controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 5000);
        try {
          const response = await fetch(`http://${settings.address}/hermes/activity?profile=${encodeURIComponent(profile)}&session=${encodeURIComponent(session)}`, { headers: { Authorization: `Bearer ${await executionToken(settings)}`, ...(etag ? { "If-None-Match": etag } : {}) }, signal: controller.signal });
          if (response.ok) {
            const parsed = parseServerMessage({ type: "history", harness: "hermes", sessionId: session, messages: await response.json() });
            if (!stopped && parsed?.type === "history") { applyLiveHistory("hermes", session, parsed.messages, host, profile); etag = response.headers.get("ETag") ?? ""; }
          }
        } catch { /* A missed observation is not a failed chat turn. */ }
        finally { clearTimeout(timeout); }
      }
      if (!stopped) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [settings?.address, settings?.token, online, profile, session, host]);
}
