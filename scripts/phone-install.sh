#!/usr/bin/env bash
# The supported way to put a Dash APK on a phone. O15 (laws/release) runs first:
# no green, complete tester-army receipt for the APK's exact commit, no install.
#
#   scripts/phone-install.sh --serial SERIAL [--apk PATH] [--sha SHA] [--dry-run]
#
# The commit defaults to the one the APK was built from
# (.native-receipts/source-revision.txt, written by build-native-android.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
serial=""; apk=.native-receipts/dash-native-arm64.apk; sha=""; dry=0
while [ $# -gt 0 ]; do
  case $1 in
    --serial) serial=$2; shift 2 ;;
    --apk) apk=$2; shift 2 ;;
    --sha) sha=$2; shift 2 ;;
    --dry-run) dry=1; shift ;;
    *) echo "usage: $0 --serial SERIAL [--apk PATH] [--sha SHA] [--dry-run]" >&2; exit 2 ;;
  esac
done
built=$(cat "$(dirname "$apk")/source-revision.txt" 2>/dev/null || true)
sha=${sha:-$built}
if [ -n "$built" ] && [ "$sha" != "$built" ]; then
  echo "O15 DENY install: APK was built from ${built:0:12}, not ${sha:0:12}" >&2; exit 1
fi
if [ -z "$sha" ]; then
  echo "O15 DENY install: cannot tell which commit $apk was built from (no source-revision.txt, no --sha)" >&2; exit 1
fi
python3 laws/release/check.py --action install --sha "$sha" --fetch || {
  echo "phone-install: refused; nothing was installed" >&2; exit 1; }
[ -n "$serial" ] || { echo "phone-install: --serial is required" >&2; exit 2; }
[ -f "$apk" ] || { echo "phone-install: no APK at $apk" >&2; exit 2; }
if [ "$dry" = 1 ]; then echo "phone-install: dry run, would install $apk on $serial"; exit 0; fi
exec adb -s "$serial" install -r "$apk"
