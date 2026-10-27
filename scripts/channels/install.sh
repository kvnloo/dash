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
# Pinned bun for channel installs (BUN_VERSION in dash-channel), checksum-verified.
bun_version="${DASH_CHANNEL_BUN_VERSION:-1.4.3}"
bun_dir="$HOME/.local/lib/dash/channels/toolchain/bun-$bun_version"
if [[ ! -x "$bun_dir/bun" ]]; then
  tmp="$(mktemp -d)"
  base="https://github.com/oven-sh/bun/releases/download/bun-v$bun_version"
  curl -fsSL -o "$tmp/bun-linux-x64.zip" "$base/bun-linux-x64.zip"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt"
  (cd "$tmp" && grep ' bun-linux-x64.zip$' SHASUMS256.txt | sha256sum -c -)
  unzip -q "$tmp/bun-linux-x64.zip" -d "$tmp"
  mkdir -p "$bun_dir"
  install -m 755 "$tmp/bun-linux-x64/bun" "$bun_dir/bun"
  rm -rf "$tmp"
fi
"$bun_dir/bun" --version
for u in "$here"/systemd/*; do install -m 644 "$u" "$units/$(basename "$u")"; done
[[ -f "$conf/channels.env" ]] || { install -m 600 "$here/channels.example.env" "$conf/channels.env"; echo "fill in $conf/channels.env"; }
systemctl --user daemon-reload
echo "installed. next: dash-channel init; dash-channel add stable <sha> --pin; dash-channel switch stable"
