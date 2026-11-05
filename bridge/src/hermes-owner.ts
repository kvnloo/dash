import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Who holds a Hermes session open right now, read from Hermes's own lease
 * registry (`<profile home>/runtime/active_sessions.json`, written by the
 * classic CLI and the TUI through `hermes_cli/active_sessions.py`).
 *
 * The registry is read without its lock and without writing: a lease whose
 * process is gone (or whose PID was reused) is ignored, exactly the entries
 * Hermes itself prunes. Unknown/unreadable registry = no owner evidence; the
 * caller still never resumes through a second classic CLI.
 */
export type LiveOwner = { surface: string; pid: number; sessionId: string; startedAt?: number };

type ProcessProbe = { alive(pid: number): boolean; startTime(pid: number): number | undefined };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let bootTime: number | undefined;
function procStartTime(pid: number): number | undefined {
  try {
    bootTime ??= Number(/^btime (\d+)$/m.exec(readFileSync("/proc/stat", "utf8"))?.[1]);
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Field 22 (starttime) counts after the parenthesised comm, which may contain spaces.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = Number(fields[19]);
    if (!Number.isFinite(bootTime) || !Number.isFinite(ticks)) return undefined;
    return bootTime + ticks / 100;
  } catch { return undefined; }
}

function procAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EPERM")) return false;
  }
  try { return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return true; }
}

export const hostProcesses: ProcessProbe = { alive: procAlive, startTime: procStartTime };

/** Live leases in one profile home. PID reuse is rejected when start times disagree. */
export function readLiveOwners(home: string, probe: ProcessProbe = hostProcesses): LiveOwner[] {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(join(home, "runtime", "active_sessions.json"), "utf8")); } catch { return []; }
  const entries = record(parsed) && Array.isArray(parsed.entries) ? parsed.entries : [];
  const owners: LiveOwner[] = [];
  for (const entry of entries) {
    if (!record(entry) || typeof entry.session_id !== "string" || !entry.session_id) continue;
    const pid = typeof entry.pid === "number" && Number.isInteger(entry.pid) && entry.pid > 0 ? entry.pid : undefined;
    if (pid === undefined || pid === process.pid || !probe.alive(pid)) continue;
    const recorded = typeof entry.process_start_time === "number" ? entry.process_start_time : undefined;
    const actual = recorded === undefined ? undefined : probe.startTime(pid);
    if (recorded !== undefined && actual !== undefined && Math.abs(actual - recorded) > 2) continue;
    owners.push({ surface: typeof entry.surface === "string" && entry.surface ? entry.surface : "another surface", pid, sessionId: entry.session_id,
      ...(typeof entry.started_at === "number" && Number.isFinite(entry.started_at) ? { startedAt: entry.started_at } : {}) });
  }
  return owners;
}

/** The owner of any id in a session's compression lineage. */
export function ownerOf(owners: LiveOwner[], lineage: ReadonlySet<string>): LiveOwner | undefined {
  return owners.find(owner => lineage.has(owner.sessionId));
}

/** Human label for the phone: "CLI", "TUI", "desktop". Never a PID. */
export function surfaceLabel(surface: string): string {
  return surface === "cli" || surface === "tui" ? surface.toUpperCase() : surface;
}
