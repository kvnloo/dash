import { useCallback, useMemo, useState } from "react";
import type { LiveIntent } from "../../../../shared/live";
import type { EphemeralCardSpec } from "../../lib/ephemeral-card";
import { catalogFixtureFor, ephemeralCatalog } from "../../lib/ephemeral-catalog";
import { catalogParity } from "../../lib/gallery";
import type { EphemeralKind } from "../../vendor/ephemeral-ui/kinds.generated";
import { EphemeralCard } from "./EphemeralCard";

/**
 * A chat reply's EphemeralCard(kind, app): when the shared kvnloo/ephemeral-ui catalog has a fixture for that
 * kind and app, the card draws that fixture, the same card Glide and hermex draw, and its footer says whether
 * the drawn props equal the catalog's. Other apps the kind lists draw the kit's sample data as before.
 */
export function CatalogEphemeralCard({ kind, app, onIntent }: { kind: EphemeralKind; app: string; onIntent?: (intent: LiveIntent) => boolean }) {
  const catalog = ephemeralCatalog();
  const fixture = useMemo(() => catalogFixtureFor(kind, app, catalog), [kind, app, catalog]);
  const spec = useMemo<EphemeralCardSpec>(() => fixture
    ? { kind, app, fixture: { id: fixture.id, seed: fixture.seed, input: fixture.input, at: catalog.generatedAt } }
    : { kind, app }, [kind, app, fixture, catalog]);
  const [parity, setParity] = useState<"drawing" | "same" | "differs">("drawing");
  const onDrawn = useCallback(({ ok, props }: { ok: boolean; props: string | null }) => {
    setParity(ok && fixture !== null && catalogParity(kind, fixture.props, props).match ? "same" : "differs");
  }, [kind, fixture]);
  const source = fixture
    ? `ephemeral-ui · catalog v${catalog.version} · ${fixture.id} · ${parity === "drawing" ? "drawing" : parity === "same" ? "same as catalog" : "differs from catalog"}`
    : undefined;
  return <EphemeralCard spec={spec} onIntent={onIntent} source={source} onDrawn={fixture ? onDrawn : undefined} />;
}
