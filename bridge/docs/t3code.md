# Read T3 Code threads in Dash

Configure the **Dash bridge**, not the phone:

- `DASH_T3CODE_SERVER`: the T3 Code server origin (scheme, host, and optional port; no path).
  Prefer HTTPS, or use HTTP only on loopback or a trusted private network.
- `DASH_T3CODE_TOKEN`: a current T3 Code bearer session token with permission to
  read the desired threads and mint an RPC WebSocket ticket. This is not a
  Dash pairing token or a T3 Code one-time pairing code. Keep it in the bridge
  service's private environment, not in shell history or source control.

Restart the bridge, pair Dash with it as usual, and open **Chats → All sessions**.
Tap a **T3 Code** row marked **view only** to read the transcript. Remove the
variables and restart to disconnect. If no rows appear, check the bridge's
`t3code.invalid_config` / `t3code.unavailable` events; these omit credentials and
server URLs.

Dash reads the orchestration v2 shell and the server's bounded text projection
over the same ticket-authenticated WebSocket as T3 Code mobile. It does not
send, stream new turns, render T3 Code tool output or attachments, or put the
remote transcript in Dash's archive search index.
