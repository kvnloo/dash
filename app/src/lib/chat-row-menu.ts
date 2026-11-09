/**
 * Pure long-press options for a Chats row.
 * Callers must resolve the selected conversation id against current rows
 * before dispatching an option; these descriptors never execute actions.
 */
export type RowMenuOptionId =
  | "open"
  | "open-window"
  | "copy-session-id"
  | "send-feedback"
  | "delete-local";

export interface RowMenuOption {
  id: RowMenuOptionId;
  label: string;
  accessibilityLabel: string;
  destructive: boolean;
  confirm?: {
    title: string;
    message: string;
    action: string;
  };
}

export interface ChatMenuRow {
  id: string;
  title: string;
  live: boolean;
  hasSession: boolean;
  pinned?: boolean;
}

export interface ChatMenuCapabilities {
  feedbackOn: boolean;
  canOpenWindow: boolean;
}

/** Option visibility depends on capabilities and actual session presence. */
export function chatRowMenu(row: ChatMenuRow, caps: ChatMenuCapabilities): RowMenuOption[] {
  const title = row.title.trim() || "Untitled chat";
  const options: RowMenuOption[] = [
    {
      id: "open",
      label: "Open",
      accessibilityLabel: "Open chat: " + title,
      destructive: false,
    },
  ];

  if (caps.canOpenWindow) {
    options.push({
      id: "open-window",
      label: "Open as window",
      accessibilityLabel: "Open chat as window: " + title,
      destructive: false,
    });
  }

  if (row.hasSession) {
    options.push({
      id: "copy-session-id",
      label: "Copy session id",
      accessibilityLabel: "Copy session id for chat: " + title,
      destructive: false,
    });
  }

  if (caps.feedbackOn) {
    options.push({
      id: "send-feedback",
      label: "Send feedback",
      accessibilityLabel: "Send feedback about chat: " + title,
      destructive: false,
    });
  }

  options.push({
    id: "delete-local",
    label: "Delete from this phone",
    accessibilityLabel: "Delete chat from this phone: " + title,
    destructive: true,
    // Matches chatRowActions.remove; delete is always confirmed and phone-local.
    confirm: {
      title: "Delete chat?",
      message: "This removes it from this phone only.",
      action: "Delete",
    },
  });

  return options;
}

export interface RowSelection {
  open(id: string): void;
  close(): void;
  current(rows: readonly { id: string }[]): string | null;
}

/**
 * Retain identity, never a row index. A disappeared row permanently invalidates
 * the pending selection, even if a row with that id appears on a later render.
 */
export function createRowSelection(): RowSelection {
  let selectedId: string | null = null;
  return {
    open(id: string): void {
      selectedId = id;
    },
    close(): void {
      selectedId = null;
    },
    current(rows: readonly { id: string }[]): string | null {
      if (selectedId === null) return null;
      if (!rows.some(row => row.id === selectedId)) {
        selectedId = null;
      }
      return selectedId;
    },
  };
}
