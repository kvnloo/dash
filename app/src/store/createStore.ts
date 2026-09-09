import { useSyncExternalStore } from "react";

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
  /** Subscribe a component to a slice. The selector must return stable references for unchanged data. */
  use<U>(selector: (state: T) => U): U;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const get = () => state;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    get,
    subscribe,
    set(next) {
      const value = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
      if (value === state) return;
      state = value;
      for (const listener of listeners) listener();
    },
    use<U>(selector: (s: T) => U): U {
      return useSyncExternalStore(
        subscribe,
        () => selector(state),
        () => selector(state),
      );
    },
  };
}
