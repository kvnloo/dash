#!/usr/bin/env bash
# Install (or remove) the live-follow turbo Metro on the Dash host (groot). Reversible.
#
#   scripts/turbo/install-groot.sh                 install + first switch + start the 30 s timer
#   TURBO_FOLLOW_REF=some/branch scripts/turbo/install-groot.sh   follow another branch
#   scripts/turbo/install-groot.sh --uninstall     back to serving the dash-turbo worktree
#
# What it changes (all under the invoking user's home, nothing outside it except the shared release store):
#   ~/.local/lib/dash/channels/bin/dash-channel     this repo's scripts/channels/dash-channel
#                                                   (original kept once as dash-channel.orig-20261028)
#   ~/.local/lib/dash/turbo-live/                   second dash-channel instance: its own mirror + `active` link
#   ~/.config/dash-turbo-live/channels.env          instance config (kept if it exists)
#   ~/.config/systemd/user/dash-turbo-follow.{service,timer}
#   ~/.config/systemd/user/dash-metro-turbo.service.d/60-turbo-live.conf   (WorkingDirectory -> active release)
# The relay (8213), env file and the old worktree are untouched.
set -Eeuo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REF="${TURBO_FOLLOW_REF:-integ/rc3-roadmap-resume-20261027}"
BIN="$HOME/.local/lib/dash/channels/bin/dash-channel"
H="$HOME/.local/lib/dash/turbo-live"
CONF="$HOME/.config/dash-turbo-live"
UNITS="$HOME/.config/systemd/user"
DROPIN="$UNITS/dash-metro-turbo.service.d/60-turbo-live.conf"
sc() { systemctl --user "$@"; }

if [[ "${1:-}" == "--uninstall" ]]; then
  sc disable --now dash-turbo-follow.timer 2>/dev/null || true
  rm -f "$DROPIN" "$UNITS/dash-turbo-follow.service" "$UNITS/dash-turbo-follow.timer"
  sc daemon-reload
  sc restart dash-metro-turbo.service
  echo "uninstalled: dash-metro-turbo.service serves /mnt/zer0models/z0-wt/dash-turbo again."
  echo "kept: $H $CONF (delete by hand). The patched dash-channel stays; original: $BIN.orig-20261028"
  exit 0
fi

[[ -x "$BIN" ]] || { echo "no $BIN: the channel tool is not installed on this host" >&2; exit 1; }
[[ -e "$BIN.orig-20261028" ]] || cp -p "$BIN" "$BIN.orig-20261028"
install -m 0755 "$here/../channels/dash-channel" "$BIN"

mkdir -p "$H" "$CONF" "$UNITS/dash-metro-turbo.service.d" "$HOME/.cache/dash-turbo-metro"
CH="$HOME/.local/lib/dash/channels"
[[ -e "$H/toolchain" ]] || ln -s "$CH/toolchain" "$H/toolchain"
[[ -f "$H/native-baseline" ]] || cp "$CH/native-baseline" "$H/native-baseline"
if [[ ! -f "$CONF/channels.env" ]]; then
  cat >"$CONF/channels.env" <<ENV
# Second dash-channel instance: the live-follow turbo Metro (systemd: dash-metro-turbo.service on 18213, relay 8213).
DASH_CHANNELS_HOME=$H
DASH_CHANNEL_METRO_UNIT=dash-metro-turbo.service
DASH_CHANNEL_METRO_PORT=18213
DASH_CHANNEL_PUBLIC_URL=http://100.113.138.100:8213
DASH_RELEASES_DIR=/mnt/zer0models/releases/dash
DASH_CHANNEL_HEALTH_TIMEOUT=420
# 1 = hold a head until laws/release/check.py --action ota allows it (green tester-army receipt for that exact sha).
DASH_CHANNEL_REQUIRE_RECEIPT=0
DASH_CHANNEL_POST_SWITCH='printf "{\\"at\\":\\"%s\\",\\"sha\\":\\"%s\\",\\"prev\\":\\"%s\\",\\"kind\\":\\"follow\\"}\\n" "\$(date -Is)" "\$DASH_SWITCH_SHA" "\$DASH_SWITCH_PREVIOUS" >> /mnt/zer0models/workspace/zer0/data/operations/dash-turbo/turbo-live-served.jsonl'
ENV
fi
export DASH_CHANNEL_CONF_DIR="$CONF"

# Object store shared with the channel mirror, so the first fetch is incremental.
if [[ ! -d "$H/repo.git" ]]; then
  git init -q --bare "$H/repo.git"
  git -C "$H/repo.git" remote add origin "${DASH_CHANNEL_REPO_URL:-https://github.com/kvnloo/dash.git}"
  mkdir -p "$H/repo.git/objects/info"
  echo "$CH/repo.git/objects" >"$H/repo.git/objects/info/alternates"
fi
"$BIN" init
"$BIN" add turbo "$REF"   # replaces the row when it already exists, so re-running re-points the follower

install -m 0644 "$here/systemd/dash-turbo-follow.service" "$UNITS/dash-turbo-follow.service"
install -m 0644 "$here/systemd/dash-turbo-follow.timer" "$UNITS/dash-turbo-follow.timer"
install -m 0644 "$here/systemd/dash-metro-turbo-live.conf" "$DROPIN"
sc daemon-reload

"$BIN" build turbo >/dev/null
"$BIN" switch turbo
sc enable --now dash-turbo-follow.timer
echo "installed: 8213 follows $REF every 30 s. status: DASH_CHANNEL_CONF_DIR=$CONF $BIN status"
echo "revert: $here/install-groot.sh --uninstall"
