# DeX Pad annotation

Status: covered on web by `e2e/mbp-army/dex-pad.spec.ts` (feature `dex-pad-annotation`).
The activity placement, shared React host and touch behavior on Samsung DeX need native acceptance.

On the TV, open Dash in the DeX desktop, open a chat, and choose Options → Annotate → Open Dash Pad.
On the phone, one finger draws and two fingers zoom/pan the same chat and marks on the TV.
Lift both fingers after a pinch before drawing. Reset zoom returns to the full chat without clearing marks.
Close Dash Pad to return the phone to its previous task; existing marks remain in the annotation draft.

The journey switches on the explicit web DeX simulator, opens the Pad from the annotation tray,
and drives true Chromium touch contacts through a pinch, cancelled stroke and circle.
It checks the rendered TV zoom and tldraw mark, then sends the circle through the real fixture bridge.
