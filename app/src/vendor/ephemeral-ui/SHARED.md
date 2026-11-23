# Shared Glide theme and catalog

Dash pins the kit, theme and catalog to one immutable ephemeral-ui revision.
To re-pin, update `KIT_REV` in `app/scripts/ephemeral-kit/build.mjs`, then run
`bash scripts/check-ephemeral-pin.sh --prepare <kit-checkout>` and
`node app/scripts/ephemeral-kit/build.mjs --kit <kit-checkout>` from the Dash root.
Copy `theme/glide.json` and `theme/tokens.schema.json` verbatim from that checkout;
the build already copies `catalog/catalog.json`. Update `shared-pin.json` with the
revision, versions and SHA-256 of the three files. Run
`bash scripts/check-ephemeral-pin.sh <kit-checkout>` to verify the result offline
and the tester army to exercise the gallery.

CI fetches only the pinned commit for integrity checks. The separate scheduled
and manual freshness workflow checks whether ephemeral-ui main has advanced.

Dash uses dark for its shell, and both shared palettes for the card host and the theme
preview. Native font families, the Proof Mono diagnostic palette and platform blur limits
are Dash-owned; no wallpaper dependency is required. Expo takes the Glide display name
from the theme without changing package IDs, update channels or the dash scheme.
