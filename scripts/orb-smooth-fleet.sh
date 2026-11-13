#!/usr/bin/env bash
# Run ONLY via fleet-build on MBP; all edits below affect the shipped snapshot.
set -euo pipefail
mode=${1:-baseline}
case "$mode" in baseline|after) ;; *) printf 'Usage: bash scripts/orb-smooth-fleet.sh baseline|after\n' >&2; exit 2 ;; esac
if [ "$(hostname -s)" != mbp ]; then printf 'Refusing CPU/render workload outside mbp.\n' >&2; exit 2; fi
root="$PWD"
out="$root/scripts/orb-smooth-results/$mode"
mkdir -p "$out"
exec > >(tee "$out/run.log") 2>&1
printf 'node=%s mode=%s\n' "$(hostname)" "$mode"
cache=${DASH_ORB_DEPS:-$HOME/.cache/dash-native-notifications-share-build}
for d in "$cache/app/node_modules" "$cache/node_modules/playwright"; do
  [ -d "$d" ] || { printf 'Missing preinstalled worker dependencies: %s (no automatic install)\n' "$d"; exit 3; }
done
# Snapshot has no node_modules. Read existing dependencies; never install on groot.
[ -e app/node_modules ] || ln -s "$cache/app/node_modules" app/node_modules
[ -e node_modules ] || ln -s "$cache/node_modules" node_modules
if [ "$mode" = baseline ]; then tar -xf scripts/orb-smooth-baseline.tar; fi
node - "$mode" "$out" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const [mode,out] = process.argv.slice(2);
const files = ['app/src/components/AgentOrb.tsx', 'app/src/components/OrbMotion.tsx', 'app/src/lib/orb-phase.ts', 'app/src/motion-ambient.ts', 'app/src/theme.ts', 'app/src/turbo.ts'];
fs.mkdirSync(out + '/source', { recursive:true });
const sources = files.map(file => {
  const contents = fs.readFileSync(file);
  fs.writeFileSync(out + '/source/' + file.split('/').pop(), contents);
  return { file, sha256:crypto.createHash('sha256').update(contents).digest('hex') };
});
const dependencies = Object.fromEntries(['expo','react','react-native','react-native-web','react-native-svg','react-native-reanimated','react-native-worklets','@react-navigation/native','@react-navigation/native-stack'].map(name => [name, JSON.parse(fs.readFileSync('app/node_modules/' + name + '/package.json','utf8')).version]));
dependencies.playwright = JSON.parse(fs.readFileSync('node_modules/playwright/package.json','utf8')).version;
fs.writeFileSync(out + '/provenance.json', JSON.stringify({mode, dependencies, baselineRevision: mode === 'baseline' ? '8c32128a68f1cd8026b7090f66a8d39bd5360e29' : null, node:os.hostname(), platform:os.platform(), release:os.release(), cpus:os.cpus().map(x=>x.model), nodeVersion:process.version, turbo:process.env.EXPO_PUBLIC_DASH_TURBO ?? '0', sources}, null, 2));
// Isolated entry in remote snapshot. No changes to shared worktree's app files.
fs.copyFileSync('scripts/orb-smooth-entry.jsx','app/orb-smooth-entry.jsx');
fs.writeFileSync('app/index.ts', 'import {registerRootComponent} from "expo"; import Fixture from "./orb-smooth-entry"; registerRootComponent(Fixture);\n');
NODE
export CI=1
export EXPO_PUBLIC_DASH_TURBO=${EXPO_PUBLIC_DASH_TURBO:-0}
(cd app && bun x --no-install expo export --platform web --output-dir "$out/site" --max-workers 2)
node scripts/orb-smooth-measure.mjs "$out/site" "$out"
node scripts/orb-smooth-analyze.mjs "$out"
