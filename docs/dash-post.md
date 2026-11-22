# Post directly into a Dash chat

From an agent shell on the paired bridge host (or a shell connected to that
host), run:

```sh
bridge/bin/dash-post "Exact chat title" "Your build is ready."
```

Use the native/indexed chat title as shown in Dash, not the title of a
phone-only unsent draft. Titles are exact and case-sensitive, and ambiguous
titles are rejected rather than guessed. The command uses the same loopback
listener, credential file, input limit (600 characters for the message), and
rate limit as `dash-notify`. Install it on PATH with the bridge checkout, or
invoke it by path. Agents on another machine need their existing shell access
to the paired bridge host; the command does not open a remote reporting port.

The command prints the accepted message ID, not a phone receipt. Dash displays
the text as **Agent message** in that chat only. It does not prompt the harness,
write to its native transcript, trigger an OS notification, or enter the
circadian/digest queue. The bridge stores and replays the last 50 chat posts
(separate from Agent reports); after reconnect Dash deduplicates by ID. If the
phone is offline it must reconnect within that retention window. This is not an
unbounded archive, push service, or command to post in a third-party chat.
