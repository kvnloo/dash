import { expect, mock, test } from "bun:test";
import type { DraftAttachment } from "../lib/attachments";

// Bun's module mocks are process-global. Keep every native-storage fixture in its
// own Bun test process so app.test.ts and the existing draft tests stay untouched.
const CASE_ENV = "DASH149_CHILD_CASE";
const INPUT_ENV = "DASH149_INPUT_PAYLOAD";
const SNAPSHOT_MARKER = "DASH149_PAYLOAD:";

function isolatedCase(name: string, saved?: string): string {
  const environment: Record<string, string | undefined> = {
    ...process.env,
    [CASE_ENV]: name,
    [INPUT_ENV]: saved,
  };
  const child = Bun.spawnSync({
    cmd: [process.execPath, "test", import.meta.path],
    cwd: import.meta.dir,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(child.stdout);
  const stderr = new TextDecoder().decode(child.stderr);
  if (child.exitCode !== 0) {
    throw new Error("Isolated composer draft fixture " + name + " failed:\n" + stdout + "\n" + stderr);
  }
  const output = stdout.split(/\r?\n/).find(line => line.includes(SNAPSHOT_MARKER));
  if ((name === "persist" || name === "clear") && !output) {
    throw new Error("Missing persisted snapshot for " + name + ":\n" + stdout + "\n" + stderr);
  }
  return output ? output.slice(output.indexOf(SNAPSHOT_MARKER) + SNAPSHOT_MARKER.length).trim() : "";
}

const selectedCase = process.env[CASE_ENV];
if (selectedCase === undefined) {
  test("late storage hydration never overwrites newer typed text or local attachments", () => {
    isolatedCase("late-hydration");
  });

  test("two keyed drafts survive restart as text only; clearing one survives another restart", () => {
    const persisted = isolatedCase("persist");
    isolatedCase("restart", persisted);
    const afterClear = isolatedCase("clear", persisted);
    isolatedCase("restart-cleared", afterClear);
  });

  test("a rejected storage write is not mistaken for a successful persisted draft", () => {
    isolatedCase("write-rejected");
  });

  test("background flush cancels the debounce timer; a later edit still auto-saves", () => {
    isolatedCase("background-flush");
  });

  test("an older in-flight write must not overwrite a newer persisted draft", () => {
    // Regression: currently red until Hermes serializes AsyncStorage.setItem calls.
    isolatedCase("out-of-order");
  });
} else {
  const KEY = "dash.composerDrafts.v1";
  const onDisk = new Map<string, string>();
  const input = process.env[INPUT_ENV];
  if (input !== undefined) onDisk.set(KEY, input);

  let finishRead: ((value: string | null) => void) | undefined;
  const appStateListeners = new Set<(state: string) => void>();
  let writeMode: "commit" | "reject" | "hold" = "commit";
  const writeAttempts: string[] = [];
  const heldWrites: Array<() => void> = [];
  let successfulWrites = 0;

  mock.module("@react-native-async-storage/async-storage", () => ({
    default: {
      getItem(key: string): Promise<string | null> {
        expect(key).toBe(KEY);
        return new Promise(resolve => { finishRead = resolve; });
      },
      setItem(key: string, value: string): Promise<void> {
        expect(key).toBe(KEY);
        writeAttempts.push(value);
        if (writeMode === "reject") return Promise.reject(new Error("storage quota exceeded"));
        if (writeMode === "hold") {
          return new Promise<void>(resolve => {
            heldWrites.push(() => {
              onDisk.set(key, value);
              successfulWrites += 1;
              resolve();
            });
          });
        }
        onDisk.set(key, value);
        successfulWrites += 1;
        return Promise.resolve();
      },
    },
  }));
  mock.module("react-native", () => ({
    AppState: {
      addEventListener(event: string, listener: (state: string) => void) {
        expect(event).toBe("change");
        appStateListeners.add(listener);
        return { remove: () => { appStateListeners.delete(listener); } };
      },
    },
  }));

  // Import after mocking: composer-drafts starts hydration at module evaluation.
  const { composerDrafts, updateComposerDraft, draftsRestored } = await import("./composer-drafts");

  const sampleFile: DraftAttachment = {
    key: "image",
    name: "synthetic.png",
    mime: "image/png",
    uri: "file://synthetic",
    size: 4,
    state: "ready",
  };

  function edit(id: string, text: string, attachments?: DraftAttachment[]): void {
    updateComposerDraft(id, { text: "", attachments: [] }, current => ({
      ...current,
      text,
      attachments: attachments ?? current.attachments,
    }));
  }

  async function hydrate(raw: string | null = onDisk.get(KEY) ?? null): Promise<void> {
    const resolve = finishRead;
    if (!resolve) throw new Error("AsyncStorage.getItem did not start");
    resolve(raw);
    await draftsRestored;
    expect(appStateListeners.size).toBe(1);
  }

  async function changeAppState(state: string): Promise<void> {
    for (const listener of appStateListeners) listener(state);
    await Promise.resolve();
    await Promise.resolve();
  }

  function storedText(id: string): string | undefined {
    const parsed: unknown = JSON.parse(onDisk.get(KEY) ?? "{}");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid stored draft object");
    }
    const entry: unknown = Reflect.get(parsed, id);
    if (entry === undefined) return undefined;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Invalid stored draft entry");
    }
    const text: unknown = Reflect.get(entry, "text");
    return typeof text === "string" ? text : undefined;
  }

  function printSaved(): void {
    const value = onDisk.get(KEY);
    if (!value) throw new Error("No saved drafts");
    console.log(SNAPSHOT_MARKER + value);
  }

  test("isolated composer draft case: " + selectedCase, async () => {
    switch (selectedCase) {
      case "late-hydration": {
        const old = JSON.stringify({
          a: { text: "old from disk", at: Date.now() },
          b: { text: "restored b", at: Date.now() },
          expired: { text: "too old", at: Date.now() - 15 * 24 * 3600 * 1000 },
          malformed: { text: 42, at: Date.now() },
        });
        onDisk.set(KEY, old);
        edit("a", "typed before read resolved", [sampleFile]);
        await hydrate(old);
        expect(composerDrafts.get().a?.text).toBe("typed before read resolved");
        expect(composerDrafts.get().a?.attachments).toEqual([sampleFile]);
        expect(composerDrafts.get().b).toEqual({ text: "restored b", attachments: [] });
        expect(composerDrafts.get().expired).toBeUndefined();
        expect(composerDrafts.get().malformed).toBeUndefined();
        await changeAppState("background");
        expect(storedText("a")).toBe("typed before read resolved");
        expect(storedText("b")).toBe("restored b");
        break;
      }
      case "persist": {
        await hydrate();
        edit("a", "Alpha", [sampleFile]);
        edit("b", "Beta");
        await changeAppState("background");
        expect(storedText("a")).toBe("Alpha");
        expect(storedText("b")).toBe("Beta");
        expect(onDisk.get(KEY)).not.toContain("attachments");
        expect(onDisk.get(KEY)).not.toContain("file://synthetic");
        printSaved();
        break;
      }
      case "restart": {
        await hydrate();
        expect(composerDrafts.get().a).toEqual({ text: "Alpha", attachments: [] });
        expect(composerDrafts.get().b).toEqual({ text: "Beta", attachments: [] });
        expect(Object.keys(composerDrafts.get()).sort()).toEqual(["a", "b"]);
        break;
      }
      case "clear": {
        await hydrate();
        edit("a", "");
        await changeAppState("background");
        expect(storedText("a")).toBeUndefined();
        expect(storedText("b")).toBe("Beta");
        expect(composerDrafts.get().a?.text).toBe("");
        printSaved();
        break;
      }
      case "restart-cleared": {
        await hydrate();
        expect(composerDrafts.get().a).toBeUndefined();
        expect(composerDrafts.get().b).toEqual({ text: "Beta", attachments: [] });
        break;
      }
      case "write-rejected": {
        const original = JSON.stringify({ a: { text: "previous successful write", at: Date.now() } });
        onDisk.set(KEY, original);
        await hydrate(original);
        writeMode = "reject";
        edit("a", "not yet persisted");
        await changeAppState("background");
        expect(writeAttempts).toHaveLength(1);
        expect(successfulWrites).toBe(0);
        expect(onDisk.get(KEY)).toBe(original);
        expect(composerDrafts.get().a?.text).toBe("not yet persisted");
        writeMode = "commit";
        await changeAppState("background");
        expect(writeAttempts).toHaveLength(2);
        expect(successfulWrites).toBe(1);
        expect(storedText("a")).toBe("not yet persisted");
        break;
      }
      case "background-flush": {
        await hydrate();
        edit("a", "first");
        edit("a", "second");
        await changeAppState("active");
        expect(writeAttempts).toHaveLength(0);
        await changeAppState("background");
        expect(writeAttempts).toHaveLength(1);
        expect(storedText("a")).toBe("second");
        // No extra timer write may fire after the background flush cancelled it.
        await Bun.sleep(330);
        expect(writeAttempts).toHaveLength(1);
        edit("a", "third");
        await Bun.sleep(330);
        expect(writeAttempts).toHaveLength(2);
        expect(storedText("a")).toBe("third");
        break;
      }
      case "out-of-order": {
        await hydrate();
        writeMode = "hold";
        edit("a", "older");
        await changeAppState("background");
        edit("a", "newer");
        await changeAppState("background");
        expect(heldWrites).toHaveLength(2);
        const second = heldWrites[1];
        const first = heldWrites[0];
        if (!first || !second) throw new Error("Expected two in-flight storage writes");
        second();
        await Promise.resolve();
        expect(storedText("a")).toBe("newer");
        first();
        await Promise.resolve();
        // Intentional failing regression on current producer: completion order
        // currently determines durable value instead of edit order.
        expect(storedText("a")).toBe("newer");
        break;
      }
      default:
        throw new Error("Unknown composer drafts fixture: " + selectedCase);
    }
  });
}
