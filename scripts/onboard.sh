#!/usr/bin/env bash
# One command from a fresh clone: make sure a recent Bun exists, then run scripts/onboard.ts.
#
#   scripts/onboard.sh               detect hardware, install deps, bridge + Metro services, list harnesses, pair
#   scripts/onboard.sh --minimal     bridge only (no Metro, no app install)
#   scripts/onboard.sh --dry-run     print the plan and service files; change nothing
#   scripts/onboard.sh --pair        print a fresh pairing code and links for the running bridge
#   scripts/onboard.sh --uninstall   stop and remove the services (keeps ~/.dash and node_modules)
#   scripts/onboard.sh --help
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# The lockfiles are written by this Bun; older ones reject them under --frozen-lockfile. Keep in step with CI.
min=1.4.3

new_enough() { [ "$(printf '%s\n%s\n' "$min" "$1" | sort -V | head -n1)" = "$min" ]; }

bun=""
for candidate in "$(command -v bun || true)" "$HOME/.bun/bin/bun"; do
  [ -n "$candidate" ] && [ -x "$candidate" ] || continue
  if new_enough "$("$candidate" --version 2>/dev/null || echo 0)"; then bun=$candidate; break; fi
done
if [ -z "$bun" ]; then
  case " $* " in
    *" --dry-run "*|*" --help "*|*" -h "*) echo "onboard: Bun $min or newer is required (https://bun.sh); a real run installs it into ~/.bun" >&2; exit 2;;
  esac
  echo "onboard: installing Bun $min into ~/.bun (https://bun.sh/install)" >&2
  curl -fsSL https://bun.sh/install | bash -s "bun-v$min" >&2
  bun=$HOME/.bun/bin/bun
fi
exec "$bun" "$here/onboard.ts" "$@"
