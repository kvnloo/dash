import { executionToken } from "./bridge-auth";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { Settings } from "../model";
import type { Thinking } from "./thinking";

export type ObservedPhase = Thinking & { observed: boolean; source: "terminal" };
export function parseObservedPhase(value: unknown): ObservedPhase | undefined {
  if (typeof value !== "object" || value === null || !("phase" in value) || !("observed" in value) || !("source" in value)) return;
  if (value.source !== "terminal" || typeof value.observed !== "boolean") return;
  const phase = value.phase;
  if (phase !== "idle" && phase !== "thinking" && phase !== "tool" && phase !== "streaming" && phase !== "waiting-approval") return;
  const tool = "tool" in value && typeof value.tool === "string" && /^[\w.:-]+(?:, [\w.:-]+)*$/.test(value.tool) ? value.tool : undefined;
  return { phase, observed: value.observed, source: "terminal", ...(tool ? { tool } : {}) };
}

/** One in-flight status-only read; never poll a backgrounded phone or retain a prior session. */
export function useSessionPhase(settings: Settings | null, online: boolean, profile?: string, session?: string): ObservedPhase | undefined {
  const [sample, setSample] = useState<{ key: string; phase: ObservedPhase }>();
  const key = `${settings?.address}\0${profile}\0${session}`;
  useEffect(() => {
    if (!settings || !online || !profile || !session) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const poll = async () => {
      if (disposed) return;
      if (AppState.currentState === "background" || AppState.currentState === "inactive") { timer = setTimeout(poll, 2000); return; }
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 1800);
      try {
        const response = await fetch(`http://${settings.address}/hermes/phase?profile=${encodeURIComponent(profile)}&session=${encodeURIComponent(session)}`, {
          headers: { Authorization: `Bearer ${await executionToken(settings)}` }, signal: controller.signal,
        });
        const phase = response.ok ? parseObservedPhase(await response.json()) : undefined;
        if (!disposed) setSample(phase ? { key, phase } : undefined);
      } catch { if (!disposed) setSample(undefined); }
      finally { clearTimeout(timeout); if (!disposed) timer = setTimeout(poll, 2000); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [settings?.address, settings?.token, online, profile, session, key]);
  return online && sample?.key === key ? sample.phase : undefined;
}
