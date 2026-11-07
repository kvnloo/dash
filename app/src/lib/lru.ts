/** Map-based LRU with optional TTL. `get` refreshes recency; expired entries read as missing. */
export interface LruOptions {
  maxEntries: number;
  /** Entries older than this (since `set`) are dropped on read. Omit for no expiry. */
  ttlMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Called for every entry that leaves through eviction or expiry (not `delete`/`clear`). */
  onEvict?: (key: string) => void;
}

export class LRU<V> {
  private readonly map = new Map<string, { value: V; at: number }>();
  private readonly max: number;
  private readonly ttl: number | undefined;
  private readonly now: () => number;
  private readonly onEvict: ((key: string) => void) | undefined;

  constructor(options: LruOptions) {
    this.max = Math.max(1, Math.floor(options.maxEntries));
    this.ttl = options.ttlMs;
    this.now = options.now ?? Date.now;
    this.onEvict = options.onEvict;
  }

  get size(): number { return this.map.size; }

  private expired(at: number): boolean {
    return this.ttl !== undefined && this.now() - at >= this.ttl;
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.expired(entry.at)) {
      this.map.delete(key);
      this.onEvict?.(key);
      return undefined;
    }
    // Re-insert: Map iteration order is insertion order, so the tail is the most recent.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /** Read without touching recency. */
  peek(key: string): V | undefined {
    const entry = this.map.get(key);
    return entry && !this.expired(entry.at) ? entry.value : undefined;
  }

  has(key: string): boolean { return this.peek(key) !== undefined; }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, at: this.now() });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
      this.onEvict?.(oldest.value);
    }
  }

  delete(key: string): boolean { return this.map.delete(key); }
  clear(): void { this.map.clear(); }
  /** Least recent first. */
  keys(): string[] { return [...this.map.keys()]; }
}
