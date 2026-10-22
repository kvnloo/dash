export type RecentModel = { provider: string; model: string; count: number };
export const PAID_MODEL_PROVIDERS: readonly string[] = ["openai-codex", "anthropic", "nous"];
export function allowedModel(provider: unknown, model: unknown): provider is string {
  return typeof provider === "string" && PAID_MODEL_PROVIDERS.includes(provider) && typeof model === "string" && /^[A-Za-z0-9][A-Za-z0-9_./:@+-]{0,199}$/.test(model);
}
export function parseRecentModels(value: unknown): RecentModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(row => {
    if (!row || typeof row !== "object" || !("provider" in row) || !("model" in row) || !("count" in row)) return [];
    if (!allowedModel(row.provider, row.model) || typeof row.model !== "string" || typeof row.count !== "number" || !Number.isSafeInteger(row.count) || row.count < 0) return [];
    return [{ provider: row.provider, model: row.model, count: row.count }];
  });
}
export function rankRecentModels(rows: RecentModel[]): RecentModel[] {
  const counts = new Map<string, RecentModel>();
  for (const row of parseRecentModels(rows)) {
    const key = `${row.provider}/${row.model}`;
    const old = counts.get(key);
    counts.set(key, { ...row, count: row.count + (old?.count ?? 0) });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
}
