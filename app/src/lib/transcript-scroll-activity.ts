/**
 * Transcript gesture phase only: scroll offsets never enter React state.
 *
 * React subscribers are notified at most on transitions between zero and one
 * active scroll scopes, not for native frames, duplicate drag events or a
 * second simultaneously scrolling window. ShimmerText suspends its Skia sweep
 * while a transcript is in motion without unmounting the painted text.
 */
export class TranscriptScrollActivity {
  private readonly scopes = new Set<string>();
  private readonly listeners = new Set<() => void>();

  /** Stable callbacks can be passed directly to React.useSyncExternalStore. */
  readonly subscribe = (notify: () => void): (() => void) => {
    this.listeners.add(notify);
    return () => { this.listeners.delete(notify); };
  };

  readonly getSnapshot = (): boolean => this.scopes.size > 0;
  readonly getServerSnapshot = (): boolean => false;

  /** Call at the start of native drag or momentum, never from onScroll. */
  begin(scope: string): void {
    if (!scope || this.scopes.has(scope)) return;
    const wasIdle = this.scopes.size === 0;
    this.scopes.add(scope);
    if (wasIdle) this.publish();
  }

  /** Call after drag without momentum, after momentum, and on unmount. */
  end(scope: string): void {
    if (!this.scopes.delete(scope)) return;
    if (this.scopes.size === 0) this.publish();
  }

  private publish(): void {
    for (const notify of this.listeners) notify();
  }
}

export const transcriptScrollActivity = new TranscriptScrollActivity();
