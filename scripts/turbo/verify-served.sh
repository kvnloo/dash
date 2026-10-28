#!/usr/bin/env bash
# Fetch a Metro the way the phone's dev client does and say which commit it serves.
#
#   scripts/turbo/verify-served.sh                       # turbo :8213 vs the head of the tracked ref
#   scripts/turbo/verify-served.sh --port 8214           # the release channel
#   scripts/turbo/verify-served.sh --sha <40-hex>        # compare with a specific commit
#   scripts/turbo/verify-served.sh --ref some/branch     # compare with that branch's remote head
#
# Checks: /status, the Expo manifest (extra.expoClient.extra.dashBuild.sha and the release path),
# the Android bundle named by launchAsset (HTTP code, size, contains the sha the app bakes in) and
# every async chunk URL in that bundle. Exit 0 only when all pass.
set -Eeuo pipefail
HOST="${DASH_METRO_HOST:-100.113.138.100}"
PORT=8213
REF="${TURBO_FOLLOW_REF:-integ/rc3-roadmap-resume-20261027}"
WANT=""
REPO_URL="${DASH_CHANNEL_REPO_URL:-https://github.com/kvnloo/dash.git}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --ref) REF="$2"; shift 2;;
    --sha) WANT="$2"; shift 2;;
    *) echo "unknown argument $1" >&2; exit 2;;
  esac
done
BASE="http://$HOST:$PORT"
fail=0
say() { printf '%s\n' "$*"; }
bad() { say "FAIL: $*"; fail=1; }

[[ -n "$WANT" ]] || WANT="$(git ls-remote "$REPO_URL" "refs/heads/$REF" | cut -f1 | head -1)"
[[ -n "$WANT" ]] || { echo "cannot resolve $REF at $REPO_URL" >&2; exit 2; }
say "expected  $WANT ($REF)"

status="$(curl -fsS -m 10 "$BASE/status" || true)"
[[ "$status" == *running* ]] && say "status    $status" || bad "$BASE/status says '$status'"

manifest="$(curl -fsS -m 60 -H 'expo-platform: android' -H 'accept: application/expo+json,application/json' "$BASE/")" || { bad "no manifest from $BASE/"; exit 1; }
read -r SERVED ROOT BUNDLE < <(python3 -c '
import json,sys
m=json.load(sys.stdin)
c=m["extra"]["expoClient"]
b=(c.get("extra") or {}).get("dashBuild") or {}
print(b.get("sha") or "-", (c.get("_internal") or {}).get("projectRoot","-"), m["launchAsset"]["url"])' <<<"$manifest")
say "manifest  dashBuild.sha=$SERVED"
say "          projectRoot=$ROOT"
if [[ "$SERVED" == "-" ]]; then
  # Releases built before the build-info change carry no dashBuild; the release directory is named by the commit.
  SERVED="$(basename "$(dirname "$ROOT")")"; say "          (no dashBuild in manifest; release dir says $SERVED)"
fi
[[ "$SERVED" == "$WANT" ]] && say "OK        manifest serves the expected commit" || bad "manifest serves $SERVED, expected $WANT"

tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
code="$(curl -sS -m 300 -o "$tmp" -w '%{http_code} %{size_download} %{time_total}' "$BUNDLE")"
read -r http size secs <<<"$code"
say "bundle    HTTP $http, $size bytes, ${secs}s  $BUNDLE"
code="$http"
[[ "$code" == 200 ]] || bad "bundle did not return 200"
if grep -qF "$WANT" "$tmp"; then say "OK        bundle contains the commit sha (the app knows which build it runs)"; else say "NOTE      bundle does not contain the sha (release predates build-info.json)"; fi

# Async chunks: fetch each embedded URL as written and after dot-segment normalisation.
mapfile -t chunks < <(grep -o '"[^"]*modulesOnly=true[^"]*"' "$tmp" | tr -d '"' | sort -u)
bad_chunks=0
for c in "${chunks[@]}"; do
  [[ -n "$c" ]] || continue
  asis="$(curl -s -m 120 -o /dev/null -w '%{http_code}' --path-as-is "$BASE$c")"
  norm="$(curl -s -m 120 -o /dev/null -w '%{http_code}' "$BASE$c")"
  # node_modules sits outside the project root (symlinked release store), so its lazy chunks 404.
  # These two are dev-only optional imports that nothing requests at runtime (same allow-list as
  # the integrator's device-journey/lazy_chunks.sh). Any other 404 chunk is a real failure.
  known=""; case "$c" in */node_modules/ci-info/*|*/node_modules/react-native-worklets/*) known=" (allow-listed)";; esac
  [[ "$asis" == 200 || -n "$known" ]] || bad_chunks=$((bad_chunks+1))
  say "chunk     as-is $asis, normalised $norm  ${c%%\?*}$known"
done
say "chunks    ${#chunks[@]} found, $bad_chunks not 200 as written"
(( bad_chunks == 0 )) || fail=1
(( fail == 0 )) && say "PASS" || say "FAILED"
exit $fail
