import { memo } from "react";
import { resolveHarnessVisual } from "../catalog/visual";
import { HarnessVisualCore } from "./HarnessVisualCore";

/**
 * One pinned AODL identity encoding for search, picker and session surfaces.
 * Without a declared model, a harness gets the catalog's plain "unknown" core.
 * State is displayed separately from model identity, never inferred from hue.
 */
export const HarnessAvatar = memo(function HarnessAvatar({
  name,
  harnessId,
  size = 40,
  modelId,
  effortId,
  stateId,
  operatingModeId,
  valueScore,
}: {
  name: string;
  harnessId?: string;
  size?: number;
  modelId?: string;
  effortId?: string;
  stateId?: string;
  operatingModeId?: string;
  valueScore?: number | null;
}) {
  const look = resolveHarnessVisual({
    harnessId,
    modelId,
    effortId,
    stateId,
    operatingModeId,
    valueScore,
  });
  return <HarnessVisualCore name={name} look={look} size={size} />;
});
