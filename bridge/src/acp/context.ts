import { record, type ContextSnapshot } from "../../../shared/context";

/** Counts only, bounded and short-lived. Never retain ACP content or credentials. */
export class AcpContextReadings {
  private entries = new Map<string, { at: number; used: number; maximum: number }>();
  constructor(private now = Date.now) {}
  observe(harness: string, session: string, update: unknown): void {
    if (!record(update) || update.sessionUpdate !== "usage_update" || typeof update.used !== "number" || !Number.isFinite(update.used) || update.used < 0 || typeof update.size !== "number" || !Number.isFinite(update.size) || update.size <= 0) return;
    const key = `${harness}\0${session}`;
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), used: update.used, maximum: update.size });
    if (this.entries.size > 128) { const oldest = this.entries.keys().next().value; if (oldest !== undefined) this.entries.delete(oldest); }
  }
  read(harness: string, session: string, fallback?: ContextSnapshot): ContextSnapshot | undefined {
    const entry = this.entries.get(`${harness}\0${session}`);
    if (!entry || this.now() - entry.at > 60_000) return fallback;
    return { sessionId: session, model: fallback?.model ?? "Unknown", provider: fallback?.provider, used: entry.used, maximum: entry.maximum, threshold: fallback?.threshold ?? 0, estimated: true, source: "ACP usage_update (agent-reported)", categories: fallback?.categories ?? [], revision: `acp:${entry.at}`, notes: ["Context occupancy reported by the attached agent; not lifetime token throughput.", ...(fallback?.notes ?? [])] };
  }
}
export const acpContextReadings = new AcpContextReadings();
