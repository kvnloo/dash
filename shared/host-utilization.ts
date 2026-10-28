/** Utilization is observed busy time, not uptime or CPU allocation. */
export interface UtilizationWindow {
  hours: number;
  utilization: number | null;
  coverage: number;
  averageCpu: number | null;
  averageGpu: number | null;
}
export interface HostUtilization { hostId: string; day: UtilizationWindow; week: UtilizationWindow }
export interface UtilizationSnapshot { generatedAt: number; hosts: HostUtilization[] }
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function window(v: unknown): v is UtilizationWindow {
  return record(v) && finite(v.hours) && v.hours > 0 && finite(v.coverage) && v.coverage >= 0 && v.coverage <= 1
    && (v.utilization === null || (finite(v.utilization) && v.utilization >= 0 && v.utilization <= 100))
    && (v.averageCpu === null || (finite(v.averageCpu) && v.averageCpu >= 0 && v.averageCpu <= 100))
    && (v.averageGpu === null || (finite(v.averageGpu) && v.averageGpu >= 0 && v.averageGpu <= 100));
}
export function parseHostUtilization(v: unknown): UtilizationSnapshot | null {
  if (!record(v) || !finite(v.generatedAt) || !Array.isArray(v.hosts)) return null;
  const hosts: HostUtilization[] = [];
  for (const h of v.hosts) {
    if (!record(h) || typeof h.hostId !== "string" || !window(h.day) || h.day.hours !== 24 || !window(h.week) || h.week.hours !== 168) return null;
    hosts.push({ hostId: h.hostId, day: h.day, week: h.week });
  }
  return { generatedAt: v.generatedAt, hosts };
}
export function utilizationLabel(host?: HostUtilization): string {
  const day = host?.day;
  if (!day || day.utilization === null) return "24h utilization n/a";
  const coverage = day.coverage > 0 && day.coverage < 0.01 ? "<1" : String(Math.round(day.coverage * 100));
  return `24h utilization ${Math.round(day.utilization)}%${day.coverage < 0.8 ? " · partial" : ""} · ${coverage}% coverage`;
}
