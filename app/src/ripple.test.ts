import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INTENT_NODE_SIZE, INTENT_STRIP_HEIGHT, OWNS_KEYBOARD_DOCK } from "../vendor/ripple/src/geometry";

describe("Ripple on chat", () => {
  test("pins vendor geometry and Expo Go keyboard ownership", () => {
    expect(INTENT_NODE_SIZE).toBe(36);
    expect(INTENT_STRIP_HEIGHT).toBe(52);
    expect(OWNS_KEYBOARD_DOCK).toBe(false);
  });

  test("Chat mounts Ripple from @kvnloo/ripple inside KeyboardDock, not Orchestra", () => {
    const chat = readFileSync(join(import.meta.dir, "screens/ChatScreen.tsx"), "utf8");
    const orchestra = readFileSync(join(import.meta.dir, "screens/panes/OrchestraPane.tsx"), "utf8");
    const metro = readFileSync(join(import.meta.dir, "../metro.config.js"), "utf8");
    expect(chat).toContain('from "@kvnloo/ripple"');
    expect(chat).toContain("<Ripple");
    expect(chat).not.toContain("IntentSurface");
    expect(chat).toContain("KeyboardDock");
    expect(chat).toContain("surfaceRef={rippleRef}");
    expect(chat).toContain("debugFallback={Platform.OS === \"web\"}");
    expect(chat).toContain("intent: intentWire(");
    expect(chat).not.toContain("OrchestraPane");
    expect(chat).not.toContain("GOLD_GLOW");
    expect(chat).not.toContain("entering=");
    expect(orchestra).not.toContain("@kvnloo/ripple");
    expect(metro).toContain("vendor/ripple");
    expect(metro).toContain("@kvnloo/ripple");
    expect(metro).not.toContain("aodl-ui");
  });

  test("sendChat forwards optional intent on the existing chat type", () => {
    const src = readFileSync(join(import.meta.dir, "net/bridge.ts"), "utf8");
    expect(src).toContain("intent?: IntentWire");
    expect(src).toContain("intent: input.intent");
  });
});
