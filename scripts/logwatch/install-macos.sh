#!/usr/bin/env bash
# Install this user's LaunchAgent; does not alter Metro, bridge, or ADB pairings.
set -euo pipefail
[[ $(uname -s) == Darwin ]] || { echo "macOS is required" >&2; exit 1; }
label=dev.dash.logwatch
domain="gui/$(id -u)"
agents="$HOME/Library/LaunchAgents"
plist="$agents/$label.plist"
state="${DASH_LOGWATCH_STATE:-$HOME/.local/state/dash/logwatch}"
if [[ ${1:-} == --uninstall ]]; then
  launchctl bootout "$domain/$label" 2>/dev/null || true
  rm -f "$plist"
  echo "Removed $label; watcher files and incident history remain in $state"
  exit
fi
[[ $# == 2 && $2 == /* && -n $1 ]] || {
  echo "Usage: $0 <adb-serial> <absolute-path-to-bridge.err.log>" >&2; exit 2;
}
command -v adb >/dev/null
python=$(command -v python3)
adb=$(command -v adb)
[[ $python == /* && $adb == /* && $state == /* ]] || { echo "Use absolute tool/state paths" >&2; exit 2; }
"$python" -c 'import sqlite3, sys; assert sys.version_info >= (3, 8)'
here=$(cd "$(dirname "$0")" && pwd)
umask 077
mkdir -p "$agents" "$state"
chmod 700 "$state"
install -m 0600 "$here/watch.py" "$state/watch.py"
temp=$(mktemp "$agents/.dash-logwatch.XXXXXX")
trap 'rm -f "$temp"' EXIT
"$python" - "$temp" "$label" "$python" "$state" "$adb" "$1" "$2" <<'PY'
import plistlib
import sys
from pathlib import Path

dest, label, python, state, adb, serial, bridge_log = sys.argv[1:]
with open(dest, "wb") as out:
    plistlib.dump({
        "Label": label,
        "ProgramArguments": [python, "-u", str(Path(state) / "watch.py"),
                             "--adb", adb, "--serial", serial,
                             "--bridge-log", bridge_log, "--state", state],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 15,
        "StandardOutPath": str(Path(state) / "watch.stdout.log"),
        "StandardErrorPath": str(Path(state) / "watch.stderr.log"),
    }, out)
PY
plutil -lint "$temp"
launchctl bootout "$domain/$label" 2>/dev/null || true
mv "$temp" "$plist"
launchctl bootstrap "$domain" "$plist"
launchctl print "$domain/$label"
