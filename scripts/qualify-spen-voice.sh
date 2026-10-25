#!/usr/bin/env bash
set -euo pipefail
mkdir -p .spen-voice-receipts
cache="$HOME/.cache/dash-interaction-repair-native-20261022"
[ -d "$cache/app/node_modules" ]
[ ! -L app/node_modules ] || rm app/node_modules
ln -s "$cache/app/node_modules" app/node_modules
ln -s "$cache/bridge/node_modules" bridge/node_modules
if [ -d "$cache/node_modules" ]; then ln -s "$cache/node_modules" node_modules; fi
[ -e .git ] || git init -q
git add app bridge shared scripts
bun app/node_modules/typescript/bin/tsc -p app --noEmit > .spen-voice-receipts/typecheck.log 2>&1
bun test app/src/lib/annotate app/src/store/annotate.test.ts app/src/lib/continuous-voice.test.ts > .spen-voice-receipts/focused.log 2>&1
set +e
bun test app/src bridge/src shared > .spen-voice-receipts/unit.log 2>&1
unit=$?
bun scripts/mutate.ts > .spen-voice-receipts/mutation.log 2>&1
mutation=$?
(cd app && CI=1 bun x expo export --platform web --output-dir ../.spen-voice-receipts/web) > .spen-voice-receipts/web-export.log 2>&1
web=$?
printf 'unit=%s mutation=%s web=%s\n' "$unit" "$mutation" "$web" | tee .spen-voice-receipts/result.txt
exit "$((unit || mutation || web))"
