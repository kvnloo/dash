/**
 * Bridge acknowledgement deadline tracking. A successful WebSocket.send is not
 * an acknowledgement: only an authenticated matching bridge receipt can call ack().
 *
 * No network or persistence side effects. Hermes owns durable outbox/UI wiring.
 */
export const ACK_TIMEOUT_MS = 10_000;
export const NOT_SENT_RETRY_LABEL = "Not sent · Retry";
export const DELIVERY_OUTCOME_UNCONFIRMED =
  "Delivery unconfirmed. The bridge may have received this turn; retry with the same identity.";

export interface DeliveryDeadlineClock {
  now(): number;
  /** Schedule a callback and return a cancellation function. */
  setTimer(callback: () => void, delayMs: number): () => void;
}

export type DeliveryDeadlineEvent =
  | { type: "waiting-for-ack"; id: string; generation: number; deadlineAt: number }
  | {
      type: "retry-needed";
      id: string;
      generation: number;
      reason: "ack-timeout" | "socket-drop";
      label: typeof NOT_SENT_RETRY_LABEL;
      explanation: typeof DELIVERY_OUTCOME_UNCONFIRMED;
    }
  | { type: "acknowledged"; id: string; generation: number };

export interface DeliveryDeadlineOptions {
  clock?: DeliveryDeadlineClock;
  /** Product default is 10 seconds, not a measured bridge SLA. */
  timeoutMs?: number;
}

interface PendingAck {
  id: string;
  generation: number;
  deadlineAt: number;
  cancelTimer?: () => void;
  retryNeeded: boolean;
}

const systemClock: DeliveryDeadlineClock = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};

/**
 * A generation belongs to one socket instance. Pass its value back to every
 * send/ack/drop, so callbacks from an old socket cannot affect a new attempt.
 */
export class DeliveryDeadlineController {
  private readonly clock: DeliveryDeadlineClock;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, PendingAck>();
  private generation = 0;
  private connected = false;
  private disposed = false;

  constructor(
    private readonly emit: (event: DeliveryDeadlineEvent) => void,
    options: DeliveryDeadlineOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    this.timeoutMs = options.timeoutMs ?? ACK_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Delivery ack timeout must be a finite positive number");
    }
  }

  /** Create a new socket epoch. Abandon old timers without auto-retrying. */
  beginGeneration(): number {
    if (this.disposed) throw new Error("Delivery deadline controller disposed");
    if (this.generation !== 0) this.disconnect(this.generation);
    for (const entry of this.pending.values()) entry.cancelTimer?.();
    this.pending.clear();
    this.generation += 1;
    this.connected = true;
    return this.generation;
  }

  /**
   * Record an actual successful socket send (never just a queued intent).
   * Re-sending the same id resets its deadline, without changing its identity.
   */
  trackSent(id: string, generation: number): boolean {
    if (this.disposed || !this.connected || generation !== this.generation || !id.trim()) return false;
    this.pending.get(id)?.cancelTimer();
    const entry: PendingAck = {
      id,
      generation,
      deadlineAt: this.clock.now() + this.timeoutMs,
      retryNeeded: false,
    };
    this.pending.set(id, entry);
    entry.cancelTimer = this.clock.setTimer(() => this.onDeadline(entry), this.timeoutMs);
    this.emit({ type: "waiting-for-ack", id, generation, deadlineAt: entry.deadlineAt });
    return true;
  }

  /**
   * Call only after authenticating and matching the receipt's client/turn id.
   * A late acknowledgement can reconcile a previously unconfirmed delivery.
   */
  ack(id: string, generation: number): boolean {
    if (this.disposed || generation !== this.generation) return false;
    const entry = this.pending.get(id);
    if (!entry || entry.generation !== generation) return false;
    entry.cancelTimer?.();
    this.pending.delete(id);
    this.emit({ type: "acknowledged", id, generation });
    return true;
  }

  /** A dropped socket makes every remaining outcome unconfirmed immediately. */
  disconnect(generation: number): void {
    if (this.disposed || generation !== this.generation || !this.connected) return;
    this.connected = false;
    for (const entry of this.pending.values()) {
      if (entry.generation !== generation) continue;
      entry.cancelTimer?.();
      this.reportRetryNeeded(entry, "socket-drop");
    }
  }

  /** Stable snapshot for reconciling with the durable outbox. */
  pendingIds(): string[] {
    return [...this.pending.keys()];
  }

  /** Cancels timers and callbacks; safe to call repeatedly. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.connected = false;
    for (const entry of this.pending.values()) entry.cancelTimer?.();
    this.pending.clear();
  }

  private onDeadline(entry: PendingAck): void {
    if (
      this.disposed ||
      !this.connected ||
      entry.generation !== this.generation ||
      this.pending.get(entry.id) !== entry ||
      entry.retryNeeded
    ) return;

    // Defend against an early timer: the injected clock owns the deadline.
    entry.cancelTimer?.();
    const remaining = entry.deadlineAt - this.clock.now();
    if (remaining > 0) {
      entry.cancelTimer = this.clock.setTimer(() => this.onDeadline(entry), remaining);
      return;
    }
    this.reportRetryNeeded(entry, "ack-timeout");
  }

  private reportRetryNeeded(entry: PendingAck, reason: "ack-timeout" | "socket-drop"): void {
    if (entry.retryNeeded) return;
    entry.retryNeeded = true;
    this.emit({
      type: "retry-needed",
      id: entry.id,
      generation: entry.generation,
      reason,
      label: NOT_SENT_RETRY_LABEL,
      explanation: DELIVERY_OUTCOME_UNCONFIRMED,
    });
  }
}
