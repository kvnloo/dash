import type { Store } from "../../store/createStore";
import { type Drawing, type Stroke, type StrokePoint } from "./strokes";

export interface InkStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  onBackground(flush: () => void): () => void;
  onError?(error: unknown): void;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function point(value: unknown): value is StrokePoint {
  return record(value) && finite(value.x) && finite(value.y) && finite(value.p) && finite(value.t);
}
function stroke(value: unknown): value is Stroke {
  return record(value) && finite(value.id) && Number.isSafeInteger(value.id) && value.id > 0 &&
    (value.tool === "pen" || value.tool === "highlighter" || value.tool === "arrow" || value.tool === "box" || value.tool === "circle") &&
    (value.color === "accent" || value.color === "red") &&
    (value.pointer === "stylus" || value.pointer === "touch" || value.pointer === "mouse" || value.pointer === "other") &&
    finite(value.startedAt) && finite(value.endedAt) && Array.isArray(value.points) && value.points.length >= 2 && value.points.every(point) &&
    (value.targets === undefined || (Array.isArray(value.targets) && value.targets.every((target: unknown) => typeof target === "string")));
}
export function parseInkDraft(raw: string): Drawing | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || !Array.isArray(value.strokes) || !value.strokes.every(stroke) ||
        !finite(value.nextId) || !Number.isSafeInteger(value.nextId) || value.nextId < 1) return null;
    const strokes: Stroke[] = value.strokes;
    const nextId = value.nextId;
    if (strokes.some(item => item.id >= nextId) || new Set(strokes.map(item => item.id)).size !== strokes.length) return null;
    return { strokes, nextId: value.nextId, past: [] };
  } catch { return null; }
}

/** Commit locally first; serialized device writes run in microtasks, never awaited by input. */
export function attachInkPersistence<T extends { drawing: Drawing }>(store: Store<T>, storage: InkStorage) {
  let previous = store.get().drawing;
  let changed = false, disposed = false, restoring = false, ready = false;
  let pending = Promise.resolve();
  function flush(): Promise<void> {
    // Background/unmount can precede the initial read. Never persist the empty startup state over it.
    if (!ready) return restored.then(() => disposed && !changed ? undefined : flush());
    const drawing = store.get().drawing;
    const raw = JSON.stringify({ strokes: drawing.strokes, nextId: drawing.nextId });
    pending = pending.then(() => storage.write(raw)).catch(error => { storage.onError?.(error); });
    return pending;
  }
  const unsubscribe = store.subscribe(() => {
    const next = store.get().drawing;
    if (next === previous) return;
    previous = next;
    if (restoring) return;
    changed = true;
    void flush();
  });
  const offBackground = storage.onBackground(() => { void flush(); });
  const restored = storage.read().then(raw => {
    if (!raw || changed || disposed) return;
    const drawing = parseInkDraft(raw);
    if (!drawing) return;
    restoring = true;
    store.set(s => ({ ...s, drawing }));
    restoring = false;
  }).catch(error => { storage.onError?.(error); }).finally(() => { ready = true; });
  return {
    restored, flush,
    dispose() { disposed = true; unsubscribe(); offBackground(); return flush(); },
  };
}
