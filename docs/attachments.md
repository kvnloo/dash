# Attachments and Send to phone

## Phone → host (attach)

1. The composer's paperclip opens **Photos** (`expo-image-picker`) or **Files** (`expo-document-picker`). Both are Expo SDK modules and work in Expo Go. On web the file dialog covers both.
2. Each pick becomes a chip and uploads at once: `POST http://<bridge>/attachments?name=<file name>` with the raw bytes, `Content-Type` set to the file's MIME and `Authorization: Bearer <execution token>`. This rides the existing tailnet connection (WireGuard encrypts it end to end). There is no public endpoint, and the query-string token is refused on this route.
3. Limits: 25 MB per file and 8 files per message (`shared/protocol.ts`). The phone refuses an oversize file before uploading; the bridge enforces the same cap while streaming the body.
4. The bridge replies `{ id, name, mime, size }`. Send stays disabled until every chip has uploaded. The chat message carries `attachments: [{ id, name, mime, size }]`. The field is optional, so old phones and old bridges still work. A malformed list fails the message closed.
5. Storage: `DASH_ATTACHMENT_DIR` or `<DASH_CREDENTIAL_DIR>/attachments` (default `~/.dash/attachments`). Directories are 0700 and files 0600. Uploads wait in `staging/<id>/` and are removed after 24 h if unused. When a turn starts, its files move to `<root>/<turn id>/<sanitized name>`. Names lose directories, control characters, shell metacharacters and leading dots, and are capped at 120 characters. An unknown or reused id rejects the turn with "Attach it again".

## Per-harness behaviour

Every harness gets the same text: the prompt, then a block listing each file's absolute path, MIME and size (`promptWithAttachments` in `bridge/src/attachments.ts`).

| Route | What else it gets |
|-------|-------------------|
| ACP (default: OMP, Hermes new chats, Grok, Claude and Codex adapters) | One extra prompt block per file. An image (png, jpeg, gif or webp, up to 5 MB) is sent inline as an ACP `image` block when the agent advertises `promptCapabilities.image`. Everything else is sent as a `resource_link` with a `file://` URI, which every ACP agent must accept. The Hermes ACP adapter reads `resource_link` files itself and inlines images. |
| Hermes native API (reply into an existing session) | Paths in the text. Hermes opens them with its file and vision tools. |
| Legacy CLI (`DASH_ENABLE_LEGACY_CLI=1`) | Paths in the text. |

## Host → phone (Send to phone)

When a finished reply names an absolute file path, the message shows a **Send to phone** chip for each one (up to 3). Tapping it asks for confirmation, then calls `POST /share { "path": ... }` with the bearer token. The bridge pushes the file with `kdeconnect-cli -d <device> --share <path>` (argv only, no shell).

- Only the owner can trigger it; an agent never can.
- The path must resolve (symlinks followed) to a regular file under an allowlisted directory: the bridge cwd, the attachments store, `~/Downloads`, `~/Pictures`, `~/Documents`, and anything in `DASH_SHARE_DIRS` (colon-separated). `/` and the home directory itself are never accepted as roots.
- Hidden path segments and credential-looking names (`.env`, `*token*`, `*.pem`, `id_rsa` and similar) are refused. The size limit is 200 MB.
- The device is `DASH_KDECONNECT_DEVICE`, or the only reachable paired device. If more than one is reachable, the bridge refuses to guess.
