import { describe, expect, test } from "bun:test";
import { createStore } from "./createStore";

describe("createStore state and listener lifecycle", () => {
  test("get returns the original value and set publishes before notifying", () => {
    type Snapshot = { count: number; label: string };
    const initial: Snapshot = { count: 0, label: "initial" };
    const store = createStore(initial);
    const observed: Snapshot[] = [];
    const unsubscribe = store.subscribe(() => {
      observed.push(store.get());
    });

    expect(store.get()).toBe(initial);

    const updated: Snapshot = { count: 1, label: "updated" };
    store.set(updated);

    expect(store.get()).toBe(updated);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(updated);
    unsubscribe();
  });

  test("functional set receives the latest state and a returned reference controls notification", () => {
    type Counter = { count: number };
    const initial: Counter = { count: 2 };
    const store = createStore(initial);
    const updaterInputs: Counter[] = [];
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    store.set((prev) => {
      updaterInputs.push(prev);
      return { count: prev.count + 1 };
    });
    const afterFirst = store.get();

    store.set((prev) => {
      updaterInputs.push(prev);
      return prev;
    });
    store.set((prev) => ({ count: prev.count + 1 }));

    expect(updaterInputs).toHaveLength(2);
    expect(updaterInputs[0]).toBe(initial);
    expect(updaterInputs[1]).toBe(afterFirst);
    expect(store.get()).toEqual({ count: 4 });
    expect(calls).toBe(2);
    unsubscribe();
  });

  test("identical references are no-ops but new equal-shaped objects notify", () => {
    const initial = { status: "idle" };
    const store = createStore(initial);
    const observed: Array<typeof initial> = [];
    const unsubscribe = store.subscribe(() => {
      observed.push(store.get());
    });

    store.set(initial);
    store.set((current) => current);

    expect(store.get()).toBe(initial);
    expect(observed).toHaveLength(0);

    const equivalent = { status: "idle" };
    store.set(equivalent);

    expect(store.get()).toBe(equivalent);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(equivalent);
    unsubscribe();
  });

  test("unsubscribing twice is safe and does not remove other listeners", () => {
    const store = createStore(0);
    const firstValues: number[] = [];
    const secondValues: number[] = [];
    const stopFirst = store.subscribe(() => {
      firstValues.push(store.get());
    });
    const stopSecond = store.subscribe(() => {
      secondValues.push(store.get());
    });

    store.set(1);
    stopFirst();
    stopFirst();
    store.set(2);
    stopSecond();
    stopSecond();
    store.set(3);

    expect(firstValues).toEqual([1]);
    expect(secondValues).toEqual([1, 2]);
    expect(store.get()).toBe(3);
  });

  test("store instances isolate values and subscriptions", () => {
    const left = createStore({ owner: "left", count: 0 });
    const right = createStore({ owner: "right", count: 0 });
    const leftSeen: number[] = [];
    const rightSeen: number[] = [];
    const stopLeft = left.subscribe(() => {
      leftSeen.push(left.get().count);
    });
    const stopRight = right.subscribe(() => {
      rightSeen.push(right.get().count);
    });

    left.set((previous) => ({ ...previous, count: 1 }));

    expect(left.get()).toEqual({ owner: "left", count: 1 });
    expect(right.get()).toEqual({ owner: "right", count: 0 });
    expect(leftSeen).toEqual([1]);
    expect(rightSeen).toEqual([]);

    right.set((previous) => ({ ...previous, count: 4 }));
    expect(leftSeen).toEqual([1]);
    expect(rightSeen).toEqual([4]);

    stopLeft();
    stopRight();
    left.set((previous) => ({ ...previous, count: 2 }));
    right.set((previous) => ({ ...previous, count: 5 }));
    expect(leftSeen).toEqual([1]);
    expect(rightSeen).toEqual([4]);
  });

  test("a listener can unsubscribe during delivery without receiving later updates", () => {
    const store = createStore(0);
    let calls = 0;
    let unsubscribe = () => {};
    unsubscribe = store.subscribe(() => {
      calls += 1;
      unsubscribe();
    });

    store.set(1);
    store.set(2);

    expect(calls).toBe(1);
    expect(store.get()).toBe(2);
  });

  test("repeated NaN snapshots do not notify when their value is unchanged", () => {
    const store = createStore(Number.NaN);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    store.set(Number.NaN);

    expect(Number.isNaN(store.get())).toBe(true);
    expect(calls).toBe(0);
    unsubscribe();
  });

  test("changing between positive and negative zero notifies snapshot subscribers", () => {
    const store = createStore(0);
    const observed: number[] = [];
    const unsubscribe = store.subscribe(() => {
      observed.push(store.get());
    });

    store.set(-0);
    expect(Object.is(store.get(), -0)).toBe(true);
    expect(observed).toHaveLength(1);
    expect(Object.is(observed[0], -0)).toBe(true);

    store.set(0);
    expect(observed).toHaveLength(2);
    expect(Object.is(observed[1], 0)).toBe(true);
    unsubscribe();
  });
});
