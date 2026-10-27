import { describe, expect, test } from "bun:test";
import { chatRowActions } from "./chat-row-actions";
import { chatRowMenu, createRowSelection, type RowMenuOptionId } from "./chat-row-menu";

const row = {
  id: "conversation-42",
  title: "Repair pairing",
  live: true,
  hasSession: true,
  pinned: false,
};

describe("chat row long-press options", () => {
  test("provides the exact ordered options, accessible labels and destructive metadata", () => {
    expect(chatRowMenu(row, { feedbackOn: true, canOpenWindow: true })).toEqual([
      {
        id: "open",
        label: "Open",
        accessibilityLabel: "Open chat: Repair pairing",
        destructive: false,
      },
      {
        id: "open-window",
        label: "Open as window",
        accessibilityLabel: "Open chat as window: Repair pairing",
        destructive: false,
      },
      {
        id: "copy-session-id",
        label: "Copy session id",
        accessibilityLabel: "Copy session id for chat: Repair pairing",
        destructive: false,
      },
      {
        id: "send-feedback",
        label: "Send feedback",
        accessibilityLabel: "Send feedback about chat: Repair pairing",
        destructive: false,
      },
      {
        id: "delete-local",
        label: "Delete from this phone",
        accessibilityLabel: "Delete chat from this phone: Repair pairing",
        destructive: true,
        confirm: {
          title: "Delete chat?",
          message: "This removes it from this phone only.",
          action: "Delete",
        },
      },
    ]);
  });

  test("option order and visibility follow capabilities and session presence, not live or pinned", () => {
    let combinations = 0;
    for (const live of [false, true]) {
      for (const pinned of [undefined, false, true]) {
        for (const hasSession of [false, true]) {
          for (const feedbackOn of [false, true]) {
            for (const canOpenWindow of [false, true]) {
              const options = chatRowMenu(
                { ...row, live, pinned, hasSession },
                { feedbackOn, canOpenWindow },
              );
              const ids: RowMenuOptionId[] = ["open"];
              if (canOpenWindow) ids.push("open-window");
              if (hasSession) ids.push("copy-session-id");
              if (feedbackOn) ids.push("send-feedback");
              ids.push("delete-local");

              expect(options.map(option => option.id)).toEqual(ids);
              expect(new Set(options.map(option => option.id)).size).toBe(options.length);
              expect(options.filter(option => option.destructive).map(option => option.id)).toEqual(["delete-local"]);
              expect(options.at(-1)?.id).toBe("delete-local");
              expect(options.slice(0, -1).every(option => option.confirm === undefined)).toBe(true);
              expect(options.every(option => option.accessibilityLabel.includes(row.title))).toBe(true);
              combinations += 1;
            }
          }
        }
      }
    }
    expect(combinations).toBe(48);
  });

  test("omits unavailable capabilities but keeps open and delete even for ended unpinned chats", () => {
    expect(chatRowMenu(
      { ...row, title: " ", live: false, pinned: undefined, hasSession: false },
      { feedbackOn: false, canOpenWindow: false },
    )).toEqual([
      {
        id: "open", label: "Open",
        accessibilityLabel: "Open chat: Untitled chat", destructive: false,
      },
      {
        id: "delete-local", label: "Delete from this phone",
        accessibilityLabel: "Delete chat from this phone: Untitled chat",
        destructive: true,
        confirm: {
          title: "Delete chat?",
          message: "This removes it from this phone only.",
          action: "Delete",
        },
      },
    ]);
  });

  test("delete confirmation copy stays identical to existing chatRowActions.remove", () => {
    let captured: { title: string; message: string; action: string } | null = null;
    let deleted = false;
    chatRowActions({
      select: () => {},
      setActive: () => {},
      navigate: () => {},
      confirm: (title, message, action) => { captured = { title, message, action }; },
      remove: () => { deleted = true; },
    }).remove(row.id);

    const options = chatRowMenu(row, { feedbackOn: true, canOpenWindow: true });
    expect(options.find(option => option.id === "delete-local")?.confirm).toEqual(captured);
    expect(deleted).toBe(false);
  });
});

describe("id-keyed chat row menu selection", () => {
  test("opens the exact conversation and survives reorder rather than following an index", () => {
    const selection = createRowSelection();
    const chats = [
      { id: "same-title-a", title: "Work" },
      { id: "same-title-b", title: "Work" },
      { id: "other", title: "Work" },
    ];
    expect(selection.current(chats)).toBeNull();
    selection.open("same-title-b");
    expect(selection.current(chats)).toBe("same-title-b");
    expect(selection.current([chats[2]!, chats[0]!, chats[1]!])).toBe("same-title-b");
    expect(selection.current([{ id: "new-at-same-index" }, chats[1]!])).toBe("same-title-b");
    selection.close();
    expect(selection.current(chats)).toBeNull();
  });

  test("clears missing selections and never targets the next occupant of a removed row", () => {
    const selection = createRowSelection();
    selection.open("removed");
    expect(selection.current([{ id: "first" }, { id: "removed" }])).toBe("removed");
    expect(selection.current([{ id: "first" }, { id: "replacement" }])).toBeNull();
    // A removed id reappearing later cannot revive the old long-press menu.
    expect(selection.current([{ id: "removed" }])).toBeNull();
    selection.open("replacement");
    expect(selection.current([{ id: "replacement" }])).toBe("replacement");
    expect(selection.current([])).toBeNull();
  });

  test("uses exact identifiers and isolates independent menu lifetimes", () => {
    const a = createRowSelection();
    const b = createRowSelection();
    a.open("chat-10");
    b.open("chat-1");
    expect(a.current([{ id: "chat-1" }])).toBeNull();
    expect(b.current([{ id: "chat-1" }])).toBe("chat-1");
    a.open("chat-10");
    expect(a.current([{ id: "chat-10" }, { id: "chat-1" }])).toBe("chat-10");
    b.close();
    expect(a.current([{ id: "chat-1" }, { id: "chat-10" }])).toBe("chat-10");
    expect(b.current([{ id: "chat-1" }])).toBeNull();
  });
});
