import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  alertDialog,
  confirmDialog,
  dialogStore,
  resolveCurrent,
  showDialog,
  type DialogButton,
} from "./dash-dialog";

const ok: DialogButton = { id: "ok", label: "OK", role: "default" };
const cancel: DialogButton = { id: "cancel", label: "Cancel", role: "cancel" };

describe("Dash dialog request queue", () => {
  test("single flight, FIFO, state subscription and settling only the visible action", async () => {
    expect(dialogStore.get().current).toBeNull();
    const titles: Array<string | null> = [];
    const unsubscribe = dialogStore.subscribe(() => titles.push(dialogStore.get().current?.title ?? null));

    const first = showDialog({ title: "First", message: "First body", buttons: [ok] });
    const second = showDialog({ title: "Second", message: "Second body", buttons: [cancel, ok] });
    const third = showDialog({ title: "Third", buttons: [ok] });

    expect(dialogStore.get().current).toEqual({
      title: "First",
      message: "First body",
      buttons: [ok],
    });
    expect(titles).toEqual(["First"]);
    expect(resolveCurrent("not-offered")).toBe(false);
    expect(dialogStore.get().current?.title).toBe("First");
    expect(titles).toEqual(["First"]);

    expect(resolveCurrent("ok")).toBe(true);
    expect(await first).toBe("ok");
    expect(dialogStore.get().current?.title).toBe("Second");
    expect(resolveCurrent("cancel")).toBe(true);
    expect(await second).toBe("cancel");
    expect(dialogStore.get().current?.title).toBe("Third");
    expect(resolveCurrent("ok")).toBe(true);
    expect(await third).toBe("ok");
    expect(dialogStore.get().current).toBeNull();
    expect(resolveCurrent(null)).toBe(false);
    expect(resolveCurrent("ok")).toBe(false);
    expect(titles).toEqual(["First", "Second", "Third", null]);
    unsubscribe();

    const after = showDialog({ title: "After unsubscribe", buttons: [ok] });
    expect(resolveCurrent("ok")).toBe(true);
    expect(await after).toBe("ok");
    expect(titles).toEqual(["First", "Second", "Third", null]);
  });

  test("Back and backdrop resolve to cancel id, or null when there is no cancel", async () => {
    const dismissible = showDialog({ title: "Dismissible", buttons: [ok, cancel] });
    expect(resolveCurrent(null)).toBe(true);
    expect(await dismissible).toBe("cancel");

    const acknowledgement = showDialog({ title: "Information", buttons: [ok] });
    expect(resolveCurrent(null)).toBe(true);
    expect(await acknowledgement).toBeNull();
    expect(dialogStore.get().current).toBeNull();
  });

  test("same title and message coalesce while active and while queued", async () => {
    const first = showDialog({ title: "Same", message: "Body", buttons: [ok] });
    const repeatedFirst = showDialog({ title: "Same", message: "Body", buttons: [ok] });
    const queued = showDialog({ title: "Queued", message: "Body", buttons: [cancel, ok] });
    const repeatedQueued = showDialog({ title: "Queued", message: "Body", buttons: [cancel, ok] });
    const distinctMessage = showDialog({ title: "Same", message: "Other body", buttons: [ok] });

    expect(dialogStore.get().current?.title).toBe("Same");
    expect(resolveCurrent("ok")).toBe(true);
    expect(await first).toBe("ok");
    expect(await repeatedFirst).toBe("ok");
    expect(dialogStore.get().current?.title).toBe("Queued");

    expect(resolveCurrent(null)).toBe(true);
    expect(await queued).toBe("cancel");
    expect(await repeatedQueued).toBe("cancel");

    expect(dialogStore.get().current?.message).toBe("Other body");
    expect(resolveCurrent("ok")).toBe(true);
    expect(await distinctMessage).toBe("ok");
    expect(dialogStore.get().current).toBeNull();
  });

  test("undefined and empty messages are different requests", async () => {
    const missing = showDialog({ title: "Same", buttons: [ok] });
    const empty = showDialog({ title: "Same", message: "", buttons: [cancel] });
    expect(dialogStore.get().current?.message).toBeUndefined();

    expect(resolveCurrent("ok")).toBe(true);
    expect(await missing).toBe("ok");
    expect(dialogStore.get().current?.message).toBe("");
    expect(resolveCurrent(null)).toBe(true);
    expect(await empty).toBe("cancel");
  });
});

describe("button normalisation and snapshot boundaries", () => {
  test("empty button list receives a single default OK", async () => {
    const pending = showDialog({ title: "Nothing offered", buttons: [] });
    expect(dialogStore.get().current?.buttons).toEqual([ok]);
    expect(resolveCurrent("ok")).toBe(true);
    expect(await pending).toBe("ok");
  });

  test("duplicate cancel buttons, duplicate ids and blank ids or labels fail before enqueue", async () => {
    expect(() => showDialog({
      title: "Invalid cancels",
      buttons: [cancel, { id: "other-cancel", label: "Dismiss", role: "cancel" }],
    })).toThrow(/at most one cancel/);
    expect(() => showDialog({
      title: "Invalid ids",
      buttons: [ok, { id: "ok", label: "Sure", role: "destructive" }],
    })).toThrow(/unique/);
    expect(() => showDialog({
      title: "Blank id",
      buttons: [{ id: "  ", label: "OK", role: "default" }],
    })).toThrow(/must not be empty/);
    expect(() => showDialog({
      title: "Blank label",
      buttons: [{ id: "fine", label: " ", role: "default" }],
    })).toThrow(/must not be empty/);
    expect(dialogStore.get().current).toBeNull();

    const valid = showDialog({ title: "Valid", buttons: [ok] });
    expect(resolveCurrent("ok")).toBe(true);
    expect(await valid).toBe("ok");
  });

  test("the displayed request is snapshotted, not a mutable caller-owned array", async () => {
    const buttons = [{ id: "continue", label: "Continue", role: "default" }] satisfies DialogButton[];
    const input = { title: "Snapshot", message: "Original", buttons };
    const pending = showDialog(input);
    buttons[0]!.label = "Changed";
    buttons.push({ id: "later", label: "Later", role: "default" });

    expect(dialogStore.get().current?.buttons).toEqual([
      { id: "continue", label: "Continue", role: "default" },
    ]);
    expect(Object.isFrozen(dialogStore.get().current)).toBe(true);
    expect(Object.isFrozen(dialogStore.get().current?.buttons)).toBe(true);
    expect(Object.isFrozen(dialogStore.get().current?.buttons[0])).toBe(true);
    expect(resolveCurrent("later")).toBe(false);
    expect(resolveCurrent("continue")).toBe(true);
    expect(await pending).toBe("continue");
  });
});

describe("dialog convenience helpers", () => {
  test("alertDialog offers exactly one acknowledgement", async () => {
    const result = alertDialog("Heads up", "Details");
    expect(dialogStore.get().current).toEqual({
      title: "Heads up",
      message: "Details",
      buttons: [ok],
    });
    expect(resolveCurrent("ok")).toBe(true);
    expect(await result).toBe("ok");
  });

  test("confirmDialog only accepts its action id; cancellation and dismiss never approve", async () => {
    const destructive = confirmDialog("Delete?", "Cannot be undone", "Delete", { destructive: true });
    expect(dialogStore.get().current?.buttons).toEqual([
      cancel,
      { id: "action:Delete", label: "Delete", role: "destructive" },
    ]);
    expect(resolveCurrent("Delete")).toBe(false);
    expect(resolveCurrent("action:Delete")).toBe(true);
    expect(await destructive).toBe(true);

    const cancelled = confirmDialog("Leave?", "Unsaved changes", "Leave");
    expect(dialogStore.get().current?.buttons[1]?.role).toBe("default");
    expect(resolveCurrent("cancel")).toBe(true);
    expect(await cancelled).toBe(false);

    const dismissed = confirmDialog("Restart?", "Continue?", "Restart");
    expect(resolveCurrent(null)).toBe(true);
    expect(await dismissed).toBe(false);
  });

  test("coalesced confirmations with different action labels cannot approve the wrong action", async () => {
    const first = confirmDialog("Change?", "Same context", "Delete", { destructive: true });
    const second = confirmDialog("Change?", "Same context", "Publish");

    expect(dialogStore.get().current?.buttons[1]?.id).toBe("action:Delete");
    expect(resolveCurrent("action:Delete")).toBe(true);
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(dialogStore.get().current).toBeNull();
  });

  test("the module remains platform-neutral and never invokes a system popup", () => {
    const source = readFileSync(new URL("./dash-dialog.ts", import.meta.url), "utf8");
    expect(source).not.toContain("react-native");
    expect(source).not.toContain("Alert.alert");
    expect(source).not.toContain("globalThis.confirm");
    expect(source).toContain("createStore");
  });
});
