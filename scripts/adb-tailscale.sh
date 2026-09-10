#!/usr/bin/env bash
set -euo pipefail
PHONE="${1:-phone}"
PORT="${ADB_PORT:-5555}"
if ! command -v adb >/dev/null; then
  echo "Install android-tools (adb) first." >&2
  exit 1
fi
if [[ "$PHONE" == *.* ]]; then
  IP="$PHONE"
else
  IP="$(tailscale status --json 2>/dev/null | jq -r --arg n "$PHONE" '
    .Peer[] | select(.DNSName | startswith($n + ".")) | .TailscaleIPs[0] // empty
  ' | head -1)"
  if [[ -z "$IP" ]]; then
    echo "Phone '$PHONE' not online on Tailscale." >&2
    exit 1
  fi
fi
adb connect "${IP}:${PORT}"
adb devices -l
