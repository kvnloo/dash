# Android development build

Dash's installed Android package is `app.dash.mobile`. Expo Go and web still run, but do not register Dash as a share destination or enable native notifications.

## Build on the MBP

Run from the repository root. Do not run installs, prebuild, Gradle or test suites on groot.

```sh
/home/kvn/.local/bin/fleet-build --node mbp --android --cpus 2 --timeout 3600 \
  --fetch .native-receipts --out <receipt-directory> \
  -- bash scripts/fleet-native-android.sh
```

The output is `.native-receipts/dash-native-arm64.apk`. It is a debug-signed development-client APK for arm64 Android phones, not a Play Store release. It requires an available Metro server for its JavaScript. The script runs app typechecking, the app/bridge/shared unit suite, the existing mutation gate, native receiver tests, prebuild and Gradle. It also records the merged manifest and APK signature/checksum. Fleet's source snapshot has no Git metadata, so the script initializes an ephemeral Git inventory for the real-workspace inventory test.

`@kvnloo/aodl-views` remains pinned to the existing Git revision. A worker without private repository credentials can use a local mirror bundle containing that exact revision. Put the bundle at `.native-build-inputs/aodl.bundle` for the fleet transfer, but never commit it. The build script uses a job-scoped Git URL rewrite, not a global credential change.

## Keep turbo and QA live

After integrating in a separate worktree, install its app dependencies and serve that integrated source. Preserve the preview service's existing private environment; do not copy tokens into commands or URLs. The relevant native start command, from `app/`, is:

```sh
CI=false EXPO_PUBLIC_DASH_TURBO=1 \
  REACT_NATIVE_PACKAGER_HOSTNAME=100.113.138.100 \
  /home/kvn/.bun/bin/bun x expo start --dev-client --host lan --port 8098
```

The existing debug/QA flags (`EXPO_PUBLIC_DEBUG`, `EXPO_PUBLIC_DEBUG_AUTONAV`, `EXPO_PUBLIC_DEBUG_SCENARIO`, `EXPO_PUBLIC_DEBUG_BANNER`) still work. Leave debug seeding off for normal dogfooding. `CI=false` is required for the interactive preview's reload/watch loop. CI build/export jobs use CI mode separately. The installed package has its own Android data sandbox, so it does not inherit Expo Go's pairing or saved chats. Pair it normally; never put credentials in the development-client URL.

Open the native development client, not Expo Go:

```sh
adb -s <S25-serial> shell am start -W \
  -a android.intent.action.VIEW -p app.dash.mobile \
  -d 'exp+dash://expo-development-client/?url=http%3A%2F%2F100.113.138.100%3A8098'
```

The APK includes `expo-dev-client`, plus turbo's SDK `expo-intent-launcher` and `react-native-view-shot` native modules. Existing bridge pairing and `:4747` are unchanged. No bridge token goes in the launch URL.

JavaScript/TypeScript and styling changes use Metro Fast Refresh. Native module, native dependency, app config/plugin, permission or manifest changes require another prebuild/APK installation. A Metro bundle resolving successfully does not prove native launch or Fast Refresh on the phone. The rollout owner must install, open the URL, verify a real edit appears, and inspect device/Metro errors before calling it live. Workers must not restart the protected stable/preview services or drive the daily phone.

## Notifications

Settings has an explicit Enable notifications action. It creates a silent, private-lockscreen channel before asking Android for permission. Denied permissions offer the Android settings route; Dash does not repeatedly prompt on launch. Disabling clears existing Dash notifications.

New reply completion, reply errors, and approval/clarification transitions can post generic notifications while Dash is backgrounded and its JavaScript/WebSocket remain alive. Message text, chat titles and error details are not placed in notification previews. Foreground alerts are suppressed, including the scheduling/presentation race. Initial restored history and initial approval snapshots do not generate notification storms.

Chat notifications carry only `dash://chat/<encoded-local-chat-id>`. Tap handling validates the route, waits for hydration/navigation, and opens that chat. Deleted chats fall back to the chat list. Approval notifications open Approvals. No notification executes an action.

**Limit:** there is no FCM configuration, push token registration, remote push sender or Android foreground service in this change. Android may suspend the socket/JavaScript in the background. No notification delivery is promised after suspension, process death, force-stop or reboot. Reliable killed-app delivery needs a separately authorized push service and credentials. Do not claim it was verified from a local notification test.

## Incoming shares

Expo SDK 57 `expo-sharing` registers `ACTION_SEND` and `ACTION_SEND_MULTIPLE` with `*/*`. Its native activity listener stores cold/warm intents and emits the `dash://expo-sharing` callback. The local Expo module consumes that stored intent because the SDK's simple parser does not preserve mixed text/file shares or files typed `text/plain`.

The module reads `EXTRA_TEXT`, `EXTRA_STREAM` and ClipData. It accepts granted `content://` files, copies them to private app cache before use, and never resolves shared web URLs or fetches URL metadata. It does not ask for broad storage permissions or persist source URI grants.

Limits are eight files, 25 MiB per file, 50 MiB per share, 60,000 text characters, a 200 MiB share-cache quota and three pending previews. Copying enforces actual streamed byte counts even when metadata is absent or incorrect. Unsafe file URIs, expired grants, empty files, over-limit and incomplete reads produce preview errors; partial cache files are deleted. File names are sanitized. Orphan cache directories expire after 24 hours on the next receive. Cancel deletes that preview's cache directory.

The preview displays text, names, MIME types, sizes and errors, then offers a destination chat. **Add to draft does not upload or send.** Shared file chips show “On this phone · not uploaded”. The user must separately choose Upload shared files and confirm the destination computer. That uses the existing attachment upload path. Sending the resulting message is another explicit action. Pending local files block Send. Text-only shares are prefilled, never sent automatically. File-bearing sends leave live-surface mode rather than dropping attachments.

## Rollout acceptance

The parent/integration owner should verify on the installed package:

- Open the native development-client URL against the intended integrated preview, then prove Fast Refresh with a visible JS-only edit and undo it.
- Enable/deny/re-enable notifications and check Android settings/channel behavior.
- Complete a real connected reply in the background, tap its notification, and confirm the correct chat opens. Repeat while foregrounded and confirm no duplicate alert.
- Trigger a real approval/clarification and reply error. Inspect generic previews and routing.
- Share a URL, a text/plain file, an arbitrary binary file, multiple files, and a mixed caption/files share from real source apps. Check cold and warm launches, preview errors, cancel cleanup, chat choice, and no upload before explicit confirmation.
- Verify the existing voice, turbo and QA screens from the integrated source. Native imports added later need an APK rebuild.

Native tests use Robolectric and an actual ContentProvider/file descriptor for the receive/copy path. They are not evidence of real source-app grant lifetime, phone UI, OS permission dialogs or killed-app push delivery.
