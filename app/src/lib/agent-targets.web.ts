// Web: any rendered data-testid is a target (testIDs are validated to [A-Za-z0-9_-], so the
// attribute selector is literal). The topmost visible match wins; registered views are the fallback.
import { measureRegistered, onScreen, type TargetRect } from "./agent-targets-registry";
export { agentTarget, onScreen, type TargetRect } from "./agent-targets-registry";

export function measureAgentTarget(testID: string, window: { width: number; height: number }): Promise<TargetRect | null> {
  if (typeof document !== "undefined" && /^[A-Za-z0-9_-]{1,64}$/.test(testID)) {
    const nodes = [...document.querySelectorAll(`[data-testid="${testID}"]`)].reverse();
    for (const node of nodes) {
      const box = node.getBoundingClientRect();
      const rect = { x: box.left, y: box.top, width: box.width, height: box.height };
      if (!onScreen(rect, window)) continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      return Promise.resolve(rect);
    }
  }
  return measureRegistered(testID, window);
}
