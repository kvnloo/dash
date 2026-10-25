import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pairActionState, type PairAction, type PairFormState } from "./a11y-pair-screen";

const ready: PairFormState = {
  computer: "laptop.tailnet:4747",
  bootstrapToken: "private-bootstrap-token-123",
  identityLink: "dash://pair?v=2&nonce=secret",
  manualCode: "ABC123",
  busy: false,
  activeAction: null,
};

const actions: PairAction[] = ["identity", "tailscale", "sound", "code"];

test("Pair announces enabled actions only when their actual inputs are available", () => {
  for (const action of actions) {
    expect(pairActionState(action, ready)).toEqual({ disabled: false, busy: false });
    expect(pairActionState(action, { ...ready, computer: "   " })).toEqual({ disabled: true, busy: false });
  }

  const withoutBootstrap = { ...ready, bootstrapToken: "  " };
  expect(pairActionState("identity", withoutBootstrap).disabled).toBe(false);
  const legacyActions: PairAction[] = ["tailscale", "sound", "code"];
  for (const action of legacyActions) {
    expect(pairActionState(action, withoutBootstrap).disabled).toBe(true);
  }

  expect(pairActionState("identity", { ...ready, identityLink: "  " }).disabled).toBe(true);
  expect(pairActionState("tailscale", { ...ready, identityLink: "" }).disabled).toBe(false);
});

test("Code action requires six alphanumeric characters; typed and prefilled codes agree", () => {
  for (const code of ["", "ABC12", "ABC1234", "AB C12", "ABC12!", "      "]) {
    expect(pairActionState("code", { ...ready, manualCode: code }).disabled).toBe(true);
  }
  for (const code of ["abc123", "A1B2C3", " ABC123 "]) {
    expect(pairActionState("code", { ...ready, manualCode: code }).disabled).toBe(false);
  }
  expect(pairActionState("sound", { ...ready, manualCode: "" }).disabled).toBe(false);
});

test("Only the active action announces busy, and every competing action is disabled", () => {
  for (const activeAction of actions) {
    const form = { ...ready, busy: true, activeAction };
    for (const action of actions) {
      expect(pairActionState(action, form)).toEqual({
        disabled: true,
        busy: action === activeAction,
      });
    }
  }
  expect(pairActionState("code", { ...ready, busy: true, activeAction: null }))
    .toEqual({ disabled: true, busy: false });
});

test("Accessibility state cannot expose either secret or the user-entered address", () => {
  const state = pairActionState("identity", ready);
  expect(Object.keys(state).sort()).toEqual(["busy", "disabled"]);
  for (const privateText of [ready.bootstrapToken, ready.identityLink, ready.computer]) {
    expect(JSON.stringify(state)).not.toContain(privateText);
  }
});

const screen = readFileSync(new URL("../screens/PairScreen.tsx", import.meta.url), "utf8");
const button = readFileSync(new URL("../components/PrimaryButton.tsx", import.meta.url), "utf8");

function inputFor(value: string): string {
  const token = `value={${value}}`;
  const at = screen.indexOf(token);
  if (at < 0) throw new Error(`Missing Pair input: ${value}`);
  const start = screen.lastIndexOf("<TextInput", at);
  const end = screen.indexOf("/>", at);
  if (start < 0 || end < 0) throw new Error(`Malformed Pair input: ${value}`);
  return screen.slice(start, end + 2);
}

function actionFor(handler: string, element: "Pressable" | "PrimaryButton"): string {
  const token = `onPress={() => void ${handler}()}`;
  const at = screen.indexOf(token);
  if (at < 0) throw new Error(`Missing Pair action: ${handler}`);
  const start = screen.lastIndexOf(`<${element}`, at);
  const end = screen.indexOf(element === "Pressable" ? "</Pressable>" : "/>", at);
  if (start < 0 || end < 0) throw new Error(`Malformed Pair action: ${handler}`);
  return screen.slice(start, end);
}

test("Every pairing field has an explicit stable label and credentials remain masked", () => {
  expect(inputFor("computer")).toContain('accessibilityLabel="Laptop bridge address"');
  expect(inputFor("computer")).toContain("onChangeText={setComputer}");
  expect(inputFor("identityLink")).toContain('accessibilityLabel="z0bridge pairing link"');
  expect(inputFor("identityLink")).toContain("secureTextEntry");
  expect(inputFor("bootstrapToken")).toContain('accessibilityLabel="Bootstrap token"');
  expect(inputFor("bootstrapToken")).toContain("secureTextEntry");
  expect(inputFor("manualCode")).toContain('accessibilityLabel="Pairing code"');
  expect(inputFor("manualCode")).toContain("onChangeText={(t) => setManualCode");
  expect(screen).toContain('keyboardShouldPersistTaps="handled"');
});

test("Primary pairing actions keep their touch handlers, role, and matching disabled/busy state", () => {
  expect(button).toContain('accessibilityRole="button"');
  const identity = actionFor("pairWithIdentity", "PrimaryButton");
  expect(identity).toContain("disabled={identityA11y.disabled}");
  expect(identity).toContain("accessibilityState={identityA11y}");
  expect(identity).toContain('accessibilityLabel="Confirm z0bridge pairing"');

  const tailscale = actionFor("pairOverTailscale", "PrimaryButton");
  expect(tailscale).toContain("disabled={tailscaleA11y.disabled}");
  expect(tailscale).toContain("accessibilityState={tailscaleA11y}");
  expect(tailscale).toContain('accessibilityLabel="Pair over Tailscale"');
  expect(tailscale).toContain('label={tailscaleA11y.busy ? "Pairing…" : "Pair over Tailscale"}');
});

test("Sound and code are real Pressable buttons; accessibility activation uses onPress", () => {
  const sound = actionFor("pairWithSound", "Pressable");
  const code = actionFor("pairWithCode", "Pressable");
  for (const [markup, stateName, label] of [
    [sound, "soundA11y", "Listen for pairing sound"],
    [code, "codeA11y", "Pair with code"],
  ]) {
    expect(markup).toContain('accessibilityRole="button"');
    expect(markup).toContain(`accessibilityLabel="${label}"`);
    expect(markup).toContain(`disabled={${stateName}.disabled}`);
    expect(markup).toContain(`accessibilityState={${stateName}}`);
    expect(markup).not.toContain("onAccessibilityAction");
  }
});

test("Manual settings is a labelled keyboard/TalkBack link with a 44 DIP target", () => {
  const target = 'navigation.navigate("Settings", { firstRun: true })';
  const at = screen.indexOf(target);
  expect(at).toBeGreaterThan(-1);
  const start = screen.lastIndexOf("<Pressable", at);
  const end = screen.indexOf("</Pressable>", at);
  const link = screen.slice(start, end);
  expect(link).toContain('accessibilityRole="link"');
  expect(link).toContain('accessibilityLabel="Enter address and token manually"');
  expect(link).toContain("onPress={() => navigation.navigate");
  expect(link).not.toContain("onAccessibilityAction");
  expect(screen).toMatch(/linkWrap:\s*\{[^}]*minHeight:\s*44/);
});

test("Progress is announced without serializing pairing credentials", () => {
  expect(screen).toContain('accessibilityLiveRegion="polite"');
  expect(screen).toContain('accessibilityLabel="Pairing failed. Check the connection details."');
  expect(screen).not.toContain("accessibilityLabel={bootstrapToken}");
  expect(screen).not.toContain("accessibilityLabel={identityLink}");
});
