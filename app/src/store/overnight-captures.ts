import AsyncStorage from "@react-native-async-storage/async-storage";
import { addCapture, CAPTURE_DEDUPE_MS, dismiss, markPlanned, morningList, parseCaptures, type Capture } from "../../../shared/overnight-captures";
import { createStore } from "./createStore";

/**
 * Bedtime capture queue (#375/#413): thoughts saved for tomorrow instead of being sent to an agent.
 * Local to this phone, persisted in device storage, never an agent turn. A capture only reaches an
 * agent when the owner later taps Use on it and then sends the draft himself.
 */
const KEY = "dash.overnightCaptures.v1";
/** Morning list window: captures older than this are not offered again. */
export const MORNING_WINDOW_MS = 24 * 3600 * 1000;

export const overnightCaptures = createStore<readonly Capture[]>([]);
let seq = 0;
let inFlight: Promise<void> = Promise.resolve();
let restoreFailed = false;

const restored: Promise<void> = AsyncStorage.getItem(KEY).then(raw => {
  if (!raw) return;
  const stored = parseCaptures(JSON.parse(raw));
  // A capture made before the read finished must survive the restore.
  overnightCaptures.set(current => [...stored.filter(item => !current.some(c => c.id === item.id)), ...current]);
}).catch(() => { restoreFailed = true; });

function change(update: (queue: readonly Capture[]) => readonly Capture[]): Promise<readonly Capture[]> {
  // Serialize the entire read-modify-write, not just the storage writes.
  const task = inFlight.then(async () => {
    await restored;
    if (restoreFailed) throw new Error("Cannot restore overnight captures");
    const previous = overnightCaptures.get();
    const next = update(previous);
    if (next === previous) return previous;
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    overnightCaptures.set(next);
    return next;
  });
  inFlight = task.then(() => undefined, () => undefined);
  return task;
}

/**
 * Save a thought for tomorrow. Resolves true only once it is in device storage, so the caller may
 * clear the draft; false (nothing saved, or storage failed) means the draft must stay.
 */
export async function captureForTomorrow(text: string, conversationId: string | undefined, attachments = 0, now = Date.now()): Promise<boolean> {
  try {
    let saved = false;
    await change(queue => {
      const input = { text, ...(conversationId === undefined ? {} : { conversationId }), attachments };
      let id: string;
      do { id = `cap-${now.toString(36)}-${(++seq).toString(36)}`; }
      while (queue.some(item => item.id === id));

      const next = addCapture(queue, input, now, () => id);
      if (next !== queue) { saved = true; return next; }

      // Only acknowledge a persisted, equivalent queued duplicate. The pure
      // helper also rejects cross-conversation and planned/dismissed repeats.
      const normalized = addCapture([], input, now, () => id)[0];
      saved = normalized !== undefined && queue.some(item =>
        item.text === normalized.text
        && item.conversationId === normalized.conversationId
        && item.attachments === normalized.attachments
        && item.status === "queued"
        && now >= item.capturedAt
        && now - item.capturedAt <= CAPTURE_DEDUPE_MS);
      return queue;
    });
    return saved;
  } catch {
    return false;
  }
}

/** Queued captures for one conversation (or the unassigned ones), oldest first. */
export function capturesFor(queue: readonly Capture[], conversationId: string | undefined, now: number): readonly Capture[] {
  return morningList(queue, now - MORNING_WINDOW_MS).find(group => group.conversationId === conversationId)?.captures ?? [];
}

/** The owner picked this capture up: it leaves the morning list. */
export function planCapture(id: string): Promise<readonly Capture[]> {
  return change(queue => markPlanned(queue, [id]));
}

export function dismissCapture(id: string): Promise<readonly Capture[]> {
  return change(queue => dismiss(queue, id));
}
