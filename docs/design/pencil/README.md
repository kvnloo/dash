# Pencil / pen.dev — Dash official

AI-native canvas. This is the design tool for Dash (not Paper — Paper MCP needs its own desktop login).

## What is actually installed

| Piece | Path | Status |
|-------|------|--------|
| CLI | `~/.npm-global/bin/pen` (`@pen.dev/cli` 0.3.7) | Installed. **Not logged in.** |
| Desktop | `~/.local/opt/pen/pen` | Extracted from the Linux AppImage (no FUSE). **Running.** Super+4 |
| File | `docs/design/pencil/dash.pen` | Schema 2.17; tokens synced to Grok/Zero black |

AppImage originals (optional): `/tmp/dash-design/Pen-linux-x86_64.AppImage`, Paper `paper-desktop-0.5.7x86_64.AppImage`.

## Open the file

Pencil is on Hyprland workspace **4** (`class:pen`). Super+4, then File → Open (do not pass a file argv from this TTY — GTK portal lands on ws 1):

```
/home/you/workspace/dash/docs/design/pencil/dash.pen
```

## Login (required for the Pencil AI agent)

`pen --prompt` and `pen interactive` refuse until:

```sh
export PATH="$HOME/.npm-global/bin:$PATH"
pen login --email you@example.com
# OTP: pen login --email you@example.com --code <otp>
# or:  export PEN_CLI_KEY=pencil_cli_...
```

Then:

```sh
pen --in docs/design/pencil/dash.pen --out docs/design/pencil/dash.pen \
  --prompt "Polish these Dash iPhone screens to Grok History / Grok Chat / Zero tile density. Pure black #000, white underline, user bubble #1f1f1f, assistant no bubble. Bottom @ search. No cyan." \
  --export docs/design/pencil/frames/overview.png --export-scale 2
```

## Frames

HTML source of truth (9 phones): `docs/design/official.html`

Pencil file still has the original 8 frame names: `main-chats` `main-bots` `main-orchestra` `chat` `chat-streaming` `pair` `settings` `voice`. Tokens are `#000` / `#1f1f1f` / white accent.

Captured PNGs: `docs/design/frames/`.
