#!/usr/bin/env bash
# Isolated shell-tool check; never contacts a repo, Metro, systemd or a device.
set -Eeuo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
export DASH_CHANNEL_CONF_DIR="$work/config"
export DASH_CHANNELS_HOME="$work/channels"
export DASH_RELEASES_DIR="$work/channels/releases"
export DASH_CHANNEL_POST_SWITCH=""
# Sourcing with help defines functions without executing a state-changing command.
# shellcheck source=scripts/channels/dash-channel
source "$here/dash-channel" help >/dev/null

release="$REL/fixture"
module="$release/app/modules/dash-x"
mkdir -p "$module/android/src" "$release/app/node_modules" "$H/ch"
printf '{"dependencies":{}}\n' >"$release/app/package.json"
printf '{"expo":{"android":{"package":"app.dash.mobile"}}}\n' >"$release/app/app.json"
printf '{"platforms":["android"]}\n' >"$module/expo-module.config.json"
printf 'class Foo\n' >"$module/android/src/Foo.kt"
printf 'test\tunused\tpin\n' >"$TABLE"
ln -s "$release" "$H/ch/test"

same() { [[ "$1" == "$2" ]] || { printf 'FAIL: %s (%s != %s)\n' "$3" "$1" "$2" >&2; exit 1; }; }
changed() { [[ "$1" != "$2" ]] || { printf 'FAIL: %s (%s unchanged)\n' "$3" "$1" >&2; exit 1; }; printf 'PASS: %s: %s -> %s\n' "$3" "$1" "$2"; }
fp() { native_fp "$release"; }

v2="$(native_fp_v2 "$release")"
legacy="$(native_fp_legacy "$release")"
cmd_baseline test
before="$(fp)"
same "$(<"$H/native-baseline")" "$before" 'baseline writes v3'
[[ "$before" =~ ^v3:[0-9a-f]{16}$ ]]
printf 'class FooChanged\n' >"$module/android/src/Foo.kt"
changed "$before" "$(fp)" 'Kotlin edit'
before="$(fp)"
mkdir -p "$release/app/modules/dash-y"
printf '{}\n' >"$release/app/modules/dash-y/expo-module.config.json"
changed "$before" "$(fp)" 'new module'
before="$(fp)"
printf '{"platforms":["android","ios"]}\n' >"$module/expo-module.config.json"
changed "$before" "$(fp)" 'module config edit'
before="$(fp)"
mkdir -p "$module/ios"
printf 'class Bar {}\n' >"$module/ios/Bar.swift"
changed "$before" "$(fp)" 'iOS source addition'
before="$(fp)"
mv "$module/ios/Bar.swift" "$module/ios/Renamed.swift"
changed "$before" "$(fp)" 'relative path rename'
before="$(fp)"
mkdir -p "$release/app/plugins"
printf 'module.exports = 1;\n' >"$release/app/plugins/with-dex.js"
changed "$before" "$(fp)" 'config plugin addition'
before="$(fp)"
printf 'module.exports = 2;\n' >"$release/app/plugins/with-dex.js"
changed "$before" "$(fp)" 'config plugin edit'
before="$(fp)"
mkdir -p "$module/android/build" "$module/android/.gradle" "$release/app/src"
printf 'docs\n' >"$module/README.md"
printf 'docs\n' >"$module/android/README.md"
printf 'generated\n' >"$module/android/build/Generated.kt"
printf 'cache\n' >"$module/android/.gradle/cache"
printf 'JS only\n' >"$release/app/src/example.js"
printf 'dynamic config\n' >"$release/app/app.config.js"
same "$before" "$(fp)" 'ignore docs, generated files, app/src and app.config.js'
printf 'changed docs\n' >"$module/README.md"
printf 'changed JS\n' >"$release/app/src/example.js"
same "$before" "$(fp)" 'README and JS edits'
printf 'PASS: ignored files leave %s unchanged\n' "$before"

# Exercise the real gate against isolated state. Never restart or probe real services.
restart_metro() { :; }
health() { :; }
if (do_switch test) >"$work/gate.log" 2>&1; then
  printf 'FAIL: v3 baseline accepted changed native sources\n' >&2; exit 1
fi
[[ "$(<"$work/gate.log")" == *'needs different native code'* ]]
printf 'PASS: v3 gate rejects changed native sources\n'
for baseline in "$v2" "$legacy"; do
  printf '%s\n' "$baseline" >"$H/native-baseline"
  do_switch test
  same "$(readlink "$H/active")" "$release" 'compatible baseline switches'
  printf 'PASS: existing baseline compares with its original algorithm: %s\n' "$baseline"
done
cmd_baseline test
do_switch test
printf 'PASS: refreshed v3 baseline switches\n'
