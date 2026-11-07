# Release channels

`scripts/channels/dash-channel` lets one host serve the Dash dev client from
named channels and switch between them with a health gate and a rollback.

## Model

| Kind  | Example channels                  | Moves when                                   |
|-------|-----------------------------------|----------------------------------------------|
| pin   | `stable`                          | only by `dash-channel promote <from> stable` |
| track | `main`, `dev`, `nightly`, `preview-*` | `dash-channel build`/`nightly` fetches the branch |

Each build is an immutable release directory named by commit SHA. Releases
whose `app/package.json` and `app/bun.lock` are identical share one
`node_modules` (symlink), so a preview build of a branch with unchanged
dependencies takes seconds and no disk.

One switchable Metro (`dash-channel-metro.service`) serves the release that the
`active` link points to. It runs beside the other Dash Metros on its own port.
A relay (`dash-channel-relay.service`) exposes it on one host address only.

## Switch

```
dash-channel switch preview-turbo   # build, repoint, restart Metro, compile the Android bundle
dash-channel open <adb-serial>       # reload the dev client on a device from the channel Metro
dash-channel rollback                # back to the release that was active before
```

`switch` is health-gated: Metro must report running, serve a manifest and
compile the Android bundle. If it does not, the previous release is restored
and Metro restarted on it.

`switch` also refuses a channel whose native dependencies (app dependencies,
config plugins, Android permissions) differ from the installed dev client,
because that JavaScript would crash on the old native build. After installing a
new dev client, run `dash-channel baseline <channel>`. `--force` overrides.

## Nightly

`dash-channel-nightly.timer` runs `dash-channel nightly` once a night: it
rebuilds every track channel and, if the served channel is a track channel that
moved, re-serves it through the same health gate. The result is in
`nightly-last.tsv` in the state directory. If `DASH_CHANNEL_NOTIFY` is set, it
is called when the outcome differs from the previous night.

## Install on a host

```
scripts/channels/install.sh          # binary, relay, user units, config template
$EDITOR ~/.config/dash-channels/channels.env
dash-channel init
dash-channel add stable <sha> --pin
dash-channel add preview-x <branch>
dash-channel baseline stable
dash-channel switch stable
systemctl --user enable --now dash-channel-relay.service dash-channel-nightly.timer
```

Ports, addresses and paths are host data: they live only in `channels.env`.
