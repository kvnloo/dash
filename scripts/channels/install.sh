#!/usr/bin/env bash
# Install dash-channel and its user units on this host. Idempotent.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="$HOME/.local/lib/dash/channels/bin"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
conf="${XDG_CONFIG_HOME:-$HOME/.config}/dash-channels"
mkdir -p "$bin" "$units" "$conf" "$HOME/.local/bin"
install -m 755 "$here/dash-channel" "$bin/dash-channel"
install -m 755 "$here/metro-relay.py" "$bin/metro-relay.py"
ln -sfn "$bin/dash-channel" "$HOME/.local/bin/dash-channel"
for u in "$here"/systemd/*; do install -m 644 "$u" "$units/$(basename "$u")"; done
[[ -f "$conf/channels.env" ]] || { install -m 600 "$here/channels.example.env" "$conf/channels.env"; echo "fill in $conf/channels.env"; }
systemctl --user daemon-reload
echo "installed. next: dash-channel init; dash-channel add stable <sha> --pin; dash-channel switch stable"
