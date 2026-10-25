#!/usr/bin/env bash
# Run only on a device runner with Expo Go/Main already connected to Metro.
# Never launch or stop Expo Go; never accept a stale screenshot as proof.
set -euo pipefail
cd "$(dirname "$0")/.."

screenshot="artifacts/verify-dash/maestro-nav-chrome.png"
mkdir -p "$(dirname "$screenshot")"
rm -f -- "$screenshot"

maestro test .maestro/nav-dots.yaml
if [[ ! -s "$screenshot" ]]; then
  echo "Nav-dot device gate: Maestro did not produce $screenshot" >&2
  exit 1
fi
bun scripts/assert-nav-dots.ts "$screenshot"
