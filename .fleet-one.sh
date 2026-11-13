#!/bin/bash
set -uo pipefail
cache="$HOME/.cache/dash-lane-qualified-20261025"
exec 9>"$cache.lock"; flock 9
rsync -a --delete --exclude=node_modules --exclude=/.git --exclude=/.lane-receipts ./ "$cache/"
cd "$cache/app" && bun test src/store/store-app-begin.chatgpt-lane.test.ts 2>&1 | grep -v '^\s*$' | head -60
