import { expect, test } from "bun:test";
import { createStore } from "../../store/createStore";
import { EMPTY_DRAWING, addStroke, type Stroke } from "./strokes";
import { attachInkPersistence, parseInkDraft } from "./ink-persistence";

const stroke = { tool: "pen", color: "accent", pointer: "stylus", points: [{ x: 0.1, y: 0.2, p: 0.4, t: 1760000000000 }, { x: 0.7, y: 0.8, p: 0.8, t: 1760000000020 }] } satisfies Parameters<typeof addStroke>[1];
function state() { return createStore({ active: false, drawing: EMPTY_DRAWING }); }

test("L3: pen lift persists the committed draft; mode/back/background and cold start never lose it", async () => {
  let saved: string | null = null;
  let background = () => {};
  const storage = { read: async () => saved, write: async (value: string) => { saved = value; }, onBackground: (fn: () => void) => { background = fn; return () => {}; } };
  const store = state();
  const runtime = attachInkPersistence(store, storage);
  await runtime.restored;
  store.set(s => ({ ...s, active: true, drawing: addStroke(s.drawing, stroke) }));
  const committed = store.get().drawing;
  store.set(s => ({ ...s, active: false }));
  background(); await runtime.flush();
  expect(store.get().drawing).toBe(committed);
  expect(saved).not.toBeNull();
  runtime.dispose();
  const cold = state();
  const reload = attachInkPersistence(cold, storage);
  await reload.restored;
  expect(cold.get().active).toBe(false);
  expect(cold.get().drawing.strokes).toEqual(committed.strokes);
  expect(cold.get().drawing.nextId).toBe(2);
  // Re-entering annotation and undoing a committed stroke also survives a restart.
  cold.set(s => ({ ...s, active: true, drawing: { ...s.drawing, strokes: [] } }));
  await reload.flush(); reload.dispose();
  const empty = state(); const last = attachInkPersistence(empty, storage); await last.restored;
  expect(empty.get().drawing.strokes).toEqual([]); last.dispose();
});

test("L3: a slow restore never replaces fresh pen-up ink, and writes cannot race backwards", async () => {
  let finishRead: (value: string | null) => void = () => {};
  const pendingRead = new Promise<string | null>(resolve => { finishRead = resolve; });
  let saved = "";
  const store = state();
  const runtime = attachInkPersistence(store, { read: () => pendingRead, write: async value => { await Promise.resolve(); saved = value; }, onBackground: () => () => {} });
  store.set(s => ({ ...s, drawing: addStroke(s.drawing, stroke) }));
  finishRead(JSON.stringify({ strokes: [], nextId: 99 }));
  await runtime.restored;
  store.set(s => ({ ...s, drawing: addStroke(s.drawing, stroke) }));
  await runtime.flush();
  const cold = state(); const reloaded = attachInkPersistence(cold, { read: async () => saved, write: async () => {}, onBackground: () => () => {} });
  await reloaded.restored;
  expect(cold.get().drawing.strokes).toHaveLength(2);
  expect(cold.get().drawing.nextId).toBe(3);
  runtime.dispose(); reloaded.dispose();
});

test("L3: background during cold restore cannot overwrite saved ink with an empty draft", async () => {
  const drawing = addStroke(EMPTY_DRAWING, stroke);
  let saved = JSON.stringify({ strokes: drawing.strokes, nextId: drawing.nextId });
  let finishRead: () => void = () => {};
  const reading = new Promise<void>(resolve => { finishRead = resolve; });
  let background = () => {};
  const store = state();
  const runtime = attachInkPersistence(store, {
    read: async () => { await reading; return saved; },
    write: async value => { saved = value; },
    onBackground: flush => { background = flush; return () => {}; },
  });
  background();
  await Promise.resolve(); await Promise.resolve();
  expect(JSON.parse(saved).strokes).toHaveLength(1);
  finishRead(); await runtime.restored; await runtime.flush();
  expect(store.get().drawing.strokes).toEqual(drawing.strokes);
  await runtime.dispose();
});

test("L3: stored ink validates every stroke field and restores all supported tools and pointers", () => {
  const committed = addStroke(EMPTY_DRAWING, stroke).strokes[0]!;
  const parse = (value: unknown) => parseInkDraft(JSON.stringify({ strokes: [value], nextId: 2 }));
  const tools: Stroke["tool"][] = ["pen", "highlighter", "arrow", "box", "circle"];
  const pointers: Stroke["pointer"][] = ["stylus", "touch", "mouse", "other"];
  const colors: Stroke["color"][] = ["accent", "red"];
  for (const tool of tools) {
    for (const pointer of pointers) {
      for (const color of colors) {
        expect(parse({ ...committed, tool, pointer, color, targets: ["title"] })?.strokes[0]).toEqual({ ...committed, tool, pointer, color, targets: ["title"] });
      }
    }
  }
  for (const invalid of [null, [], 1, "pen", {},
    { ...committed, id: 0 }, { ...committed, id: 1.2 }, { ...committed, id: "1" },
    { ...committed, tool: "invalid" }, { ...committed, color: "blue" }, { ...committed, pointer: "invalid" },
    { ...committed, startedAt: null }, { ...committed, endedAt: "yesterday" },
    { ...committed, points: [] }, { ...committed, points: [stroke.points[0]] },
    { ...committed, points: [null, null] },
    ...["x", "y", "p", "t"].map(key => ({ ...committed, points: [{ ...stroke.points[0], [key]: "invalid" }, stroke.points[1]] })),
    { ...committed, targets: "title" }, { ...committed, targets: [42] },
  ]) expect(parse(invalid)).toBeNull();
  expect(parse(committed)?.strokes).toEqual([committed]);
});

test("L3: malformed persisted strokes are not admitted", async () => {
  for (const raw of ["not json", "null", '{"strokes":[{}],"nextId":2}', '{"strokes":[],"nextId":0}']) {
    const store = state(); const runtime = attachInkPersistence(store, { read: async () => raw, write: async () => {}, onBackground: () => () => {} });
    await runtime.restored; expect(store.get().drawing).toEqual(EMPTY_DRAWING); runtime.dispose();
  }
});
