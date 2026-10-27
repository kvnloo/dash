/** Pure turn-safety helpers. Importable by tests without starting dash-pair. */

export const CANCELLED_EXIT_CODE = 130;
/** GNU timeout / dash hang. Distinct from SIGTERM cancel (130). */
export const TIMEOUT_EXIT_CODE = 124;
export const DEFAULT_TURN_TIMEOUT_MS = 10 * 60 * 1000;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function turnTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DASH_TURN_TIMEOUT_MS;
  if (!raw) return DEFAULT_TURN_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : DEFAULT_TURN_TIMEOUT_MS;
}

export function replayAfter<T extends { seq: number }>(events: readonly T[], afterSeq: number): T[] {
  return events.filter((event) => event.seq > afterSeq);
}

export function parseHarnessJsonLine(
  line: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } | null {
  if (line.length === 0 || line.charCodeAt(0) !== 123 /* { */) return null;
  try {
    const value: unknown = JSON.parse(line);
    if (isObjectRecord(value)) {
      return { ok: true, value };
    }
    return { ok: false, error: "Harness JSON line was not an object." };
  } catch {
    return { ok: false, error: "Harness emitted malformed JSON." };
  }
}

export function nonZeroExitMessage(name: string, exitCode: number, stderrTail: string): string {
  const detail = stderrTail.trim();
  return detail || `${name} exited with code ${exitCode}`;
}

export function timeoutMessage(name: string, timeoutMs: number): string {
  return `${name} timed out after ${timeoutMs}ms.`;
}

export type Killable = {
  exited: Promise<number>;
  kill: (signal?: number | NodeJS.Signals) => void;
};

/** Wait for a child to exit. If it hangs past timeoutMs, SIGTERM then SIGKILL. */
export async function waitForExitOrTimeout(
  proc: Killable,
  timeoutMs: number,
  killGraceMs = 3000,
): Promise<{ exitCode: number; timedOut: boolean }> {
  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
    setTimeout(() => {
      proc.kill("SIGKILL");
    }, killGraceMs);
  }, timeoutMs);
  try {
    const exitCode = await proc.exited;
    return { exitCode, timedOut };
  } finally {
    clearTimeout(killer);
  }
}
