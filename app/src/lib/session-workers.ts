import { executionToken } from "./bridge-auth";
import type { Settings } from "../model";

/** One delegated worker, as reported by the bridge's /hermes/workers (status only, never transcript). */
export type Worker = { id: string; title: string; phase: string; tool?: string; startedAt: number; lastActivityAt: number };

export function parseWorkers(value: unknown): Worker[] {
  if (typeof value !== "object" || value === null || !("workers" in value) || !Array.isArray(value.workers)) return [];
  const out: Worker[] = [];
  for (const w of value.workers) {
    if (typeof w !== "object" || w === null) continue;
    const id = "id" in w && typeof w.id === "string" ? w.id : undefined;
    const title = "title" in w && typeof w.title === "string" ? w.title : undefined;
    const phase = "phase" in w && typeof w.phase === "string" ? w.phase : "thinking";
    const tool = "tool" in w && typeof w.tool === "string" ? w.tool : undefined;
    const startedAt = "startedAt" in w && typeof w.startedAt === "number" ? w.startedAt : 0;
    const lastActivityAt = "lastActivityAt" in w && typeof w.lastActivityAt === "number" ? w.lastActivityAt : 0;
    if (id && title) out.push({ id, title, phase, ...(tool ? { tool } : {}), startedAt, lastActivityAt });
  }
  return out;
}

/** Fetch only this chat's status, using the same scoped credential as its socket. */
export async function fetchSessionWorkers(settings: Settings, profile: string, session: string, signal: AbortSignal): Promise<Worker[]> {
  const token = await executionToken(settings);
  signal.throwIfAborted();
  const response = await fetch(`http://${settings.address}/hermes/workers?profile=${encodeURIComponent(profile)}&session=${encodeURIComponent(session)}`, {
    headers: { Authorization: `Bearer ${token}` }, signal,
  });
  if (!response.ok) throw new Error(`Worker status unavailable (HTTP ${response.status})`);
  return parseWorkers(await response.json());
}
