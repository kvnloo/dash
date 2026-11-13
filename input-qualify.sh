#!/usr/bin/env bash
set -uo pipefail
mkdir -p input-receipts input-vendor/aodl-views
test ! -L app/node_modules || unlink app/node_modules
test ! -L node_modules || unlink node_modules
tar -xf input-aodl-qualification.tar -C input-vendor/aodl-views
python3 - <<'PY'
import json
p='app/package.json'
x=json.load(open(p)); x['dependencies']['@kvnloo/aodl-views']='file:../input-vendor/aodl-views'
open(p,'w').write(json.dumps(x,indent=2)+'\n')
PY
bun install > input-receipts/install-root.txt 2>&1 || exit $?
(cd app && bun install) > input-receipts/install-app.txt 2>&1 || exit $?
status=0
bun test app/src/lib/mic-gesture.test.ts app/src/lib/voice-launch.test.ts > input-receipts/tests.txt 2>&1 || status=1
(cd app && ./node_modules/.bin/tsc --noEmit) > input-receipts/typecheck.txt 2>&1 || status=1
(cd app && ./node_modules/.bin/expo export --platform android --output-dir ../input-receipts/android) > input-receipts/export.txt 2>&1 || status=1
printf '%s\n' "$status" > input-receipts/status.txt
exit "$status"
