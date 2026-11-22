#!/usr/bin/env bash
# Supplementary native tester-army evidence; never an O15 receipt.
set -euo pipefail

if [[ $# != 2 ]]; then
  echo "Usage: $0 <native-build-receipt-dir> <new-evidence-dir>" >&2
  exit 2
fi
build=$(realpath -m "$1")
out=$(realpath -m "$2")
mkdir "$out"
cd "$(dirname "$0")/.."
sha=$(git rev-parse HEAD)
apk_hash=
model=
stage=o15
stop() {
  local rc=$?
  python3 - "$out" "$sha" "$apk_hash" "$model" "$stage" "$rc" <<'PY'
import datetime
import json
import pathlib
import sys

directory, sha, apk_hash, model, stage, code = sys.argv[1:]
out = pathlib.Path(directory)
report = out / "playwright.json"
try:
    stats = json.loads(report.read_text())["stats"]
except (OSError, KeyError, ValueError):
    stats = {}
result = {
    "schema": "dash-device-army/v1",
    "finished_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "source_sha": sha,
    "apk_sha256": apk_hash or None,
    "model": model or None,
    "stage": stage,
    "exit_code": int(code),
    "passed": stats.get("expected", 0),
    "failed": stats.get("unexpected", 0),
    "skipped": stats.get("skipped", 0),
}
(out / "receipt.json").write_text(json.dumps(result, indent=2) + "\n")
PY
}
trap stop EXIT
python3 laws/release/check.py --action install
stage=apk-verification
apk="$build/dash-native-arm64.apk"
test "$(cat "$build/source-revision.txt")" = "$sha"
apk_hash=$(sha256sum "$apk" | cut -d' ' -f1)
test "$(cut -d' ' -f1 "$build/apk.sha256")" = "$apk_hash"
: "${ANDROID_HOME:?Set ANDROID_HOME to the build Android SDK}"
tools=$(find "$ANDROID_HOME/build-tools" -name aapt -type f -printf '%h\n' | sort -V | tail -1)
"$tools/apksigner" verify "$apk"
badging=$("$tools/aapt" dump badging "$apk")
grep -E "^package: name='app\.dash\.mobile\.e2e' " <<<"$badging" > /dev/null
grep -F 'assets/index.android.bundle' < <(unzip -Z -1 "$apk") > /dev/null
bash scripts/build-native-android.sh --check-apk "$apk"

stage=device-preflight
: "${DEVICE_ARMY_SERIAL:?Set DEVICE_ARMY_SERIAL to the dedicated lab S25 USB adb serial}"
[[ "$DEVICE_ARMY_SERIAL" =~ ^[a-zA-Z0-9_-]+$ ]]
model=$(adb -s "$DEVICE_ARMY_SERIAL" shell getprop ro.product.model | tr -d '\r')
[[ "$model" =~ ^SM-S93[168][A-Z0-9]*$ ]] || { echo 'Expected a dedicated Galaxy S25, S25+ or S25 Ultra' >&2; exit 1; }
[[ "$(adb -s "$DEVICE_ARMY_SERIAL" shell getprop sys.boot_completed | tr -d '\r')" == 1 ]]
stage=install
adb -s "$DEVICE_ARMY_SERIAL" install -r "$apk"
stage=journeys
export DEVICE_ARMY_READY=1 DEVICE_ARMY_JSON="$out/playwright.json"
node node_modules/playwright/cli.js test -c e2e/mbp-army/device.config.ts --output "$out/results"
python3 - "$DEVICE_ARMY_JSON" <<'PY'
import json
import sys

with open(sys.argv[1]) as report:
    stats = json.load(report)["stats"]
if stats["expected"] < 1 or any(stats[key] for key in ("unexpected", "skipped", "flaky")):
    raise SystemExit("Device army did not pass every discovered journey")
PY
stage=complete
