import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Public CI cannot clone the private renderer. Exercise Dash's existing null-renderer
// boundary without publishing private sources or changing the production manifest.
const app = join(import.meta.dir, "..", "app");
const manifestPath = join(app, "package.json");
const lockPath = join(app, "bun.lock");
const originalManifest = readFileSync(manifestPath);
const originalLock = readFileSync(lockPath);
try {
  const manifest = JSON.parse(originalManifest.toString());
  delete manifest.dependencies["@kvnloo/aodl-views"];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  // Bun's text lock has one workspace declaration and one package record for
  // this dependency. Keep every public resolution and integrity hash intact.
  const publicLock = originalLock.toString().replace(/^.*"@kvnloo\/aodl-views":.*\n/gm, "");
  writeFileSync(lockPath, publicLock);
  console.log("Public CI: private AODL renderer excluded; native/private-renderer coverage is not claimed.");
  const install = Bun.spawnSync([process.execPath, "install", "--frozen-lockfile", "--ignore-scripts"], { cwd: app, stdout: "inherit", stderr: "inherit" });
  if (install.exitCode !== 0) process.exitCode = install.exitCode;
} finally {
  writeFileSync(manifestPath, originalManifest);
  writeFileSync(lockPath, originalLock);
}
