# Ephemeral card style

Status: Covered by the phone-width journeys in `e2e/mbp-army/card-style.spec.ts`.

- Settings and the Card gallery share the saved Dash or App selection.
- On a light OS, chat cards draw with Dash colors by default. App mode uses dark Gmail, GitHub, Stripe and Spotify palettes.
- The gallery changes styles while open, follows Blueprint and uses Dash colors for apps without a palette.
- The chat journeys check frame sizing, touch controls and the Gmail intent round trip.

Drive with `army-stack.sh drive <run> 1 e2e/mbp-army/card-style.spec.ts`.
Set `ARMY_CARD_SCREENSHOTS` to collect named captures in a separate directory.
