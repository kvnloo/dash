/**
 * Latest-wins guard for typed-ahead requests. `next()` aborts the previous request and bumps the
 * sequence; a response may be applied only while its ticket is still current.
 */
export interface RequestTicket {
  seq: number;
  signal: AbortSignal;
  isCurrent(): boolean;
}

export interface RequestGuard {
  readonly current: number;
  next(): RequestTicket;
  /** Abort the in-flight request and invalidate every ticket. */
  cancel(): void;
}

export function createRequestGuard(makeController: () => AbortController = () => new AbortController()): RequestGuard {
  let seq = 0;
  let controller: AbortController | null = null;
  return {
    get current() { return seq; },
    next() {
      controller?.abort();
      controller = makeController();
      seq += 1;
      const mine = seq;
      return { seq: mine, signal: controller.signal, isCurrent: () => mine === seq };
    },
    cancel() {
      controller?.abort();
      controller = null;
      seq += 1;
    },
  };
}
