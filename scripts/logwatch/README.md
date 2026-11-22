# Dash log watcher (macOS)

On the Mac that can reach the owner-approved, already paired S25 via ADB and
read the bridge's stderr log, find the serial with `adb devices -l`. If needed,
read the bridge's LaunchAgent with `launchctl print` and use its
`StandardErrorPath` (or the corresponding path in its plist).

Install as the logged-in Mac user, with Python 3.8+ and Android Platform Tools
on PATH:

```sh
scripts/logwatch/install-macos.sh "$ADB_SERIAL" "$BRIDGE_ERR_LOG"
launchctl print "gui/$(id -u)/dev.dash.logwatch"
```

The LaunchAgent runs at login and restarts on exit. It follows the selected
device's main `app.dash.mobile` process, picks up its next PID after a
restart, and reads only `ReactNativeJS` error-level lines. An idle/locked
phone may disconnect; the watcher retries discovery without switching phones.
If wireless debugging changes its endpoint, rerun the installer with the
new serial. The bridge file starts at EOF on service startup and follows file
replacement; new files are read from the beginning. The watcher recognizes
`error:`, `fatal:`, bracketed error/fatal levels, and uncaught-exception or
unhandled-rejection messages on bridge stderr.

Each distinct error atomically creates an incident row and an open task in a
private local SQLite queue. Recurrences less than five minutes apart update
the incident without duplicating the task. The queue stores only source,
timestamps, counts and a hash, not raw errors, logs or credentials. Use the
source and timestamps to inspect the original log locally. The service never
sends network messages other than ADB, runs fixes, edits the app, or files
public issues. This is live triage, not a durable backlog reader: events while
the watcher or ADB is down may be missed.

```sh
state="${DASH_LOGWATCH_STATE:-$HOME/.local/state/dash/logwatch}"
sqlite3 -header -column "$state/logwatch.sqlite3" \
  'SELECT id, source, datetime(first_seen, "unixepoch") AS detected_utc,
          occurrences, status, title
     FROM incidents JOIN tasks ON id = incident_id ORDER BY id DESC LIMIT 20;'
```

The on-call operator can mark a task resolved with
`UPDATE tasks SET status='resolved' WHERE incident_id=<reviewed-id>;`.
For runtime diagnostics see `watch.stdout.log` and `watch.stderr.log` in
the state directory. `scripts/logwatch/install-macos.sh --uninstall` unloads
the job and leaves the queue and diagnostics intact.
