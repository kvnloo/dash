// OMP names stay canonical; Dash aliases never create independent assignments.
export const ROLE_PURPOSES = {
  tiny: "Local low-latency decisions and fallback summaries",
  smol: "Fast summaries and lightweight chat",
  default: "General interactive assistant",
  slow: "Comprehensive reasoning",
  vision: "Image understanding",
  plan: "Architecture and planning",
  task: "Delegated subtasks",
  advisor: "Second opinions",
  judge: "Ranking and evaluation (not arbitrary generation)",
  orchestrator: "Coordinate work; inherits default",
  commit: "Commit messages",
  memory: "Memory extraction",
  widget: "Background job widgets",
  image: "Image generation",
  web: "Web search",
  speech: "Text to speech",
  dictation: "Speech to text",
};
export type ModelRole = keyof typeof ROLE_PURPOSES;
export type RoleSource = "dash" | "omp" | "default";
export type ModelHealth = "unknown" | "healthy" | "unavailable";
export interface ResolvedRole {
  role: ModelRole;
  model: string;
  source: RoleSource;
  purpose: string;
  fallback: string[];
  health: ModelHealth;
}
export function canonicalRole(value: string): ModelRole | undefined {
  const name = value.startsWith("@") ? value.slice(1) : value;
  if (name === "large") return "slow";
  if (name === "planning") return "plan";
  if (name === "orchestrating") return "orchestrator";
  return Object.keys(ROLE_PURPOSES).find((role): role is ModelRole => role === name);
}
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function parseRoles(value: unknown): ResolvedRole[] | null {
  if (!Array.isArray(value)) return null;
  const roles: ResolvedRole[] = [];
  for (const row of value) {
    if (!record(row) || typeof row.role !== "string" || canonicalRole(row.role) !== row.role ||
        typeof row.model !== "string" || typeof row.purpose !== "string" ||
        (row.source !== "dash" && row.source !== "omp" && row.source !== "default") ||
        (row.health !== "unknown" && row.health !== "healthy" && row.health !== "unavailable") ||
        !Array.isArray(row.fallback) || !row.fallback.every((item: unknown): item is string => typeof item === "string")) return null;
    const role = canonicalRole(row.role);
    if (!role || roles.some(item => item.role === role)) return null;
    roles.push({ role, model: row.model, purpose: row.purpose, source: row.source, fallback: row.fallback, health: row.health });
  }
  return roles;
}
