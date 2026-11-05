import { createStore } from "../store/createStore";

/**
 * Dash-owned, platform-independent dialog requests.
 * The host renders dialogStore.current and calls resolveCurrent on button/backdrop/Back.
 * Requests coalesce by title + message, including requests waiting behind the active one.
 * The first request's buttons are canonical when callers share that key.
 */
export type DialogButtonRole = "default" | "cancel" | "destructive";

export interface DialogButton {
  readonly id: string;
  readonly label: string;
  readonly role: DialogButtonRole;
}

export interface DialogRequest {
  readonly title: string;
  readonly message?: string;
  readonly buttons: readonly DialogButton[];
}

export interface DialogView {
  readonly title: string;
  readonly message?: string;
  readonly buttons: readonly DialogButton[];
}

export interface DialogState {
  readonly current: DialogView | null;
}

interface PendingDialog {
  readonly key: string;
  readonly view: DialogView;
  readonly settlers: Array<(selectedId: string | null) => void>;
}

const state = createStore<DialogState>({ current: null });
const queue: PendingDialog[] = [];
let active: PendingDialog | null = null;

/** Read-only store surface: callers cannot replace a pending dialog or strand promises. */
export const dialogStore = {
  get: state.get,
  subscribe: state.subscribe,
  use: state.use,
};

function snapshotRequest(request: DialogRequest): DialogView {
  const source: readonly DialogButton[] = request.buttons.length > 0
    ? request.buttons
    : [{ id: "ok", label: "OK", role: "default" }];

  const seenIds = new Set<string>();
  let hasCancel = false;
  const buttons: DialogButton[] = [];

  for (const button of source) {
    if (!button.id.trim() || !button.label.trim()) {
      throw new Error("Dialog button ids and labels must not be empty");
    }
    if (seenIds.has(button.id)) {
      throw new Error("Dialog button ids must be unique");
    }
    if (button.role !== "default" && button.role !== "cancel" && button.role !== "destructive") {
      throw new Error("Unsupported dialog button role");
    }
    if (button.role === "cancel") {
      if (hasCancel) throw new Error("A dialog can have at most one cancel button");
      hasCancel = true;
    }
    seenIds.add(button.id);
    buttons.push(Object.freeze({ id: button.id, label: button.label, role: button.role }));
  }

  return Object.freeze({
    title: request.title,
    message: request.message,
    buttons: Object.freeze(buttons),
  });
}

function samePromptKey(view: DialogView): string {
  return JSON.stringify([view.title, view.message ?? null]) ?? "";
}

/**
 * Enqueue a prompt or join the first pending prompt with the same title/message.
 * Errors in button definitions throw synchronously without changing the queue.
 */
export function showDialog(request: DialogRequest): Promise<string | null> {
  const view = snapshotRequest(request);
  const key = samePromptKey(view);

  return new Promise<string | null>(resolve => {
    const existing = active?.key === key ? active : queue.find(item => item.key === key);
    if (existing) {
      existing.settlers.push(resolve);
      return;
    }

    const pending: PendingDialog = { key, view, settlers: [resolve] };
    if (active !== null) {
      queue.push(pending);
      return;
    }

    active = pending;
    state.set({ current: view });
  });
}

/**
 * Settle only a button that belongs to the visible request.
 * Dismissal (Android Back, escape, backdrop) returns its cancel id, or null.
 * Unknown/stale button ids do not advance the queue.
 */
export function resolveCurrent(id: string | null): boolean {
  if (active === null) return false;
  const current = active;
  const selected = id === null
    ? current.view.buttons.find(button => button.role === "cancel")?.id ?? null
    : current.view.buttons.find(button => button.id === id)?.id;

  if (id !== null && selected === undefined) return false;

  active = queue.shift() ?? null;
  state.set({ current: active?.view ?? null });

  for (const settle of current.settlers) settle(selected ?? null);
  return true;
}

/** A single-action acknowledgement. */
export function alertDialog(title: string, message?: string): Promise<string | null> {
  return showDialog({ title, message, buttons: [] });
}

/**
 * Return true only for this particular action, not for cancel/dismiss/another
 * coalesced confirmation. Action-derived ids prevent different button labels
 * on an otherwise identical prompt from being mistaken for consent.
 */
export function confirmDialog(
  title: string,
  message: string,
  action: string,
  options: { readonly destructive?: boolean } = {},
): Promise<boolean> {
  const actionId = "action:" + action;
  return showDialog({
    title,
    message,
    buttons: [
      { id: "cancel", label: "Cancel", role: "cancel" },
      { id: actionId, label: action, role: options.destructive ? "destructive" : "default" },
    ],
  }).then(selected => selected === actionId);
}
