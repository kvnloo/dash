import { memo } from "react";
import { loadVisualCatalog, providerIdForHarness, resolveProvider } from "../catalog/visual";
import { OrchestraCore } from "./TopologyBadge";

/** AODL visual.json core for a catalog harness. Unknown ids fail closed to the unknown hue, never a letter. */
export const HarnessAvatar = memo(function HarnessAvatar({
  name,
  harnessId,
  size = 48,
}: {
  name: string;
  harnessId?: string;
  size?: number;
}) {
  const catalog = loadVisualCatalog();
  const provider = resolveProvider(catalog, providerIdForHarness(harnessId ?? ""));
  return <OrchestraCore hue={provider.hue} size={size} accessibilityLabel={`${name} · ${provider.label}`} />;
});
