import { expect, test } from "bun:test";
import type { ContextControl } from "../components/ContextCard";
import type { ContextSnapshot } from "../../../shared/context";

const observed: ContextSnapshot = {
  sessionId: "chat-A",
  model: "measured-model",
  used: 65,
  maximum: 100,
  threshold: 80,
  estimated: true,
  source: "host-snapshot",
  categories: [],
  revision: "r1",
  notes: [],
};

const cases: Array<Pick<ContextControl, "open" | "snapshot">> = [
  { open: false, snapshot: undefined },
  { open: true, snapshot: undefined },
  { open: false, snapshot: observed },
  { open: true, snapshot: observed },
  { open: true, snapshot: { ...observed, sessionId: "chat-B", revision: "r2" } },
  { open: true, snapshot: { ...observed, sessionId: "chat-B", maximum: 0, used: 0 } },
];

test("real ContextGauge exposes expanded/collapsed on web, without falsifying missing context or changing the target", async () => {
  // Run in a child process so mocked RN modules cannot pollute sibling tests.
  // Only native-only render surfaces are mocked; ContextGauge is imported
  // from the actual production ContextCard.tsx and invoked for each case.
  const program = `
    import { mock } from "bun:test";
    mock.module("react-native", () => ({
      AppState: { currentState: "active" },
      Animated: {
        Value: class { constructor(value) { this.value = value; } },
        timing: () => ({ start() {} }),
        loop: () => ({ start() {}, stop() {} }),
        sequence: () => ({}),
      },
      Easing: { out: () => "", inOut: () => "", cubic: "" },
      Platform: { OS: "web" },
      ScrollView: "ScrollView",
      StyleSheet: { create: value => value },
      Text: "Text",
      View: "View",
      useWindowDimensions: () => ({ width: 390, height: 844 }),
    }));
    mock.module("react-native-svg", () => ({ default: "svg", Circle: "circle" }));
    mock.module("../components/PressScale", () => ({ PressScale: "PressScale" }));
    const { ContextGauge } = await import("../components/ContextCard.tsx");
    const inputs = ${JSON.stringify(cases)};
    const probes = inputs.map(({ open, snapshot }) => {
      let presses = 0;
      const control = {
        open, snapshot, plans: [], phase: "idle", notice: "",
        compact: async () => {}, canCompact: false, compactUnavailable: false,
        toggle: () => { presses++; },
      };
      const element = ContextGauge({ control });
      element.props.onPress();
      return {
        role: element.props.accessibilityRole,
        label: element.props.accessibilityLabel,
        nativeExpanded: element.props.accessibilityState?.expanded ?? null,
        hasAriaExpanded: Object.hasOwn(element.props, "aria-expanded"),
        ariaExpanded: element.props["aria-expanded"] ?? null,
        target: snapshot?.sessionId ?? "unknown",
        presses,
        width: element.props.style.width,
        height: element.props.style.height,
      };
    });
    console.log(JSON.stringify(probes));
  `;
  const child = Bun.spawn([process.execPath, "-e", program], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const actual: unknown = JSON.parse(stdout);
  expect(actual).toEqual([
    { role: "button", label: "Context window, unavailable", nativeExpanded: false, hasAriaExpanded: true, ariaExpanded: false, target: "unknown", presses: 1, width: 44, height: 44 },
    { role: "button", label: "Context window, unavailable", nativeExpanded: true, hasAriaExpanded: true, ariaExpanded: true, target: "unknown", presses: 1, width: 44, height: 44 },
    { role: "button", label: "Context window, approximately 65 percent", nativeExpanded: false, hasAriaExpanded: true, ariaExpanded: false, target: "chat-A", presses: 1, width: 44, height: 44 },
    { role: "button", label: "Context window, approximately 65 percent", nativeExpanded: true, hasAriaExpanded: true, ariaExpanded: true, target: "chat-A", presses: 1, width: 44, height: 44 },
    { role: "button", label: "Context window, approximately 65 percent", nativeExpanded: true, hasAriaExpanded: true, ariaExpanded: true, target: "chat-B", presses: 1, width: 44, height: 44 },
    { role: "button", label: "Context window, unavailable", nativeExpanded: true, hasAriaExpanded: true, ariaExpanded: true, target: "chat-B", presses: 1, width: 44, height: 44 },
  ]);
});
