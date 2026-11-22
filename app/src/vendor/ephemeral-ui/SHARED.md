# Shared Glide theme and catalog

`shared-pin.json` records the immutable ephemeral-ui revision, versions and byte hashes.
When adopting a new release, copy the three upstream files without editing them, update the
pin, and run `node scripts/check-shared-ephemeral.mjs --upstream` from the Dash root.
The same check without the flag works offline. The tester army verifies the gallery against
the catalog so additions cannot silently vanish.

Dash uses dark for its shell, and both shared palettes for the card host and the theme
preview. Native font families, the Proof Mono diagnostic palette and platform blur limits
are Dash-owned; no wallpaper dependency is required. Expo takes the Glide display name
from the theme without changing package IDs, update channels or the dash scheme.

The shared catalog is a separate pin from Dash's existing sandboxed chat renderer. The
gallery presents every fixture's reference props and state; supported sample cells can
also open the current chat-style preview. The chat renderer does not accept arbitrary
fixture input or agent-supplied code.
