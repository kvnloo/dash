import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  WORKSPACE_ACTION_LABELS,
  upstreamApprovalAction,
  workspaceHeadingLabel,
} from "./a11y-workspace-header";

const componentSource = readFileSync(new URL("../components/WorkspaceHeader.tsx", import.meta.url), "utf8");
const iconButtonSource = readFileSync(new URL("../components/ScreenHeader.tsx", import.meta.url), "utf8");

describe("WorkspaceHeader accessibility decisions", () => {
  test("heading speaks the current workspace instead of pretending to navigate", () => {
    expect(workspaceHeadingLabel(0)).toBe("Bots workspace");
    expect(workspaceHeadingLabel(1)).toBe("Chats workspace");
    expect(workspaceHeadingLabel(2)).toBe("Orchestra workspace");
    expect(workspaceHeadingLabel(-2)).toBe("Bots workspace");
    expect(workspaceHeadingLabel(3)).toBe("Orchestra workspace");
    expect(componentSource).toContain('accessibilityRole="header" accessibilityLabel={workspaceHeadingLabel(tab)}');
    expect(componentSource).toContain("{titleOnly ? null : <WorkspaceActions navigation={navigation} />}");
  });

  test("no upstream GateItems means there is no approval action to announce", () => {
    for (const count of [0, -1, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(upstreamApprovalAction(count)).toBeNull();
    }
    expect(componentSource).toContain("{upstreamAction ? <PressScale");
  });

  test("announces exact upstream approval counts, independently of the abbreviated badge", () => {
    const hint = "Review pending upstream action approvals";
    expect(upstreamApprovalAction(1)).toEqual({
      label: "Upstream approvals, 1 pending",
      hint,
      badgeText: "1",
    });
    expect(upstreamApprovalAction(2)).toEqual({
      label: "Upstream approvals, 2 pending",
      hint,
      badgeText: "2",
    });
    expect(upstreamApprovalAction(99)?.badgeText).toBe("99");
    expect(upstreamApprovalAction(100)).toEqual({
      label: "Upstream approvals, 100 pending",
      hint,
      badgeText: "99+",
    });
    expect(upstreamApprovalAction(128)?.label).toBe("Upstream approvals, 128 pending");
    expect(upstreamApprovalAction(128)?.label).not.toContain("needs OK");
  });

  test("approval accessibility uses the exact same actionable GateItem count and onPress route", () => {
    expect(componentSource).toContain("approvals.use(s => s.items.filter(actionable).length)");
    const actionElement = componentSource.match(/<PressScale accessibilityRole="button"[^\n]+>/)?.[0];
    expect(actionElement).toContain("accessibilityLabel={upstreamAction.label}");
    expect(actionElement).toContain("accessibilityHint={upstreamAction.hint}");
    expect(actionElement).toContain('onPress={() => { haptic.select(); navigation.navigate("Approvals"); }}');
    expect(componentSource).toContain("{upstreamAction.badgeText}");
    expect(componentSource).not.toContain("onAccessibilityAction");
  });

  test("icon-only actions identify their destination and retain touch callbacks", () => {
    expect(WORKSPACE_ACTION_LABELS).toEqual({
      trace: "Open event trace",
      newChat: "Create new chat",
      settings: "Open settings",
    });
    expect(componentSource).toContain('label={WORKSPACE_ACTION_LABELS.trace} onPress={() => navigation.navigate("Trace")}');
    expect(componentSource).toContain('label={WORKSPACE_ACTION_LABELS.newChat} onPress={() => { createConversation(store.get().settings?.harness ?? "omp"); navigation.navigate("Chat"); }}');
    expect(componentSource).toContain('label={WORKSPACE_ACTION_LABELS.settings} onPress={() => navigation.navigate("Settings")}');
    expect(iconButtonSource).toMatch(/<PressScale[^>]*?accessibilityRole="button"[^>]*?accessibilityLabel=\{(?:label|model\.label)\}/);
  });

  test("retains touch targets, scalable badge text and honest absent states", () => {
    expect(componentSource).toContain("minHeight: WORKSPACE_HEADER_HEIGHT, paddingVertical: 4");
    expect(componentSource).toContain("minHeight: 44");
    expect(componentSource).toContain("minWidth: 18, minHeight: 18");
    expect(componentSource).not.toContain("allowFontScaling={false}");
    expect(componentSource).not.toContain("accessibilityState=");
    expect(iconButtonSource).toContain("hit: { width: 44, height: 44");
  });
});
