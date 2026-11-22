#!/usr/bin/env bash
# Keep the Dash bridge (and the dev-client Metro) up across crashes and reboots on a Linux
# host, with systemd --user. The Studio uses launchd KeepAlive; this is the groot half.
#
#   scripts/restart/install-groot.sh               install dash-bridge.service, enable lingering,
#                                                  enable + start it and the Metro units that exist
#   scripts/restart/install-groot.sh --check       report linger / enabled / active / restart policy
#   scripts/restart/install-groot.sh --kill-test   kill -9 the bridge and wait for systemd to restart it
#   scripts/restart/install-groot.sh --render DIR  only write the unit files to DIR (review, tests)
#   scripts/restart/install-groot.sh --uninstall   disable and remove dash-bridge.service (linger kept)
#
# Lingering (loginctl enable-linger) is what makes the user manager, and so default.target,
# start at boot without anyone logging in. Without it the units only start at the first login.
# Extra units to keep enabled: DASH_RESTART_UNITS (default: the channel Metro and its relay,
# when their unit files are installed; see scripts/channels/install.sh).
# Host data stays in ~/.config/dash/bridge.env, never in the unit or in this repo.
set -Eeuo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNITS="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ENVF="${XDG_CONFIG_HOME:-$HOME/.config}/dash/bridge.env"
BRIDGE=dash-bridge.service
EXTRA="${DASH_RESTART_UNITS:-dash-channel-metro.service dash-channel-relay.service}"
sc() { systemctl --user "$@"; }
present() { [[ -f "$UNITS/$1" ]] || sc cat "$1" >/dev/null 2>&1; }

case "${1:-}" in
  --render)
    dir="${2:?usage: --render DIR}"; mkdir -p "$dir"
    install -m 0644 "$here/systemd/$BRIDGE" "$dir/$BRIDGE"
    echo "$dir/$BRIDGE"; exit 0 ;;
  --uninstall)
    sc disable --now "$BRIDGE" 2>/dev/null || true
    if grep -q 'managed-by: dash scripts/restart' "$UNITS/$BRIDGE" 2>/dev/null; then rm -f "$UNITS/$BRIDGE"; fi
    [[ -f "$UNITS/$BRIDGE.orig" ]] && mv "$UNITS/$BRIDGE.orig" "$UNITS/$BRIDGE"
    sc daemon-reload
    echo "removed $BRIDGE (a previous unit, if any, was restored). Lingering left as is: loginctl disable-linger $USER"
    exit 0 ;;
  --check)
    bad=0
    linger="$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo unknown)"
    echo "linger            $linger"; [[ "$linger" == yes ]] || bad=1
    for u in "$BRIDGE" $EXTRA; do
      present "$u" || { [[ "$u" == "$BRIDGE" ]] && { echo "$u  not installed"; bad=1; }; continue; }
      en="$(sc is-enabled "$u" 2>/dev/null || true)"; ac="$(sc is-active "$u" 2>/dev/null || true)"
      printf '%-30s enabled=%s active=%s %s\n' "$u" "$en" "$ac" "$(sc show "$u" -p Restart -p NRestarts -p MainPID | tr '\n' ' ')"
      [[ "$en" == enabled && "$ac" == active ]] || bad=1
    done
    exit "$bad" ;;
  --kill-test)
    old="$(sc show "$BRIDGE" -p MainPID --value)"
    [[ "$old" =~ ^[1-9][0-9]*$ ]] || { echo "$BRIDGE is not running" >&2; exit 1; }
    kill -9 "$old"; echo "killed -9 bridge pid $old"
    for _ in $(seq 1 60); do
      new="$(sc show "$BRIDGE" -p MainPID --value)"
      if [[ "$new" =~ ^[1-9][0-9]*$ && "$new" != "$old" && "$(sc is-active "$BRIDGE")" == active ]]; then
        echo "restarted: pid $new ($(sc show "$BRIDGE" -p NRestarts | tr -d '\n'))"; exit 0
      fi
      sleep 1
    done
    echo "bridge did not come back within 60 s" >&2; exit 1 ;;
  "") ;;
  *) echo "unknown option: $1" >&2; exit 2 ;;
esac

command -v systemctl >/dev/null || { echo "systemctl not found: this installer is for systemd hosts" >&2; exit 1; }
[[ -x "$HOME/.bun/bin/bun" ]] || { echo "no $HOME/.bun/bin/bun (the unit's ExecStart)" >&2; exit 1; }
[[ -f "$HOME/.local/lib/dash/bridge-current/bridge/index.ts" ]] \
  || { echo "no bridge release at ~/.local/lib/dash/bridge-current (see docs/turbo.md, Bridge deploys)" >&2; exit 1; }

mkdir -p "$UNITS" "$(dirname "$ENVF")"
# Keep a hand-made unit once, so --uninstall can put it back.
if [[ -f "$UNITS/$BRIDGE" ]] && ! grep -q 'managed-by: dash scripts/restart' "$UNITS/$BRIDGE"; then
  cp -p "$UNITS/$BRIDGE" "$UNITS/$BRIDGE.orig"
fi
changed=1; cmp -s "$here/systemd/$BRIDGE" "$UNITS/$BRIDGE" && changed=0
install -m 0644 "$here/systemd/$BRIDGE" "$UNITS/$BRIDGE"
[[ -f "$ENVF" ]] || install -m 0600 /dev/null "$ENVF"

if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]]; then
  loginctl enable-linger "$USER"
fi
sc daemon-reload
sc enable "$BRIDGE"
# A changed unit needs a restart; that cancels running turns, so drain first (docs/turbo.md)
# when the bridge is busy. An unchanged unit is only started. The phone reconnects on its own.
if [[ "$changed" == 1 ]]; then sc restart "$BRIDGE"; else sc start "$BRIDGE"; fi
for u in $EXTRA; do present "$u" && sc enable --now "$u"; done
"$0" --check
