#!/usr/bin/env bash
set -euo pipefail
# fleet copies symlinks, not the served checkout they point at. Remote job only.
case "$(hostname)" in groot*) printf 'Refusing CPU qualification on groot\n' >&2; exit 1;; esac
for modules in node_modules app/node_modules bridge/node_modules; do
  if [ -L "$modules" ]; then unlink "$modules"; fi
done
bun install --frozen-lockfile
(cd app && bun install --frozen-lockfile)
(cd bridge && bun install --frozen-lockfile)
bun test bridge/src/trace-http.test.ts bridge/src/trace-collect.test.ts app/src/trace shared/trace-evidence.test.ts
bun app/node_modules/typescript/bin/tsc -p app --noEmit
bun bridge/node_modules/typescript/bin/tsc -p bridge --noEmit
