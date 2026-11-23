# blueprint Living Ruins wallpaper (vendored)

Source: kvnloo/blueprint, branch `feat/wallpaper-selfheal-8k-inspect` at 2817939
(`website/src/lib/wallpaper/{livingPlayer,shaders,view,capability}.ts`,
`website/src/components/wallpaper/LivingWallpaper.tsx`, runtime art
`website/src/public/wallpaper/living-ruins/{base,masks,flow,depth}.webp`).
Art provenance: blueprint `website/art/living-ruins/PROVENANCE.md` (owner-generated plates, no third-party art).

License: blueprint is GPL-3.0-only. These files keep that license; the rest of Dash is MIT.
The same owner holds both repos, so relicensing is the owner's call (see the DA-095 PR).

Dash changes:
- `livingPlayer.ts`: takes resolved asset URLs (`assets`) instead of a folder; no 4K plate;
  strict-TS fixes (`noUncheckedIndexedAccess`): guarded index reads, no `= undefined` on typed fields.
- `mount.ts` (new): the DOM driver from `LivingWallpaper.tsx`, minus page scroll, Explore, 8K inspect and tilt.
- `webview-entry.ts` (new): page script for the native WebView.
- `*.generated.ts`: produced by `bun scripts/build-themed-assets.ts` (check with `--check`).
