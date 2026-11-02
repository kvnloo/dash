#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Compile the Android Metro bundle with the same turbo flag used by the phone.
# This is not a native APK build and intentionally does not run bun test.
output_dir="$(mktemp -d)"
trap 'rm -rf -- "$output_dir"' EXIT
(cd app && CI=1 EXPO_PUBLIC_DASH_TURBO=1 bun x expo export --platform android --output-dir "$output_dir")
