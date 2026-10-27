/**
 * Pure Flow latency thresholds. FlowStage mirrors the flow/wp1-3 trace
 * contract until that work is integrated; do not import the unlanded module.
 */
export type FlowStage =
  | "ink.down"
  | "ink.up"
  | "ink.frame"
  | "ink.submit"
  | "stylus.btn"
  | "pill.commit"
  | "input.pen"
  | "input.touch"
  | "input.mic"
  | "ack.paint"
  | "vad.start"
  | "word.paint"
  | "turn.commit"
  | "genui.loader"
  | "genui.first_node"
  | "audio.first_frame_out"
  | "playback.silence"
  | "gen.bump"
  | "genui.discard"
  | "refresh.save"
  | "refresh.paint"
  | "chip.paint";

export type BudgetRow = {
  id: string;
  start: readonly FlowStage[];
  end: FlowStage;
  p50Ms: number;
  p95Ms: number;
  provisional: boolean;
  note: string;
};

export const FLOW_BUDGET: readonly BudgetRow[] = [
  {
    id: "ink-first-frame",
    start: ["ink.down"],
    end: "ink.frame",
    p50Ms: 16.7,
    p95Ms: 25,
    provisional: true,
    note: "Unmeasured ink-frame hypothesis; excludes panel scanout.",
  },
  {
    id: "pill-change",
    start: ["stylus.btn"],
    end: "pill.commit",
    p50Ms: 50,
    p95Ms: 80,
    provisional: false,
    note: "Hardware stylus button to committed mode-pill state.",
  },
  {
    id: "local-ack",
    start: ["input.pen", "input.touch", "input.mic"],
    end: "ack.paint",
    p50Ms: 50,
    p95Ms: 100,
    provisional: false,
    note: "Any pen, touch, or mic input to the local painted acknowledgement.",
  },
  {
    id: "first-word",
    start: ["vad.start"],
    end: "word.paint",
    p50Ms: 500,
    p95Ms: 900,
    provisional: true,
    note: "Voice activity to first painted recognition word; pending device measurement.",
  },
  {
    id: "loader",
    start: ["turn.commit"],
    end: "genui.loader",
    p50Ms: 300,
    p95Ms: 500,
    provisional: false,
    note: "Committed turn to first GenUI loader paint.",
  },
  {
    id: "first-node",
    start: ["turn.commit"],
    end: "genui.first_node",
    p50Ms: 1500,
    p95Ms: 2500,
    provisional: false,
    note: "Committed turn to first rendered GenUI node.",
  },
  {
    id: "first-audible",
    start: ["turn.commit"],
    end: "audio.first_frame_out",
    p50Ms: 1314,
    p95Ms: 1983,
    provisional: true,
    note: "Cloud baseline, not a measured local result; target is to beat it.",
  },
  {
    id: "barge-silence",
    start: ["vad.start"],
    end: "playback.silence",
    p50Ms: 200,
    p95Ms: 300,
    provisional: false,
    note: "Barge-in voice activity to audible playback silence.",
  },
  {
    id: "stale-discard",
    start: ["gen.bump"],
    end: "genui.discard",
    p50Ms: 100,
    p95Ms: 100,
    provisional: false,
    note: "Generation invalidation to stale GenUI discard.",
  },
  {
    id: "refresh",
    start: ["refresh.save"],
    end: "refresh.paint",
    p50Ms: 2000,
    p95Ms: 4000,
    provisional: false,
    note: "Fast Refresh save to repainted surface.",
  },
  {
    id: "circle-chip",
    start: ["ink.up"],
    end: "chip.paint",
    p50Ms: 150,
    p95Ms: 300,
    provisional: false,
    note: "Completion of pen circle to visible context chip.",
  },
];

export type RowStatus = "pass" | "fail" | "insufficient-n" | "no-samples";

export type RowEvaluation = {
  id: string;
  n: number;
  rejected: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  status: RowStatus;
  reasons: string[];
};

export type BudgetEvaluation = {
  rows: RowEvaluation[];
  unknownIds: string[];
  verdict: "pass" | "fail" | "incomplete";
};

export type EvaluationOptions = { minN?: number };

/**
 * Nearest-rank percentile on ascending observations. The one-based rank is
 * ceil(q * n), so q=.95 with n=30 returns observation 29, not interpolation.
 * Caller supplies sorted data; this function neither sorts nor mutates it.
 */
export function percentile(sortedAsc: readonly number[], q: number): number | null {
  if (!Number.isFinite(q) || q <= 0 || q > 1) {
    throw new RangeError("Percentile q must be in (0, 1].");
  }
  if (sortedAsc.length === 0) return null;
  return sortedAsc[Math.ceil(q * sortedAsc.length) - 1] ?? null;
}

function assertMinN(minN: number): void {
  if (!Number.isSafeInteger(minN) || minN < 1) {
    throw new RangeError("minN must be a positive safe integer.");
  }
}

/**
 * Only valid, non-negative, finite durations count toward sample adequacy.
 * Threshold failures take precedence over an insufficient sample count.
 */
export function evaluateRow(
  row: BudgetRow,
  samplesMs: readonly number[],
  { minN = 100 }: EvaluationOptions = {},
): RowEvaluation {
  assertMinN(minN);
  const valid = samplesMs.filter((ms) => Number.isFinite(ms) && ms >= 0);
  const rejected = samplesMs.length - valid.length;
  const n = valid.length;
  if (n === 0) {
    return {
      id: row.id,
      n,
      rejected,
      p50: null,
      p95: null,
      max: null,
      status: "no-samples",
      reasons: ["No valid latency samples."],
    };
  }

  valid.sort((a, b) => a - b);
  const p50 = percentile(valid, 0.5);
  const p95 = percentile(valid, 0.95);
  const max = valid[n - 1] ?? null;
  const failures: string[] = [];
  if (p50 !== null && p50 > row.p50Ms) {
    failures.push("p50 " + p50 + "ms exceeds " + row.p50Ms + "ms budget.");
  }
  if (p95 !== null && p95 > row.p95Ms) {
    failures.push("p95 " + p95 + "ms exceeds " + row.p95Ms + "ms budget.");
  }

  if (failures.length > 0) {
    return { id: row.id, n, rejected, p50, p95, max, status: "fail", reasons: failures };
  }
  if (n < minN) {
    return {
      id: row.id,
      n,
      rejected,
      p50,
      p95,
      max,
      status: "insufficient-n",
      reasons: ["Only " + n + " valid samples; minimum is " + minN + "."],
    };
  }
  return { id: row.id, n, rejected, p50, p95, max, status: "pass", reasons: [] };
}

/**
 * An unmeasured optional budget is not a failure. A provided-but-invalid
 * series is incomplete, never passing. Unknown IDs are reported, not scored.
 * The empty evaluation is incomplete even when no IDs were required.
 */
export function evaluateBudget(
  samplesById: ReadonlyMap<string, readonly number[]>,
  { minN = 100, required = [] }: EvaluationOptions & { required?: readonly string[] } = {},
): BudgetEvaluation {
  assertMinN(minN);
  const knownIds = new Set(FLOW_BUDGET.map((row) => row.id));
  const unknownIds = [...samplesById.keys()].filter((id) => !knownIds.has(id)).sort();
  const rows = FLOW_BUDGET.map((row) =>
    evaluateRow(row, samplesById.get(row.id) ?? [], { minN }),
  );

  const failed = rows.some((row) => row.status === "fail");
  const evaluated = rows.some((row) => row.n > 0);
  const incompleteSampled = rows.some((row) => {
    const supplied = samplesById.get(row.id);
    return supplied !== undefined && supplied.length > 0 && row.status !== "pass";
  });
  const missingRequired = required.some((id) =>
    !knownIds.has(id) || !rows.some((row) => row.id === id && row.n > 0),
  );
  const verdict = failed
    ? "fail"
    : evaluated && !incompleteSampled && !missingRequired
      ? "pass"
      : "incomplete";

  return { rows, unknownIds, verdict };
}
