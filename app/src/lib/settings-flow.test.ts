import { describe, expect, test } from "bun:test";
import type { Connection, Settings } from "../model";
import { createStore } from "../store/createStore";
import { connectSettings } from "./settings-flow";

const settings: Settings = {
  address: "100.64.0.1:4747",
  token: "test-token",
  harness: "omp",
  cwd: "/work/dash",
  inAppFeedback: false,
};

function setup(initialSettings: Settings | null = null, status: Connection["status"] = "idle") {
  const store = createStore<{ settings: Settings | null; connection: Connection }>({
    settings: initialSettings,
    connection: { status, harnesses: [], hosts: [] },
  });
  const destinations: string[] = [];
  const started: Settings[] = [];
  const firstRun = store.get().settings === null;
  const save = (next: Settings) => store.set((state) => ({ ...state, settings: next }));
  const start = (next: Settings) => {
    started.push(next);
    store.set((state) => ({ ...state, connection: { ...state.connection, status: "connecting" } }));
  };
  const connect = (options?: { timeoutMs?: number; signal?: AbortSignal }) => connectSettings({
    settings,
    connection: store,
    save,
    start,
    onConnected: () => destinations.push(firstRun ? "Main" : "back"),
    ...options,
  });
  return { store, destinations, started, connect };
}

describe("saving bridge settings", () => {
  test("first-run setup saves immediately and enters Main only after the bridge answers", async () => {
    const flow = setup();
    const pending = flow.connect();
    expect(flow.store.get().settings).toEqual(settings);
    expect(flow.started).toEqual([settings]);
    expect(flow.destinations).toEqual([]);
    flow.store.set((state) => ({ ...state, connection: { ...state.connection, status: "online" } }));
    await pending;
    expect(flow.destinations).toEqual(["Main"]);
  });

  test("an old online connection cannot finish a reconnect before the new bridge answers", async () => {
    const flow = setup({ ...settings, address: "old-host:4747" }, "online");
    const pending = flow.connect();
    await Promise.resolve();
    expect(flow.destinations).toEqual([]);
    flow.store.set((state) => ({ ...state, connection: { ...state.connection, status: "online" } }));
    await pending;
    expect(flow.destinations).toEqual(["back"]);
  });

  test("rejected tokens leave setup open with the bridge's reason", async () => {
    const flow = setup();
    const pending = flow.connect();
    flow.store.set((state) => ({ ...state, connection: { ...state.connection, status: "offline", error: "Bridge rejected the token" } }));
    await expect(pending).rejects.toThrow("Bridge rejected the token");
    expect(flow.destinations).toEqual([]);
  });

  test("a timeout leaves setup open", async () => {
    const flow = setup();
    await expect(flow.connect({ timeoutMs: 5 })).rejects.toThrow("Timed out connecting to the bridge");
    expect(flow.destinations).toEqual([]);
  });

  test("leaving setup cancels its pending navigation", async () => {
    const flow = setup();
    const controller = new AbortController();
    const pending = flow.connect({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("Connection cancelled");
    flow.store.set((state) => ({ ...state, connection: { ...state.connection, status: "online" } }));
    expect(flow.destinations).toEqual([]);
  });

  test("a synchronous bridge hello still completes setup", async () => {
    const flow = setup();
    await connectSettings({
      settings,
      connection: flow.store,
      save: (next) => flow.store.set((state) => ({ ...state, settings: next })),
      start: () => flow.store.set((state) => ({ ...state, connection: { ...state.connection, status: "online" } })),
      onConnected: () => flow.destinations.push("Main"),
    });
    expect(flow.destinations).toEqual(["Main"]);
  });
});
