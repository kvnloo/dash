#!/usr/bin/env bash
set -uo pipefail
mkdir -p input-receipts ../input-vendor/aodl-views
# Only the isolated fleet copy: served dependency symlinks do not exist on MBP.
test ! -L app/node_modules || unlink app/node_modules
test ! -L node_modules || unlink node_modules
tar -xf input-aodl-qualification.tar -C ../input-vendor/aodl-views
python3 input-qualification-deps.py
git init -q
git add app/App.tsx app/src bridge/src shared
bun install > input-receipts/install-root.txt 2>&1 || exit $?
(cd app && bun install) > input-receipts/install-app.txt 2>&1 || exit $?
(cd bridge && bun install) > input-receipts/install-bridge.txt 2>&1 || exit $?
status=0
bun run test > input-receipts/tests.txt 2>&1 || status=1
bun run lint > input-receipts/lint.txt 2>&1 || status=1
bun run typecheck > input-receipts/typecheck.txt 2>&1 || status=1
bun scripts/mutate.ts > input-receipts/mutation.txt 2>&1 || status=1
(cd app && ./node_modules/.bin/expo export --platform android --output-dir ../input-receipts/android) > input-receipts/export.txt 2>&1 || status=1
(cd app && ./node_modules/.bin/expo export --platform web --output-dir ../input-receipts/web) > input-receipts/export-web.txt 2>&1 || status=1
if test -f input-render.mjs; then
  bun x playwright install chromium > input-receipts/browser-install.txt 2>&1 || status=1
  node input-render.mjs > input-receipts/render.txt 2>&1 || status=1
  if command -v tesseract >/dev/null; then
    for image in input-receipts/screenshots/*.png; do tesseract "$image" "${image%.png}.ocr" >/dev/null 2>&1; done
  fi
fi
printf '%s\n' "$status" > input-receipts/status.txt
exit "$status"
