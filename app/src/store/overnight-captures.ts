import AsyncStorage from "@react-native-async-storage/async-storage";
import { addCapture, dismiss, markPlanned, morningList, parseCaptures, type Capture } from "../../../shared/overnight-captures";
import { createStore } from "./createStore";

/**
 * Bedtime capture queue (#375/#413): thoughts saved for tomorrow instead of being sent to an agent.
 * Local to this phone, persisted in device storage, never an agent turn. A capture only reaches an
 * agent when the owner later taps Use on it and then sends the draft himself.
 */
const KEY = "dash.overnightCaptures.v1";
/** Morning list window: captures older than this are not offered again. */
export const MORNING_WINDOW_MS = 36 * 3600 * 1000;

export const overnightCaptures = createStore<readonly Capture[]>([]);
let seq = 0;
let inFlight: Promise<void> = Promise.resolve();

const restored: Promise<void> = AsyncStorage.getItem(KEY).then(raw => {
  if (!raw) return;
  const stored = parseCaptures(JSON.parse(raw));
  // A capture made before the read finished must survive the restore.
  overnightCaptures.set(current => [...stored.filter(item => !current.some(c => c.id === item.id)), ...current]);
}).catch(() => undefined);

function persist(queue: readonly Capture[]): Promise<void> {
  const value = JSON.stringify(queue);
  const task = inFlight.catch(() => undefined).then(() => AsyncStorage.setItem(KEY, value));
  inFlight = task;
  return task;
}

async function change(update: (queue: readonly Capture[]) => readonly Capture[]): Promise<readonly Capture[]> {
  await restored;
  const previous = overnightCaptures.get();
  const next = update(previous);
  if (next === previous) return previous;
  overnightCaptures.set(next);
  await persist(next);
  return next;
}

/**
 * Save a thought for tomorrow. Resolves true only once it is in device storage, so the caller may
 * clear the draft; false (nothing saved, or storage failed) means the draft must stay.
 */
export async function captureForTomorrow(text: string, conversationId: string | undefined, attachments = 0, now = Date.now()): Promise<boolean> {
  const id = `cap-${now.toString(36)}-${(++seq).toString(36)}`;
  try {
    const before = overnightCaptures.get();
    const after = await change(queue => addCapture(queue, { text, ...(conversationId ? { conversationId } : {}), attachments }, now, () => id));
    // A duplicate within the dedupe window is already saved: the draft can clear.
    return after !== before || after.some(item => item.text === text.trim() && item.status !== "dismissed");
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
