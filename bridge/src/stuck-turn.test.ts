import { describe, expect, test } from "bun:test";
import {
  DEFAULT_STUCK_THRESHOLDS,
  diagnoseTurn,
  type DiagnoseTurnInput,
  type TurnAction,
  type TurnDiagnosis,
  type TurnObservation,
} from "./stuck-turn";

const thinking: TurnObservation = { phase: "thinking", observed: true };
const tool: TurnObservation = { phase: "tool", tool: "terminal", observed: true };

function input(overrides: Partial<DiagnoseTurnInput> = {}): DiagnoseTurnInput {
  return {
    phase: thinking,
    startedAt: 0,
    lastEventAt: 0,
    now: 1000,
    ownedByBridge: true,
    ...overrides,
  };
}

describe("diagnoseTurn", () => {
  const cases: {
    label: string;
    observation: DiagnoseTurnInput;
    state: TurnDiagnosis["state"];
    idleMs: number;
    actions: TurnAction[];
  }[] = [
    {
      label: "recent thinking is healthy",
      observation: input(),
      state: "healthy", idleMs: 1000, actions: ["wait"],
    },
    {
      label: "streaming activity is healthy",
      observation: input({ phase: { phase: "streaming", observed: true }, now: 20_000, lastEventAt: 19_900 }),
      state: "healthy", idleMs: 100, actions: ["wait"],
    },
    {
      label: "an idle phase is never a stuck active turn",
      observation: input({ phase: { phase: "idle", observed: true }, now: 2_000_000 }),
      state: "healthy", idleMs: 2_000_000, actions: [],
    },
    {
      label: "thinking without recent events becomes slow",
      observation: input({ now: 90_001 }),
      state: "slow", idleMs: 90_001, actions: ["wait", "steer"],
    },
    {
      label: "thinking beyond five minutes becomes stuck",
      observation: input({ now: 300_001 }),
      state: "stuck", idleMs: 300_001, actions: ["steer", "interrupt", "cancel"],
    },
    {
      label: "a tool at five minutes is slow rather than stuck",
      observation: input({ phase: tool, now: 300_001 }),
      state: "slow", idleMs: 300_001, actions: ["wait", "steer"],
    },
    {
      label: "a tool beyond ten minutes becomes stuck",
      observation: input({ phase: tool, now: 600_001 }),
      state: "stuck", idleMs: 600_001, actions: ["steer", "interrupt", "cancel"],
    },
    {
      label: "approval waits for its owner regardless of elapsed time",
      observation: input({ phase: { phase: "waiting-approval", observed: true }, now: 2_000_000 }),
      state: "waiting-on-owner", idleMs: 2_000_000, actions: ["open-host"],
    },
    {
      label: "an unobserved host is not marked stuck",
      observation: input({ phase: { phase: "tool", tool: "terminal", observed: false }, now: 2_000_000 }),
      state: "unobserved", idleMs: 2_000_000, actions: ["wait", "open-host"],
    },
    {
      label: "a dead bridge-owned process permits cancellation",
      observation: input({ processAlive: false }),
      state: "dead", idleMs: 1000, actions: ["cancel"],
    },
    {
      label: "a dead observed-only host permits opening it but not cancellation",
      observation: input({ processAlive: false, ownedByBridge: false }),
      state: "dead", idleMs: 1000, actions: ["open-host"],
    },
    {
      label: "a stuck observed-only turn is never offered cancel",
      observation: input({ ownedByBridge: false, now: 300_001 }),
      state: "stuck", idleMs: 300_001, actions: ["steer", "interrupt"],
    },
    {
      label: "missing observations take priority over a dead-process claim",
      observation: input({ phase: { phase: "thinking", observed: false }, processAlive: false }),
      state: "unobserved", idleMs: 1000, actions: ["wait", "open-host"],
    },
    {
      label: "a confirmed dead process takes priority over a stale approval label",
      observation: input({ phase: { phase: "waiting-approval", observed: true }, processAlive: false }),
      state: "dead", idleMs: 1000, actions: ["cancel"],
    },
  ];

  for (const entry of cases) {
    test(entry.label, () => {
      const actual = diagnoseTurn(entry.observation);
      expect(actual.state).toBe(entry.state);
      expect(actual.idleMs).toBe(entry.idleMs);
      expect(actual.actions).toEqual(entry.actions);
      expect(typeof actual.reason).toBe("string");
      expect(actual.reason.length).toBeGreaterThan(0);
      expect(actual.reason.endsWith(".")).toBe(true);
    });
  }

  test("default duration threshold edges use strict greater-than comparisons", () => {
    expect(DEFAULT_STUCK_THRESHOLDS).toEqual({
      slowMs: 90_000, stuckMs: 300_000, toolStuckMs: 600_000,
    });
    expect(diagnoseTurn(input({ now: 90_000 })).state).toBe("healthy");
    expect(diagnoseTurn(input({ now: 90_001 })).state).toBe("slow");
    expect(diagnoseTurn(input({ now: 300_000 })).state).toBe("slow");
    expect(diagnoseTurn(input({ now: 300_001 })).state).toBe("stuck");
    expect(diagnoseTurn(input({ phase: tool, now: 90_000 })).state).toBe("healthy");
    expect(diagnoseTurn(input({ phase: tool, now: 90_001 })).state).toBe("slow");
    expect(diagnoseTurn(input({ phase: tool, now: 600_000 })).state).toBe("slow");
    expect(diagnoseTurn(input({ phase: tool, now: 600_001 })).state).toBe("stuck");
  });

  test("per-call thresholds are honored without mutating defaults", () => {
    const thresholds = { slowMs: 10, stuckMs: 20, toolStuckMs: 30 };
    expect(diagnoseTurn(input({ now: 10, thresholds })).state).toBe("healthy");
    expect(diagnoseTurn(input({ now: 11, thresholds })).state).toBe("slow");
    expect(diagnoseTurn(input({ now: 20, thresholds })).state).toBe("slow");
    expect(diagnoseTurn(input({ now: 21, thresholds })).state).toBe("stuck");
    expect(diagnoseTurn(input({ now: 21, phase: tool, thresholds })).state).toBe("slow");
    expect(diagnoseTurn(input({ now: 30, phase: tool, thresholds })).state).toBe("slow");
    expect(diagnoseTurn(input({ now: 31, phase: tool, thresholds })).state).toBe("stuck");
    expect(thresholds).toEqual({ slowMs: 10, stuckMs: 20, toolStuckMs: 30 });
    expect(DEFAULT_STUCK_THRESHOLDS.slowMs).toBe(90_000);
  });

  test("invalid and reversed threshold overrides cannot skip the slow boundary", () => {
    expect(diagnoseTurn(input({
      now: 90_001, thresholds: { slowMs: -1, stuckMs: Number.NaN, toolStuckMs: Number.POSITIVE_INFINITY },
    })).state).toBe("slow");
    const thresholds = { slowMs: 100, stuckMs: 20, toolStuckMs: 10 };
    expect(diagnoseTurn(input({ now: 100, thresholds, phase: tool })).state).toBe("healthy");
    expect(diagnoseTurn(input({ now: 101, thresholds, phase: tool })).state).toBe("stuck");
  });

  test("last event and turn start both bound idle time, including clock skew", () => {
    expect(diagnoseTurn(input({ startedAt: 500_000, lastEventAt: 10, now: 500_010 })).idleMs).toBe(10);
    expect(diagnoseTurn(input({ startedAt: 10, lastEventAt: 500_000, now: 500_010 })).idleMs).toBe(10);
    expect(diagnoseTurn(input({ startedAt: 500_000, now: 100 })).idleMs).toBe(0);
    expect(diagnoseTurn(input({ lastEventAt: 500_000, now: 100 })).idleMs).toBe(0);
    const incomplete = diagnoseTurn(input({ lastEventAt: Number.NaN, now: 2_000_000 }));
    expect(incomplete).toMatchObject({ state: "unobserved", idleMs: 0, actions: ["wait", "open-host"] });
    expect(incomplete.reason).toBe("Host event timing is unavailable.");
  });

  test("reasons expose bounded tool identifiers, never commands or transcripts", () => {
    const named = diagnoseTurn(input({ phase: tool, now: 600_001 }));
    expect(named.reason).toContain("terminal");
    expect(named.reason).toContain("600 s");
    expect(named.reason).not.toContain("executing");
    const concurrent = diagnoseTurn(input({ phase: { phase: "tool", tool: "terminal, read_file", observed: true }, now: 300_001 }));
    expect(concurrent.reason).toContain("terminal, read_file");
    for (const secret of ["terminal --password private-token", "terminal\nprivate transcript", "<script>alert(1)</script>", "x".repeat(100)]) {
      const diagnosis = diagnoseTurn(input({ phase: { phase: "tool", tool: secret, observed: true }, now: 600_001 }));
      expect(diagnosis.reason).not.toContain(secret);
      expect(diagnosis.reason).not.toContain("private");
      expect(diagnosis.reason).not.toContain("script");
    }
  });

  test("observed-only and unobserved turns never offer process cancellation", () => {
    const phases: TurnObservation[] = [
      { phase: "thinking", observed: true },
      { phase: "tool", tool: "terminal", observed: true },
      { phase: "streaming", observed: true },
      { phase: "waiting-approval", observed: true },
      { phase: "idle", observed: true },
      { phase: "tool", observed: false },
    ];
    for (const phase of phases) {
      for (const processAlive of [true, false, undefined]) {
        const diagnosis = diagnoseTurn(input({ phase, processAlive, ownedByBridge: false, now: 1_000_000 }));
        expect(diagnosis.actions).not.toContain("cancel");
      }
    }
    const unobserved = diagnoseTurn(input({ phase: { phase: "tool", observed: false }, now: 900_000 }));
    expect(unobserved.actions).not.toContain("interrupt");
    expect(unobserved.actions).not.toContain("cancel");
  });

  test("same inputs always produce the same serializable diagnosis", () => {
    const observation = input({ phase: tool, startedAt: 60_000, lastEventAt: 200_000, now: 800_001 });
    const first = diagnoseTurn(observation);
    const second = diagnoseTurn(observation);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.idleMs).toBe(600_001);
  });
});
