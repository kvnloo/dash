// Native: only registered views are agent targets (see agent-targets-registry.ts).
import { measureRegistered, type TargetRect } from "./agent-targets-registry";
export { agentTarget, onScreen, type TargetRect } from "./agent-targets-registry";

export function measureAgentTarget(testID: string, window: { width: number; height: number }): Promise<TargetRect | null> {
  return measureRegistered(testID, window);
}
