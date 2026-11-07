#!/usr/bin/env bash
# Dash send laws, one command: anchors (the code still reads as modeled), the
# proofs rechecked by Bend's proven kernel, then every mutant.
#
#   laws/send/run.sh            # here
#   laws/send/run.sh --heavy    # on the heavy build host: take the heavy slot first
#
# Exit 0 only when every anchor is in place, PROOF.bend prints ALL PROOFS CHECK
# under --verdict, and every mutant is rejected. Writes laws/send/mutations.json.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
export BEND="${BEND:-$HOME/.bend/bin/bend}"
export BEND_NO_TELEMETRY=1
export PATH="$PATH:$HOME/.elan/bin"

if [ "${1:-}" = "--heavy" ]; then
  shift
  exec flock -w 7200 "${HEAVY_SLOT_LOCK:-$HOME/tmp/heavy-slot.lock}" "$0" "$@"
fi

echo "== anchors"
python3 "$here/anchors.py"

echo "== proofs (--verdict)"
out=$(cd "$here" && "$BEND" PROOF.bend --verdict 2>&1) || true
echo "$out"
case "$out" in
  *"SOME PROOFS FAIL"*) exit 1 ;;
  *"ALL PROOFS CHECK"*) ;;
  *) exit 1 ;;
esac

echo "== mutants"
python3 "$here/mutations.py" --out "$here/mutations.json"
