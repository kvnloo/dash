/**
 * Deterministic Brainstorm ink/speech turn fusion. The caller supplies monotonic
 * event times and drives tick(); this core never reads a clock or starts timers.
 */
export type FuseEvent =
  | { type: "speech-start"; at: number }
  | { type: "speech-stop"; at: number }
  | { type: "pen-down"; at: number }
  | { type: "pen-up"; at: number };

export type FuseOutput =
  | { kind: "turn-open"; traceId: string; generation: number; at: number }
  | { kind: "capture-open"; captureId: string; traceId: string; joined: boolean }
  | { kind: "floor"; event: "speech-start" | "speech-stop"; traceId: string }
  | { kind: "commit"; traceId: string; generation: number; at: number; captureIds: string[] }
  | { kind: "generation-bump"; traceId: string; generation: number };

export interface FuseSnapshot {
  traceId: string | null;
  generation: number | null;
  speechActive: boolean;
  penDown: boolean;
  captureIds: string[];
  lastSpeechStop: number | null;
  lastPenUp: number | null;
  pendingCommitAt: number | null;
  committed: boolean;
  lastCommitAt: number | null;
  lastSeenAt: number | null;
  ignored: number;
}

export interface TurnFuser {
  handle(event: FuseEvent): FuseOutput[];
  tick(atMs: number): FuseOutput[];
  state(): FuseSnapshot;
}

export interface TurnFuseOptions {
  newId: () => string;
  joinWindowMs?: number;
  penIdleMs?: number;
}

interface Turn {
  traceId: string;
  generation: number;
  speechActive: boolean;
  penDepth: number;
  lastSpeechStop: number | null;
  lastPenUp: number | null;
  captureIds: string[];
  committed: boolean;
  committedAt: number | null;
}

/** Stage strings from flow-trace.ts; deliberately no dependency on that branch. */
export type FuseFlowStage = "ink.down" | "vad.start" | "turn.commit" | "gen.bump";

export function flowStageForFuseOutput(output: FuseOutput): FuseFlowStage | null {
  switch (output.kind) {
    case "capture-open": return "ink.down";
    case "floor": return output.event === "speech-start" ? "vad.start" : null;
    case "commit": return "turn.commit";
    case "generation-bump": return "gen.bump";
    case "turn-open": return null;
  }
}

export function createTurnFuser({
  newId,
  joinWindowMs = 1500,
  penIdleMs = 800,
}: TurnFuseOptions): TurnFuser {
  if (!Number.isFinite(joinWindowMs) || joinWindowMs < 0 ||
      !Number.isFinite(penIdleMs) || penIdleMs < 0) {
    throw new Error("Turn fusion windows must be finite non-negative milliseconds");
  }

  let turn: Turn | null = null;
  let lastSeenAt: number | null = null;
  let ignored = 0;

  function deadline(current: Turn): number | null {
    if (current.speechActive || current.penDepth > 0) return null;
    const speech = current.lastSpeechStop;
    const pen = current.lastPenUp === null ? null : current.lastPenUp + penIdleMs;
    if (speech === null) return pen;
    if (pen === null) return speech;
    return Math.max(speech, pen);
  }

  function commitIfDue(at: number): FuseOutput[] {
    if (!turn || turn.committed) return [];
    const due = deadline(turn);
    if (due === null || at < due) return [];
    turn.committed = true;
    turn.committedAt = due;
    return [{
      kind: "commit",
      traceId: turn.traceId,
      generation: turn.generation,
      at: due,
      captureIds: [...turn.captureIds],
    }];
  }

  function openTurn(at: number, out: FuseOutput[]): Turn {
    const next: Turn = {
      traceId: newId(),
      generation: 0,
      speechActive: false,
      penDepth: 0,
      lastSpeechStop: null,
      lastPenUp: null,
      captureIds: [],
      committed: false,
      committedAt: null,
    };
    turn = next;
    out.push({ kind: "turn-open", traceId: next.traceId, generation: 0, at });
    return next;
  }

  function isRecent(at: number, origin: number | null, windowMs: number): boolean {
    return origin !== null && at >= origin && at - origin < windowMs;
  }

  function joinsPen(current: Turn, at: number): boolean {
    if (current.speechActive || current.penDepth > 0) return true;
    // A completed speech turn has the stricter speech-stop join boundary.
    if (current.committed) {
      // A recently committed pen capture stays refinable even when speech
      // ended much earlier; a speech-only commit still uses speech-stop time.
      return isRecent(at, current.lastSpeechStop, joinWindowMs) ||
        isRecent(at, current.committedAt, joinWindowMs);
    }
    return isRecent(at, current.lastSpeechStop, joinWindowMs) ||
      isRecent(at, current.lastPenUp, penIdleMs);
  }

  function joinsSpeech(current: Turn, at: number): boolean {
    if (current.committed) return isRecent(at, current.committedAt, joinWindowMs);
    return current.penDepth > 0 ||
      isRecent(at, current.lastPenUp, penIdleMs) ||
      isRecent(at, current.lastSpeechStop, joinWindowMs);
  }

  function refineIfCommitted(current: Turn, out: FuseOutput[]): void {
    if (!current.committed) return;
    current.generation += 1;
    current.committed = false;
    current.committedAt = null;
    current.lastSpeechStop = null;
    current.lastPenUp = null;
    current.captureIds = [];
    out.push({
      kind: "generation-bump",
      traceId: current.traceId,
      generation: current.generation,
    });
  }

  return {
    handle(event) {
      if (!Number.isFinite(event.at) ||
          (lastSeenAt !== null && event.at < lastSeenAt)) {
        ignored += 1;
        return [];
      }
      lastSeenAt = event.at;

      // An input arriving after the deadline must not silently discard the
      // previous uncommitted capture if the host skipped an explicit tick.
      const out = commitIfDue(event.at);

      if (event.type === "speech-start") {
        if (turn?.speechActive) return out;
        const current = turn && joinsSpeech(turn, event.at)
          ? turn : openTurn(event.at, out);
        refineIfCommitted(current, out);
        current.speechActive = true;
        current.lastSpeechStop = null;
        out.push({ kind: "floor", event: "speech-start", traceId: current.traceId });
        return out;
      }

      if (event.type === "speech-stop") {
        if (turn?.speechActive) {
          turn.speechActive = false;
          turn.lastSpeechStop = event.at;
          out.push({ kind: "floor", event: "speech-stop", traceId: turn.traceId });
        }
        return out;
      }

      if (event.type === "pen-down") {
        const joined = turn !== null && joinsPen(turn, event.at);
        const current = joined && turn ? turn : openTurn(event.at, out);
        refineIfCommitted(current, out);
        current.penDepth += 1;
        const captureId = newId();
        current.captureIds.push(captureId);
        out.push({ kind: "capture-open", captureId, traceId: current.traceId, joined });
        return out;
      }

      if (turn && turn.penDepth > 0) {
        turn.penDepth -= 1;
        if (turn.penDepth === 0) turn.lastPenUp = event.at;
      }
      return out;
    },

    tick(atMs) {
      if (!Number.isFinite(atMs) ||
          (lastSeenAt !== null && atMs < lastSeenAt)) return [];
      lastSeenAt = atMs;
      return commitIfDue(atMs);
    },

    state() {
      return {
        traceId: turn?.traceId ?? null,
        generation: turn?.generation ?? null,
        speechActive: turn?.speechActive ?? false,
        penDown: (turn?.penDepth ?? 0) > 0,
        captureIds: turn ? [...turn.captureIds] : [],
        lastSpeechStop: turn?.lastSpeechStop ?? null,
        lastPenUp: turn?.lastPenUp ?? null,
        pendingCommitAt: turn && !turn.committed ? deadline(turn) : null,
        committed: turn?.committed ?? false,
        lastCommitAt: turn?.committedAt ?? null,
        lastSeenAt,
        ignored,
      };
    },
  };
}
