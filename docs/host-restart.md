# Hosts that survive restarts, and hosts added through z0bridge (DA-022)

Two owner asks: the computer stays reachable from the phone across crashes and reboots,
and a new computer shows up in Dash without a second pairing code.

## Restarts

| Host | Supervisor | What brings the bridge back |
|---|---|---|
| Studio (macOS) | launchd `dev.kvnloo.dash-bridge`, `dev.kvnloo.dash-metro` | `KeepAlive`, `RunAtLoad` (already live) |
| groot (Linux) | systemd `--user` `dash-bridge.service` | `Restart=always`, `WantedBy=default.target`, lingering |

On groot, from a checkout of this repository:

```sh
scripts/restart/install-groot.sh            # install the unit, enable lingering, enable + start
scripts/restart/install-groot.sh --check    # linger=yes, enabled, active, Restart=always
scripts/restart/install-groot.sh --kill-test  # kill -9 the bridge; systemd restarts it
scripts/restart/install-groot.sh --uninstall  # put back the previous unit, if there was one
```

- The unit runs the deployed release, `~/.local/lib/dash/bridge-current/bridge`, the same
  path `docs/turbo.md` deploys to. Host data (for example `DASH_HOST`, `DASH_IDENTITY*`,
  `DASH_PEER_IDENTITY_FILE`) goes in `~/.config/dash/bridge.env`, never in the unit.
- `loginctl enable-linger` starts the user manager at boot, so the bridge starts before anyone logs in.
- At boot the bridge refuses to start until Tailscale has an IPv4 address. `StartLimitIntervalSec=0`
  and `RestartSec=3` keep systemd retrying until it does.
- `TimeoutStopSec=660` gives a drain (`POST /drain`, up to 10 minutes) time to finish.
- The installer also enables `dash-channel-metro.service` and `dash-channel-relay.service` when
  they are installed (`scripts/channels/install.sh`). Override the list with `DASH_RESTART_UNITS`.
- `~/.dash/token` survives a restart, so the phone reconnects with the pairing it already has.

## One pairing for every host (z0bridge)

Before this change, groot reached another computer's bridge only with that computer's own
token, copied by hand into `~/.dash/peer-roster-tokens.json`. That token was the second pairing.

Now each bridge is enrolled once with z0bridge (the owner runs these on each host; they change
the live z0bridge registry, so run them on purpose):

```sh
# On every host whose chats should appear: verify z0bridge tokens (docs/z0bridge-identity.md).
z0bridge enroll-local --app dash --label dash-verifier --scope z0bridge:introspect --out ~/.dash/z0bridge-verifier.json
# On the bridge the phone is paired with: mint tokens to present to the other hosts.
z0bridge enroll-local --app dash --label dash-peer --scope dash:chat --out ~/.dash/z0bridge-peer.json
```

```text
# ~/.config/dash/bridge.env on the paired bridge
DASH_PEER_IDENTITY_FILE=/absolute/path/to/.dash/z0bridge-peer.json
DASH_PEER_PORT=4747
```

The paired bridge discovers tailnet computers with `tailscale status`. For each one that has no
explicit entry in `peer-roster-tokens.json`, it presents a short-lived (120 s) `aud: dash`,
`dash:chat` token minted from that enrollment, and asks for `GET /roster?local=1`. A host that
verifies the same z0bridge issuer and pinned key accepts the token. Its chats then appear in
Chats and Hosts. Nobody types a code on the phone, and no token is copied between computers.

- A host on another z0bridge, or one with no identity verification, answers 401 and stays without chats.
- A refused or unreachable z0bridge leaves those peers undiscovered. The bridge never falls
  back to its own token.
- Explicit `peer-roster-tokens.json` entries still take precedence.
- Tradeoff: every tailnet computer listening on `DASH_PEER_PORT` receives the minted token. Any
  Dash bridge on the same z0bridge accepts that token until it expires (at most 120 s). Use tailnet
  ACLs to limit which computers can reach :4747. Revoking the `dash-peer` enrollment stops new
  tokens at once. A token already minted still works offline until it expires.

Peer rows stay view-only, as before (`e2e/mbp-army/README.md`, mesh roster).

## Proof

`e2e/mbp-army/host-restart.spec.ts` (features `host-restart-groot`, `z0bridge-mesh-host-add`).
Reboots and the S25 itself are device checks. See the lane report.
