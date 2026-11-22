# Dash mode in Android Quick Settings

On a Dash native build, swipe down twice, edit Quick Settings, and drag **Dash
mode** into your active tiles. Tap it to switch between **Worker mode** (active,
the default) and **Me mode** (inactive). The choice belongs to this Dash install
and survives restarting the app. Expo Go and web do not install this tile.

Me mode suppresses new Dash agent notifications, not chat, approvals or the
Notices inbox. It does not dismiss notifications already in the shade. Switching
back restores your existing notification settings; it does not grant permissions
or enable notifications you turned off.

When connected, an updated bridge marks live and replayed reports silent for
this phone's socket only. Dash also checks the native mode before posting local
notifications, including when connected to an older bridge. This does not add
push delivery while Dash is disconnected or suspended.
