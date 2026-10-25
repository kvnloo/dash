import { createStore } from "./createStore";
import type { ReconnectSnapshot } from "../lib/reconnect-lifecycle";

/**
 * Isolated UI/transport seam. Hermes publishes controller snapshots here from
 * the bridge, while ReconnectNotice subscribes without changing app's hot store.
 */
export const reconnectStore = createStore<ReconnectSnapshot>({
  phase: "idle",
  failures: 0,
  generation: 0,
  nextAttemptAt: null,
  reason: undefined,
});
