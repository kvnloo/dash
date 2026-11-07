#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .native-js-receipts
exec > >(tee .native-js-receipts/verification.log) 2>&1
printf 'JavaScript verification host: %s\n' "$(hostname)"
if [ ! -e .git ]; then git init -q; fi
bun install --frozen-lockfile
(cd bridge && bun install --frozen-lockfile)
(cd app && bun install --frozen-lockfile)
bun run typecheck > .native-js-receipts/typecheck.log 2>&1
bun x eslint . --max-warnings 0 > .native-js-receipts/lint.log 2>&1
bun test app/src bridge/src shared > .native-js-receipts/unit.log 2>&1
(cd app && CI=1 EXPO_PUBLIC_DASH_TURBO=1 EXPO_PUBLIC_DEBUG=1 EXPO_PUBLIC_DEBUG_AUTONAV=0 bun x expo export --platform android --output-dir ../.native-js-receipts/android)
(cd app && CI=1 bun x expo export --platform web --output-dir ../.native-js-receipts/web)
(cd app && bun x expo-modules-autolinking resolve --platform android --json) > .native-js-receipts/expo-autolinking.json
