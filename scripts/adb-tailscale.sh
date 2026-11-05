#!/usr/bin/env bash
# Connect adb to a phone over Tailscale.
#
#   scripts/adb-tailscale.sh [name|tailscale-ip|ip:port]
#   ADB_PORT=<port> scripts/adb-tailscale.sh kevins-s25-ultra
#
# Android 11+ Wireless debugging listens on a random TLS port that changes whenever it is toggled
# (Developer options > Wireless debugging shows it; it is never 5555). Port 5555 only exists after
# `adb tcpip 5555` over USB, so a bare `adb connect <ip>:5555` is refused. This tries, in order:
#   1. a connection that already exists (`adb devices`), including an mDNS-named TLS one
#   2. ip:port given as the argument, or ADB_PORT
#   3. mDNS discovery (`adb mdns services`), which only sees phones on the host's own LAN
#   4. ADB_FALLBACK_PORT (default 5555), the legacy tcpip port
set -euo pipefail
PHONE="${1:-phone}"
if ! command -v adb >/dev/null; then
  echo "Install android-tools (adb) first." >&2
  exit 1
fi

PORT="${ADB_PORT:-}"
if [[ "$PHONE" == *:* ]]; then
  PORT="${PHONE##*:}"; PHONE="${PHONE%:*}"
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

connected() { adb devices | awk -v ip="$IP" 'NR > 1 && $2 == "device" && index($1, ip ":") == 1 {found = 1} END {exit !found}'; }
try_connect() { # ip:port -> 0 when adb reports a connection
  local out
  out="$(timeout 10 adb connect "$1" 2>&1 || true)"
  echo "$out"
  [[ "$out" == *"connected to"* ]]
}

if connected; then
  adb devices -l
  exit 0
fi
if [[ -n "$PORT" ]] && try_connect "$IP:$PORT"; then
  adb devices -l
  exit 0
fi
# mDNS lines look like: adb-<serial>-<id>  _adb-tls-connect._tcp  192.168.1.29:41267
mdns="$(adb mdns services 2>/dev/null | awk '/_adb-tls-connect\._tcp/ {print $NF}' || true)"
for target in $mdns; do
  # Tailscale and LAN addresses differ, so a discovered service counts only when it is the one phone present.
  if [[ "$(wc -w <<<"$mdns")" == 1 ]] && try_connect "$target"; then
    adb devices -l
    exit 0
  fi
done
if try_connect "$IP:${ADB_FALLBACK_PORT:-5555}"; then
  adb devices -l
  exit 0
fi

cat >&2 <<MSG
adb could not reach $IP.
  - Wireless debugging: open Developer options > Wireless debugging on the phone, then run
      ADB_PORT=<the port shown under "IP address & Port"> $0 $PHONE
    (first time only: adb pair $IP:<pairing port> with the pairing code).
  - Fixed port instead: with USB attached run once \`adb tcpip 5555\`; then this script works over Tailscale.
  - mDNS discovery needs the phone on this host's LAN and an adb build with mDNS (the MBP's Arch android-tools has none; the SDK adb on groot does).
MSG
exit 1
