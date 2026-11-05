import { useCallback, useRef, useSyncExternalStore } from "react";

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
  /** Subscribe a component to a slice. The selector must return stable references for unchanged data. */
  use<U>(selector: (state: T) => U): U;
  /**
   * Subscribe a component to a derived slice. The component re-renders only when `isEqual`
   * says the newly selected value differs from the last one it rendered.
   */
  useSelector<U>(selector: (state: T) => U, isEqual?: (a: U, b: U) => boolean): U;
}

/**
 * A selection that returns the previous value while `isEqual` holds, so a fresh array or object
 * with the same content keeps its identity. Pure; `useSelector` holds one per component.
 */
export function memoSelection<T, U>(isEqual: (a: U, b: U) => boolean = Object.is): (state: T, selector: (state: T) => U) => U {
  let last: { value: U } | undefined;
  return (state, selector) => {
    const next = selector(state);
    if (last && isEqual(last.value, next)) return last.value;
    last = { value: next };
    return next;
  };
}

/** Element-wise identity comparison for selected arrays. */
export function shallowArrayEqual<V>(a: readonly V[], b: readonly V[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
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
    useSelector<U>(selector: (s: T) => U, isEqual: (a: U, b: U) => boolean = Object.is): U {
      const select = useRef<ReturnType<typeof memoSelection<T, U>> | null>(null);
      select.current ??= memoSelection<T, U>(isEqual);
      const latest = useRef(selector);
      latest.current = selector;
      const snapshot = useCallback(() => (select.current ?? memoSelection<T, U>(isEqual))(state, latest.current), [isEqual]);
      return useSyncExternalStore(subscribe, snapshot, snapshot);
    },
  };
}
