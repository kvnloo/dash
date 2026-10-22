#!/usr/bin/env bash
set -uo pipefail
case "$(hostname)" in groot*) printf 'Refusing CPU qualification on groot\n' >&2; exit 1;; esac
mkdir -p trace-receipts
bash scripts/qualify-trace.sh >trace-receipts/owning-tests-types.txt 2>&1
own=$?
# Fleet excludes the source .git database. This isolated index is for the existing
# real-workspace inventory test, not a claim about source history or candidate SHA.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ -f .git ]; then unlink .git; fi
  git init -q
  git add app bridge shared scripts package.json
fi
bun run test >trace-receipts/root-tests.txt 2>&1; tests=$?
bun run lint >trace-receipts/lint.txt 2>&1; lint=$?
bun x eslint app/src/trace app/src/components/trace app/src/screens/TraceScreen.tsx bridge/src/trace-collect.ts bridge/src/trace-collect.test.ts bridge/src/trace-http.ts bridge/src/trace-http.test.ts shared/trace-evidence.ts shared/trace-evidence.test.ts scripts/capture-trace.ts scripts/trace-proof-server.ts scripts/verify-trace-real.mjs --max-warnings 0 >trace-receipts/trace-lint.txt 2>&1; trace_lint=$?
bun run typecheck >trace-receipts/root-typecheck.txt 2>&1; types=$?
bun run test:mutate >trace-receipts/mutation.txt 2>&1; mutation=$?
schema=99
if [ -n "${TRACE_PROOF_INPUT:-}" ]; then
 (python3 -m venv .trace-schema-env && .trace-schema-env/bin/pip install -q jsonschema==4.25.1 && .trace-schema-env/bin/python scripts/check-trace-hotl.py "$TRACE_PROOF_INPUT") >trace-receipts/aodl-schema.txt 2>&1; schema=$?
fi
(cd app && env CI=1 EXPO_PUBLIC_DEBUG=1 EXPO_PUBLIC_DASH_TURBO=1 bun x expo export --platform android --output-dir dist-trace-android) >trace-receipts/android-export.txt 2>&1; android=$?
(cd app && env CI=1 EXPO_PUBLIC_DEBUG=1 EXPO_PUBLIC_DASH_TURBO=1 bun x expo export --platform web --output-dir dist-trace-web) >trace-receipts/web-export.txt 2>&1; web=$?
if [ "$web" = 0 ]; then
 bun x playwright install chromium >trace-receipts/chromium-install.txt 2>&1
 bun scripts/verify-trace-real.mjs trace-receipts >trace-receipts/visual.txt 2>&1; visual=$?
else visual=99; fi
printf 'owning=%s\ntests=%s\nlint=%s\ntypecheck=%s\nandroid=%s\nweb=%s\nvisual=%s\n' "$own" "$tests" "$lint" "$types" "$android" "$web" "$visual" >trace-receipts/status.txt
printf 'trace_lint=%s\nmutation=%s\naodl_schema=%s\nsource_sha=%s\n' "$trace_lint" "$mutation" "$schema" "${TRACE_CANDIDATE_SHA:-uncommitted-snapshot}" >>trace-receipts/status.txt
printf 'Trace MBP qualification status:\n'; printf '%s\n' "owning=$own tests=$tests lint=$lint types=$types android=$android web=$web visual=$visual"
[ "$own" = 0 ] && [ "$tests" = 0 ] && [ "$lint" = 0 ] && [ "$types" = 0 ] && [ "$android" = 0 ] && [ "$web" = 0 ] && [ "$visual" = 0 ]
