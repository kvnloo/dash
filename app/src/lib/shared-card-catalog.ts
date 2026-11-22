import catalog from "../vendor/ephemeral-ui/catalog.json";
import { ephemeralCardSpec } from "./ephemeral-card";

if (catalog.v !== 0) throw new Error(`Unsupported shared card catalog format: ${catalog.v}`);

export const catalogVersion = catalog.version;
export const catalogKindCount = catalog.kinds.length;
export const catalogCards = catalog.kinds.flatMap(kind => kind.fixtures.map(fixture => ({
  ...fixture,
  label: kind.label,
  // The chat renderer takes only a kind and app. It cannot show an input-specific fixture.
  cardPreview: fixture.state === "sample" ? ephemeralCardSpec(fixture.card.kind, fixture.card.app) : null,
})));
