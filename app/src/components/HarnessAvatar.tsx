import { memo } from "react";
import { harnessLookOrUnspecified, loadVisualCatalog, runtimeStateFromLive } from "../catalog/visual";
import { VisualCore } from "./TopologyBadge";

/** visual.json core for a catalog harness id. Unknown owners fail closed to the declared unknown look. */
export const HarnessAvatar = memo(function HarnessAvatar({
  harnessId,
  size = 48,
  assistantState,
  online,
}: {
  harnessId: string;
  size?: number;
  assistantState?: string;
  online?: boolean;
}) {
  const catalog = loadVisualCatalog();
  const look = harnessLookOrUnspecified(catalog, harnessId);
  const stateId = runtimeStateFromLive({ assistantState, online });
  return <VisualCore look={look} size={size} stateId={stateId} />;
});
