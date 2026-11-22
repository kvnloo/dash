# Android release settings

On the Dash development client, open **Settings → Release channel**. Stable
uses Metro port 8097 and Preview uses 8098 on the same host as the current
bundle. The current channel is derived from the bundle, not a saved preference.
Switching checks the other server first and flushes drafts before handing off to
the Expo development launcher. Expo Go and embedded bundles cannot use this
switch. Preview branches are selected by the host's existing preview tooling.

## Optional ADB update offer

Set these variables on the bridge co-located with ADB (restart the bridge
through its normal release procedure):

- `DASH_ANDROID_UPDATE_DIR`: absolute path to an immutable staged release
  directory, or an operator-managed symlink to one. Include the build's
  `dash-native-arm64.apk`, `source-revision.txt` (full commit SHA), and
  `version-code.txt` (the APK's actual Android versionCode).
- `DASH_ANDROID_UPDATE_SERIAL`: one already authorized ADB device from
  `adb devices`. Use a bridge trusted by that device owner: its authenticated
  clients may accept the offer for this one configured device.

Stage a signed APK of the same application ID with a strictly greater version
code. The bridge account must have ADB in PATH and access to the release and
its local O15 receipt; this route does not download a missing receipt. Keep the directory and APK immutable; publish the next
release by changing the symlink, not by editing a release in place.

Opening Settings on Android checks automatically. To recheck manually, use
**Check for Android update → Update available → Install via ADB**.
The bridge installs only the staged SHA the owner accepted, through
`scripts/phone-install.sh` (including its O15 gate). **Not now** does not send
an install request. Android may stop the running app when replacing it;
reopen Dash and confirm the new version. No APK is built or installed by
enabling the settings alone.
