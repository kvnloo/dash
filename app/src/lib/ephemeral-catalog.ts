import { EPHEMERAL_CATALOG_SHA256, EPHEMERAL_CATALOG_VERSION, EPHEMERAL_KINDS, EPHEMERAL_KIT_REV, type EphemeralKind } from "../vendor/ephemeral-ui/kinds.generated";

/**
 * The shared card catalog of kvnloo/ephemeral-ui (catalog/catalog.json, contract in its catalog/README.md),
 * vendored unedited beside the kit by app/scripts/ephemeral-kit/build.mjs. Every app that draws the kit's
 * cards renders these same fixtures; Dash's gallery and chat cards read them from here.
 */
export type CatalogFixtureState = "sample" | "example" | "unavailable" | "input";
export type CatalogFixture = {
  id: string;
  state: CatalogFixtureState;
  seed: string;
  kind: EphemeralKind;
  app: string;
  /** card.input, when the fixture carries one (example data documents, the merge appInput). */
  input?: unknown;
  /** The kit's card spec for this fixture, keys sorted, as stable JSON. */
  props: string;
};
export type CatalogKind = { kind: EphemeralKind; label: string; group: string; programmable: boolean; fixtures: CatalogFixture[] };
export type EphemeralCatalog = {
  version: string;
  generatedAt: string;
  rev: string;
  sha256: string;
  kinds: CatalogKind[];
  fixtures: CatalogFixture[];
};

const KINDS: ReadonlySet<string> = new Set(EPHEMERAL_KINDS);
const isEphemeralKind = (v: unknown): v is EphemeralKind => typeof v === "string" && KINDS.has(v);
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, what: string): string => { if (typeof v !== "string" || !v) throw new Error(`catalog: ${what} is not a string`); return v; };
const STATES: readonly string[] = ["sample", "example", "unavailable", "input"];
const isState = (v: unknown): v is CatalogFixtureState => typeof v === "string" && STATES.includes(v);

/** JSON with object keys sorted at every depth: the catalog's props form, so equal props give equal strings. */
export function stableJSON(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : record(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(value)) ?? "null";
}

function fixtureOf(raw: unknown, kind: EphemeralKind): CatalogFixture {
  if (!record(raw) || !record(raw.card)) throw new Error(`catalog: ${kind} has a malformed fixture`);
  const id = text(raw.id, `${kind} fixture id`);
  if (!isState(raw.state)) throw new Error(`catalog: ${id} has unknown state ${String(raw.state)}`);
  if (raw.card.kind !== kind) throw new Error(`catalog: ${id} draws ${String(raw.card.kind)}`);
  const fixture: CatalogFixture = { id, state: raw.state, seed: text(raw.seed, `${id} seed`), kind, app: text(raw.card.app, `${id} app`), props: stableJSON(raw.props) };
  if (raw.card.input !== undefined) fixture.input = raw.card.input;
  return fixture;
}

/** Parse catalog.json (v 0). Throws on any other shape: a wrong catalog must fail loudly, not draw a partial gallery. */
export function parseCatalog(raw: unknown): EphemeralCatalog {
  if (!record(raw) || raw.v !== 0) throw new Error("catalog: not a v 0 kvnloo/ephemeral-ui card catalog");
  if (!Array.isArray(raw.kinds)) throw new Error("catalog: kinds is not a list");
  const kinds = raw.kinds.map((k: unknown): CatalogKind => {
    if (!record(k) || !isEphemeralKind(k.kind)) throw new Error(`catalog: kind ${record(k) ? String(k.kind) : "?"} is not one the vendored kit draws`);
    const kind = k.kind;
    if (!Array.isArray(k.fixtures) || !k.fixtures.length) throw new Error(`catalog: ${kind} has no fixtures`);
    return { kind, label: text(k.label, `${kind} label`), group: text(k.group, `${kind} group`), programmable: k.programmable === true, fixtures: k.fixtures.map((f: unknown) => fixtureOf(f, kind)) };
  });
  return { version: text(raw.version, "version"), generatedAt: text(raw.generatedAt, "generatedAt"), rev: EPHEMERAL_KIT_REV, sha256: EPHEMERAL_CATALOG_SHA256, kinds, fixtures: kinds.flatMap(k => k.fixtures) };
}

let loaded: EphemeralCatalog | null = null;
/** The vendored catalog, parsed once on first use (it is ~300 KB, so only the gallery and card hosts load it). */
export function ephemeralCatalog(): EphemeralCatalog {
  if (!loaded) {
    // A lazy require keeps the JSON out of startup work; native Metro previews cannot load dynamic import().
    const json: unknown = require("../vendor/ephemeral-ui/catalog.json");
    loaded = parseCatalog(json);
    if (loaded.version !== EPHEMERAL_CATALOG_VERSION) throw new Error(`catalog: vendored ${loaded.version}, kinds.generated.ts records ${EPHEMERAL_CATALOG_VERSION}`);
  }
  return loaded;
}

const CHAT_STATES: readonly CatalogFixtureState[] = ["sample", "example", "input"];
/**
 * The catalog fixture a chat card for (kind, app) draws: the kind's first sample or example fixture for that app,
 * else its input fixture. Unavailable fixtures never stand in for a card. Null when the catalog has none for the app.
 */
export function catalogFixtureFor(kind: EphemeralKind, app: string, catalog: EphemeralCatalog = ephemeralCatalog()): CatalogFixture | null {
  const fixtures = catalog.kinds.find(k => k.kind === kind)?.fixtures.filter(f => f.app === app) ?? [];
  for (const state of CHAT_STATES) { const f = fixtures.find(x => x.state === state); if (f) return f; }
  return null;
}

/** Short revision for labels: "catalog v0.1.0 · ephemeral-ui@7c5daca". */
export const catalogLabel = (c: EphemeralCatalog): string => `catalog v${c.version} · ephemeral-ui@${c.rev.slice(0, 7)}`;
