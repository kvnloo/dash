# Thumb-side placement

Settings → Display saves `handedness` (`right`, `left`, `auto`) in the existing
`dash.settings.v1` record. Missing/invalid values default to Right. Pair first:
Dash deliberately does not manufacture a bridge settings record just to save a
display preference. Long-press either composer mic to switch hands immediately.

`app/src/lib/useHandedness.ts` is the shared reactive entry point. It returns:

- `preference`, `side`, `opposite`, `isLeft`;
- `row`: place the last action on the thumb side (row / row-reverse);
- `align`: align a compact action to the thumb side;
- `edge(offset)`: pin an absolute action/rail/preview to that physical edge;
- `railPadding(width)`: reserve content space at the rail edge;
- `offset(x)`: mirror a placement-dependent horizontal offset or swipe sign.

Use `thumb.row` on an action group, not on message content, a chart, a page list,
or ordered navigation tabs. No I18nManager, scaleX mirror, or text direction
changes. The AppNav outer actions swap; its pager and dot geometry do not.
Centered/full-width actions stay centered/full-width. Vertical rail/pull gestures
and semantic page swipes keep their direction; this base has no horizontal
placement-dependent swipe action or separate floating scroll-to-bottom pill.
Latest is the existing scroll-to-bottom action and follows the rail side.

## Orchestra bottom-bar integration

The independent Orchestra worker owns that new bar; it is not in this branch's
integration base. Import `useHandedness` into the bar component and append
`thumb.row` to its action container's styles, keeping the primary action last in
JSX. Use `thumb.align` for a compact standalone primary action and
`thumb.edge(inset)` for a floating button. Keep graph layout, legend, and mode
labels unmirrored. Do not reverse the graph component or its data.

## Auto

Expo Go's current iOS/Android APIs and React Native Web expose no system
handedness preference. Auto therefore resolves to Right on these platforms.
The pure resolver accepts an optional explicit `ThumbSide` signal for a future
supported adapter. Locale, RTL, pointer coarseness, and orientation are not
handedness signals. Settings states this limitation rather than guessing.

## Tests

- `bun test app/src/lib/handedness.test.ts app/src/store/app.test.ts`
- `bun run typecheck`
- `bun scripts/mutate.ts` (repository contract targets)

The store suite renders the real hook with React's server renderer, checks
quick toggling, settings preservation, persistence and hydration. A dev-only
`@types/react-dom` dependency supplies types for that renderer; no native or
runtime dependency was added.
