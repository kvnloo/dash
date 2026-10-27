#!/bin/bash
# Start (or restart) the isolated device bridge + dev-client Metro for one candidate SHA on the stack host.
#   start-device-stack.sh <sha>
set -u
sha=$1; only=${2:-all}; B=${DASH_E2E_BASE:-$HOME/dash-e2e-stack}; C=$B/cand/$sha; S=$B/device-state  # stable: pairing credentials survive candidate switches
IP=$(tailscale ip -4 | head -1)
mkdir -p "$S"
# One device stack at a time: stop every earlier candidate's bridge/Metro (ports are fixed).
for st in "$B"/device-state "$B"/device-state-*; do
  for f in bridge metro; do
    [ "$only" = bridge ] && [ "$f" = metro ] && continue
    p="$st/$f.pid"
    if [ -f "$p" ] && kill -0 "$(cat "$p")" 2>/dev/null && grep -q bun "/proc/$(cat "$p")/cmdline"; then
      kill -- "-$(cat "$p")" 2>/dev/null || kill "$(cat "$p")"
    fi
  done
done
sleep 1
cd "$C"
STACK_TAILNET_IP=$IP setsid nohup $HOME/.bun/bin/bun "$B/device-bridge.ts" "$C" "$S" 18530 >"$S/bridge.log" 2>&1 </dev/null &
echo $! >"$S/bridge.pid"
if [ "$only" != bridge ]; then
cd "$C/app"
CI=1 REACT_NATIVE_PACKAGER_HOSTNAME=$IP EXPO_PUBLIC_DEBUG=0 PATH=$HOME/.bun/bin:$PATH \
  setsid nohup nice -n 5 $HOME/.bun/bin/bun node_modules/expo/bin/cli start --dev-client --port 18520 --host lan \
  >"$S/metro.log" 2>&1 </dev/null &
echo $! >"$S/metro.pid"
fi
for i in $(seq 1 60); do
  { [ "$only" = bridge ] || curl -fsm 2 "http://$IP:18520/status" >/dev/null 2>&1; } && ss -ltn | grep -q ":18530 " && break
  sleep 1
done
echo "bridge: $(tail -2 "$S/bridge.log" | tr '\n' ' ')"
echo "metro: $(curl -sm 2 "http://$IP:18520/status")"
ss -ltn | grep -E ':(18530|18520) ' || true
