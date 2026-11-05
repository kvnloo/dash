import type { ModelHealth } from "../../shared/model-roles";
import { record } from "../../shared/model-roles";
const observed = new Map<string, { at: number; health: ModelHealth }>();
export const tinyBaseUrl = () => process.env.DASH_TINY_URL ?? "http://100.113.138.100:11530/v1";
export function noteModelHealth(model: string, health: ModelHealth): void { observed.set(model, { at: Date.now(), health }); }
/** Health is reachability/configuration, not a guarantee of generation speed or quality. */
export async function modelHealth(model: string): Promise<ModelHealth> {
  const cached = observed.get(model);
  if (cached && Date.now() - cached.at < 30000) return cached.health;
  let health: ModelHealth = "unknown";
  if (model.startsWith("local/")) {
    try {
      const response = await fetch(`${tinyBaseUrl().replace(/\/$/, "")}/models`, { signal: AbortSignal.timeout(600), redirect: "error" });
      const value: unknown = response.ok ? await response.json() : null;
      health = record(value) && Array.isArray(value.data) && value.data.some(row => record(row) && row.id === model.slice(6)) ? "healthy" : "unavailable";
    } catch { health = "unavailable"; }
  }
  // OMP OAuth availability is independent of the Dash summary adapter.
  // Do not label an account unavailable just because it has no API key here.
  noteModelHealth(model, health);
  return health;
}
