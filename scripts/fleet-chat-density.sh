set -u
bun install --frozen-lockfile >/dev/null 2>&1; (cd app && bun install --frozen-lockfile >/dev/null 2>&1)
if [ "${UNITS:-0}" = 1 ]; then bun test app/src bridge/src shared 2>&1 | grep -E "^\(fail\)|^ *[0-9]+ (pass|fail)$|Ran " | sort -u; (cd app && bun x tsc --noEmit -p . 2>&1 | tail -8; echo tsc_exit=${PIPESTATUS[0]}); fi
DASH_PROOF_DIR=.chat-density-receipts DASH_PROOF_PORT=${PORT} node scripts/verify-chat-density.mjs 2>&1 | tail -40; echo proof_exit=${PIPESTATUS[0]}
