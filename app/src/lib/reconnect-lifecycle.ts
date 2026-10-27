/** Bounded PC bridge reconnect state; transport and clock are injected for deterministic tests. */
export const RECONNECT_BASE_MS = 500;
export const RECONNECT_CAP_MS = 30_000;
export const RECONNECT_HELLO_TIMEOUT_MS = 8_000;

export type ReconnectPhase = "idle" | "connecting" | "waiting" | "paused" | "online" | "blocked";

export interface ReconnectSnapshot {
  phase: ReconnectPhase;
  /** Consecutive failures since an authenticated bridge hello (capped for safe arithmetic). */
  failures: number;
  /** Generation of the current socket attempt. Stale socket callbacks must be ignored. */
  generation: number;
  nextAttemptAt: number | null;
  reason: string | undefined;
}

export interface ReconnectScheduler<Handle> {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): Handle;
  clearTimeout(handle: Handle): void;
}

export interface ReconnectDriver {
  /** Begin a new authenticated WebSocket attempt for this generation. */
  connect(generation: number): void;
  /** Retire the previous socket/async token resolution. */
  abort(generation: number): void;
  /** Called for each user-visible transition. */
  publish(state: ReconnectSnapshot): void;
}

export interface ReconnectController {
  start(foreground?: boolean): void;
  /** WebSocket OPEN is not an authenticated bridge hello and must not reset failures. */
  socketOpen(generation: number): void;
  authenticatedHello(generation: number): void;
  closed(generation: number, reason: string, retryable?: boolean): void;
  background(): void;
  foreground(): void;
  retry(): void;
  stop(): void;
  snapshot(): ReconnectSnapshot;
}

/** failuresBeforeRetry=0 -> 500ms; 1 -> 1s; 6+ -> capped 30s. */
export function reconnectDelayMs(failuresBeforeRetry: number): number {
  const exponent = Number.isFinite(failuresBeforeRetry)
    ? Math.min(6, Math.max(0, Math.floor(failuresBeforeRetry)))
    : 0;
  return Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** exponent);
}

export function createReconnectLifecycle<Handle>(
  scheduler: ReconnectScheduler<Handle>,
  driver: ReconnectDriver,
): ReconnectController {
  let active = true;
  let retryTimer: Handle | undefined;
  let helloTimer: Handle | undefined;
  let state: ReconnectSnapshot = {
    phase: "idle", failures: 0, generation: 0, nextAttemptAt: null, reason: undefined,
  };

  function emit(patch: Partial<ReconnectSnapshot>): void {
    state = { ...state, ...patch };
    driver.publish({ ...state });
  }

  function clearTimers(): void {
    if (retryTimer !== undefined) scheduler.clearTimeout(retryTimer);
    if (helloTimer !== undefined) scheduler.clearTimeout(helloTimer);
    retryTimer = undefined;
    helloTimer = undefined;
  }

  function beginAttempt(): void {
    if (state.phase === "idle") return;
    clearTimers();
    if (state.phase === "connecting" || state.phase === "online") driver.abort(state.generation);
    const generation = state.generation + 1;
    emit({ phase: "connecting", generation, nextAttemptAt: null });
    // This watchdog covers both TCP/WebSocket establishment AND the bridge hello.
    // A socket that opens but never authenticates cannot stay "connecting" forever.
    helloTimer = scheduler.setTimeout(() => {
      if (state.generation !== generation || state.phase !== "connecting") return;
      driver.abort(generation);
      fail(generation, "Timed out waiting for bridge hello", true);
    }, RECONNECT_HELLO_TIMEOUT_MS);
    try {
      driver.connect(generation);
    } catch (error) {
      fail(generation, error instanceof Error ? error.message : "Could not open bridge", true);
    }
  }

  function fail(generation: number, reason: string, retryable: boolean): void {
    if (generation !== state.generation ||
      (state.phase !== "connecting" && state.phase !== "online")) return;
    clearTimers();
    const failures = Math.min(7, state.failures + 1);
    const safeReason = reason.trim() || "PC bridge unavailable";
    if (!retryable) {
      emit({ phase: "blocked", failures, reason: safeReason, nextAttemptAt: null });
      return;
    }
    if (!active) {
      emit({ phase: "paused", failures, reason: safeReason, nextAttemptAt: null });
      return;
    }
    const delay = reconnectDelayMs(failures - 1);
    emit({ phase: "waiting", failures, reason: safeReason, nextAttemptAt: scheduler.now() + delay });
    retryTimer = scheduler.setTimeout(() => {
      if (state.generation !== generation || state.phase !== "waiting" || !active) return;
      beginAttempt();
    }, delay);
  }

  return {
    start(foreground = true): void {
      clearTimers();
      if (state.phase === "connecting" || state.phase === "online") driver.abort(state.generation);
      active = foreground;
      // Invalidate callbacks from an earlier pairing or a stopped instance.
      emit({ phase: foreground ? "waiting" : "paused", failures: 0, generation: state.generation + 1, nextAttemptAt: null, reason: undefined });
      if (foreground) beginAttempt();
    },
    socketOpen(_generation: number): void {
      // Do not reset backoff or cancel the hello watchdog on plain WS OPEN.
    },
    authenticatedHello(generation: number): void {
      if (generation !== state.generation || state.phase !== "connecting") return;
      clearTimers();
      emit({ phase: "online", failures: 0, nextAttemptAt: null, reason: undefined });
    },
    closed(generation: number, reason: string, retryable = true): void {
      fail(generation, reason, retryable);
    },
    background(): void {
      active = false;
      if (state.phase !== "waiting") return;
      clearTimers();
      emit({ phase: "paused", nextAttemptAt: null });
    },
    foreground(): void {
      if (active) return;
      active = true;
      // User is looking at Dash again: reconnect immediately, not after a stale timer.
      if (state.phase === "paused" || state.phase === "waiting" || state.phase === "connecting") beginAttempt();
    },
    retry(): void {
      if (state.phase === "idle" || state.phase === "online") return;
      active = true;
      emit({ failures: 0, reason: undefined });
      beginAttempt();
    },
    stop(): void {
      clearTimers();
      if (state.phase === "connecting" || state.phase === "online") driver.abort(state.generation);
      emit({ phase: "idle", failures: 0, generation: state.generation + 1, nextAttemptAt: null, reason: undefined });
    },
    snapshot(): ReconnectSnapshot {
      return { ...state };
    },
  };
}

export interface ReconnectPresentation {
  text: string;
  accessibilityLabel: string;
  action: "retry" | "pair";
  actionLabel: string;
}

/** Pure, accessible status copy. Rendering uses the existing OLED/cream glass primitives. */
export function reconnectPresentation(state: ReconnectSnapshot, now: number): ReconnectPresentation | null {
  switch (state.phase) {
    case "idle":
    case "online":
      return null;
    case "connecting": {
      const text = state.failures ? "Reconnecting to PC…" : "Connecting to PC…";
      return { text, accessibilityLabel: text + " Retry connection now.", action: "retry", actionLabel: "Retry now" };
    }
    case "waiting": {
      const seconds = Math.max(1, Math.ceil(((state.nextAttemptAt ?? now) - now) / 1000));
      const text = "PC unavailable · retrying in " + seconds + "s";
      return { text, accessibilityLabel: text + ". Retry connection now.", action: "retry", actionLabel: "Retry now" };
    }
    case "paused": {
      const text = "Offline · reconnects when Dash is active";
      return { text, accessibilityLabel: text + ". Retry connection now.", action: "retry", actionLabel: "Retry now" };
    }
    case "blocked": {
      const text = "Pairing required · " + (state.reason ?? "bridge rejected connection");
      return { text, accessibilityLabel: text + ". Review pairing.", action: "pair", actionLabel: "Pair again" };
    }
  }
}
