import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const directory = new URL("../app/src/vendor/ephemeral-ui/", import.meta.url);
const read = (file) => readFile(new URL(file, directory));
const json = async (file) => JSON.parse(await read(file));
const pin = await json("shared-pin.json");
assert.match(pin.revision, /^[a-f0-9]{40}$/);
const kitArg = process.argv.indexOf("--kit");
const kit = kitArg === -1 ? null : process.argv[kitArg + 1];
if (kit) assert.equal(pin.revision, process.argv[kitArg + 2], "Shared theme and kit must use the same pin");
const paths = ["theme/glide.json", "theme/tokens.schema.json", "catalog/catalog.json"];
assert.deepEqual(Object.keys(pin.files).sort(), [...paths].sort());
for (const path of paths) {
  const local = await read(path.split("/").at(-1));
  assert.equal(createHash("sha256").update(local).digest("hex"), pin.files[path], `${path}: stale vendored copy`);
  if (kit) {
    const upstream = execFileSync("git", ["-C", kit, "show", `${pin.revision}:${path}`]);
    assert.deepEqual(local, upstream, `${path}: differs from the pinned revision`);
  } else if (process.argv.includes("--upstream")) {
    const response = await fetch(`https://raw.githubusercontent.com/kvnloo/ephemeral-ui/${pin.revision}/${path}`, { signal: AbortSignal.timeout(30_000) });
    assert.ok(response.ok, `${path}: upstream HTTP ${response.status}`);
    assert.deepEqual(local, Buffer.from(await response.arrayBuffer()), `${path}: differs from the pinned revision`);
  }
}
const catalog = await json("catalog.json");
const theme = await json("glide.json");
assert.equal(catalog.v, 0);
assert.equal(theme.v, 0);
assert.equal(catalog.version, pin.catalogVersion);
assert.equal(theme.version, pin.themeVersion);
const kinds = new Set();
const fixtures = new Set();
for (const entry of catalog.kinds) {
  assert.ok(!kinds.has(entry.kind) && entry.fixtures.length > 0, `Invalid or uncovered kind: ${entry.kind}`);
  kinds.add(entry.kind);
  for (const fixture of entry.fixtures) {
    assert.ok(!fixtures.has(fixture.id), `Duplicate fixture: ${fixture.id}`);
    assert.equal(fixture.card.kind, entry.kind);
    assert.equal(fixture.props.kind, entry.kind);
    fixtures.add(fixture.id);
  }
}
assert.equal(kinds.size, catalog.count.kinds);
assert.equal(fixtures.size, catalog.count.fixtures);
console.log(`Shared pin ${pin.revision}: Glide ${theme.version}, catalog ${catalog.version}, ${kinds.size} kinds and ${fixtures.size} fixtures`);
