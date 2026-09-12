import { memo } from "react";
import { loadVisualCatalog, providerIdForHarness, resolveEffort, resolveProvider, resolveRuntimeState } from "../catalog/visual";
import { EffortOrbs } from "./EffortOrbs";
import { OrchestraCore } from "./TopologyBadge";

/** AODL visual.json core for a catalog harness. Unknown ids fail closed to the unknown hue, never a letter. */
export const HarnessAvatar = memo(function HarnessAvatar({
  name,
  harnessId,
  size = 48,
  effortId,
  stateId,
}: {
  name: string;
  harnessId?: string;
  size?: number;
  effortId?: string;
  stateId?: string;
}) {
  const catalog = loadVisualCatalog();
  const provider = resolveProvider(catalog, providerIdForHarness(harnessId ?? ""));
  const effort = resolveEffort(catalog, effortId);
  const state = resolveRuntimeState(catalog, stateId);
  return (
    <EffortOrbs
      hue={provider.hue}
      size={size}
      effort={effort}
      state={state}
      accessibilityLabel={`${name} · ${provider.label} · ${state.label}`}
    >
      <OrchestraCore hue={provider.hue} size={size} />
    </EffortOrbs>
  );
});
