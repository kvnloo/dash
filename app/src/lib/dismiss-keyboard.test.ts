import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Isolate the RN mock in a child process; never replace react-native for other tests.
test("keyboard dismissal waits for native hide, cleans listeners, and has a missing-event fallback", () => {
  const child = spawnSync(process.execPath, ["-e", `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    let visible = true, platform = "android", handler, removed = 0, dismissed = 0, subscribed = 0;
    const keyboard = {
      isVisible: () => visible,
      dismiss: () => { dismissed++; },
      addListener: (event, fn) => { assert.equal(event, "keyboardDidHide"); subscribed++; handler = fn; return { remove: () => { removed++; } }; },
    };
    mock.module("react-native", () => ({ Keyboard: keyboard, Platform: { get OS() { return platform; } } }));
    const { dismissKeyboard } = await import(process.argv[1]);
    let done = false;
    const waiting = dismissKeyboard().then(() => { done = true; });
    await Promise.resolve();
    assert.equal(done, false);
    assert.equal(subscribed, 1);
    assert.equal(dismissed, 1);
    handler(); await waiting;
    assert.equal(removed, 1);
    visible = false;
    await dismissKeyboard();
    assert.equal(subscribed, 1);
    visible = true; platform = "web";
    await dismissKeyboard();
    assert.equal(subscribed, 1);
    platform = "android";
    await dismissKeyboard(); // no event: the bounded timeout must resolve and clean up
    assert.equal(subscribed, 2);
    assert.equal(removed, 2);
    assert.equal(dismissed, 4);
  `, join(import.meta.dir, "dismiss-keyboard.ts")], { encoding: "utf8", timeout: 5000 });
  expect(child.stderr).toBe("");
  expect(child.status).toBe(0);
});
