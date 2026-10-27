#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .native-receipts
exec > >(tee .native-receipts/build.log 9>&-) 2>&1
# O15 (laws/release): no green, complete tester-army receipt for this exact commit, no APK.
# Runs before any dependency install, build or signing step.
if ! python3 laws/release/check.py --action install --fetch; then
  printf 'build-native-android: refused by O15 before building or signing anything.\n' >&2
  exit 1
fi
printf 'Native Android build host: %s\n' "$(hostname)"
printf '%s\n' "${DASH_PROOF_REVISION:-uncommitted}" > .native-receipts/source-revision.txt
if [ -f .native-build-inputs/source-revision.txt ]; then cp .native-build-inputs/source-revision.txt .native-receipts/source-revision.txt; fi
if [ -f .native-build-inputs/aodl.bundle ]; then
  if [ ! -d .native-build-inputs/aodl.git ]; then git clone --mirror .native-build-inputs/aodl.bundle .native-build-inputs/aodl.git; fi
  mirror="file://$(realpath .native-build-inputs/aodl.git)"
  export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0="url.$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git
  export GIT_CONFIG_KEY_1="url.$mirror.insteadOf" GIT_CONFIG_VALUE_1=https://github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
elif [ -d "$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git" ]; then
  mirror="file://$HOME/.cache/dash-native-notifications-share-build/.native-build-inputs/aodl.git"
  export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0="url.$mirror.insteadOf" GIT_CONFIG_VALUE_0=ssh://git@github.com/kvnloo/aodl-views.git
  export GIT_CONFIG_KEY_1="url.$mirror.insteadOf" GIT_CONFIG_VALUE_1=https://github.com/kvnloo/aodl-views.git GIT_ALLOW_PROTOCOL=file:https:ssh
fi
# Fleet ships a source snapshot, not the worktree's .git pointer.
if [ ! -e .git ]; then git init -q; fi
bun install --frozen-lockfile
(cd bridge && bun install --frozen-lockfile)
(cd app && bun install --frozen-lockfile)
git add .
if [ ! -f app/node_modules/@shopify/react-native-skia/libs/android/arm64-v8a/libskia.a ]; then
  node app/node_modules/@shopify/react-native-skia/scripts/install-libs.js
fi
if [ "${DASH_NATIVE_ONLY:-0}" != 1 ]; then
  bun app/node_modules/typescript/bin/tsc -p app --noEmit > .native-receipts/typecheck.log 2>&1
  (cd app && CI=1 bun x expo export --platform android --output-dir ../.native-receipts/export) > .native-receipts/export.log 2>&1
else
  printf 'Native-only retry: use the preceding unchanged-source JS gate receipts.\n'
fi
if [ ! -d "$ANDROID_HOME/ndk/27.1.12297006" ] || [ ! -d "$ANDROID_HOME/platforms/android-36" ] || [ ! -d "$ANDROID_HOME/build-tools/36.0.0" ]; then
  shared_sdk="$ANDROID_HOME"
  sdk="$HOME/.cache/dash-native-android-sdk"
  for writable in ndk cmake platforms build-tools; do
    if [ -L "$sdk/$writable" ]; then rm "$sdk/$writable"; fi
    mkdir -p "$sdk/$writable"
    for version in "$shared_sdk/$writable"/*; do
      [ -e "$version" ] || continue
      [ -e "$sdk/$writable/$(basename "$version")" ] || ln -s "$version" "$sdk/$writable/$(basename "$version")"
    done
  done
  for component in "$shared_sdk"/*; do
    name=$(basename "$component")
    case "$name" in ndk|cmake|platforms|build-tools) continue ;; esac
    [ -e "$sdk/$name" ] || ln -s "$component" "$sdk/$name"
  done
  export ANDROID_HOME="$sdk" ANDROID_SDK_ROOT="$sdk"
  if [ ! -d "$sdk/ndk/27.1.12297006" ] || [ ! -d "$sdk/cmake/3.22.1" ] || [ ! -d "$sdk/platforms/android-36" ] || [ ! -d "$sdk/build-tools/36.0.0" ]; then
    "$sdk/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$sdk" 'ndk;27.1.12297006' 'cmake;3.22.1' 'platforms;android-36' 'build-tools;36.0.0'
  fi
fi
(cd app && CI=1 bun x expo prebuild --platform android --no-install)
# DASH_VARIANT=release: standalone RC with the JS bundle embedded (no Metro), signed with
# the same debug keystore as the dev client so it installs in place (app.config.js).
variant="${DASH_VARIANT:-debug}"
case "$variant" in debug) Variant=Debug ;; release) Variant=Release ;; *) echo "DASH_VARIANT must be debug or release" >&2; exit 2 ;; esac
printf 'Variant: %s\n' "$variant" | tee .native-receipts/variant.txt
env | grep ^EXPO_PUBLIC_ | sort | tee .native-receipts/expo-public-env.txt || true
(cd app/android && ./gradlew ":app:assemble$Variant" -PreactNativeArchitectures=arm64-v8a -Pkotlin.compiler.execution.strategy=in-process '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=768m -Dfile.encoding=UTF-8' --max-workers=2 --build-cache --no-daemon)
cp "app/android/app/build/outputs/apk/$variant/app-$variant.apk" .native-receipts/dash-native-arm64.apk
if [ "$variant" = release ]; then
  # The RC must boot without Metro: the Hermes bundle has to be inside the APK.
  # No `grep -q` on a pipe here: with pipefail its early exit SIGPIPEs unzip (exit 141).
  unzip -l .native-receipts/dash-native-arm64.apk assets/index.android.bundle > .native-receipts/embedded-bundle.txt
  cat .native-receipts/embedded-bundle.txt
  grep -F assets/index.android.bundle .native-receipts/embedded-bundle.txt > /dev/null
fi
# Module inclusion: the class and its autolinked registration must be in the APK's dex.
for module in 'Lapp/dash/dex/DashDexModule;' 'Lapp/dash/dex/DashPadActivity;' 'app.dash.dex.DashDexModule' 'Lapp/dash/cutout/DashCutoutModule;' 'Lapp/dash/share/DashShareModule;' 'Lcom/oney/WebRTCModule/WebRTCModule;' 'Lorg/webrtc/PeerConnectionFactory;' 'app.dash.cutout.DashCutoutModule' 'app.dash.share.DashShareModule'; do
  count=$(unzip -p .native-receipts/dash-native-arm64.apk 'classes*.dex' | grep -a -c -F "$module" || true)
  printf '%s %s\n' "$count" "$module"
  [ "$count" -gt 0 ] || { printf 'Required native class absent: %s\n' "$module" >&2; exit 1; }
done | tee .native-receipts/module-inclusion.txt
unzip -l .native-receipts/dash-native-arm64.apk 'lib/*' | tee .native-receipts/native-libs.txt | { grep -c 'libjingle_peerconnection_so.so' || true; } | sed 's/^/libjingle_peerconnection_so.so entries: /' | tee -a .native-receipts/module-inclusion.txt
cp "app/android/app/build/intermediates/merged_manifests/$variant/process${Variant}Manifest/AndroidManifest.xml" .native-receipts/AndroidManifest.xml
python3 scripts/verify-native-manifest.py .native-receipts/AndroidManifest.xml > .native-receipts/manifest-check.json
sha256sum .native-receipts/dash-native-arm64.apk | tee .native-receipts/apk.sha256
signer=$(printf '%s\n' "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)
"$signer" verify --verbose --print-certs .native-receipts/dash-native-arm64.apk | tee .native-receipts/signature.txt
(cd app && node -e 'for (const n of ["expo", "react-native", "react-native-webrtc", "expo-dev-client"]) console.log(n + " " + require(n + "/package.json").version)') > .native-receipts/runtime-dependencies.txt
mkdir -p .native-receipts/runtime-packages
for package in react-native-webrtc base64-js debug ms; do
  rsync -a --exclude=android/ --exclude=ios/ --exclude=common/ "app/node_modules/$package" .native-receipts/runtime-packages/
done
