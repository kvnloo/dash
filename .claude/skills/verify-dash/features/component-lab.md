# Component lab

The Component lab (Settings, Component lab) is a design playground: a gesture playground tile, timeline and lane-row variants with Pick buttons, a READ strip with Replay, action chips with Reset, stat tiles, bot faces and orb states.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-10-11-voice-live-surface-annotation-and-lab.spec.ts` › "11.15 Lab: timeline and lane row variants render; Pick <name> switches the saved pick and Send picks files it"

## Sub-features

- `lab-gesture-tile` the gesture playground tile opens detail on tap and pins on double tap [UNCOVERED].
- `lab-timeline-lane-picks` Pick <name> switches the saved pick; Send picks files it [UNCOVERED].
- `lab-read-strip` Replay re-runs the READ strip arrival [UNCOVERED].
- `lab-action-chip` Do / Not now chips and Reset [UNCOVERED].
- `lab-stat-tiles` stat tiles: tap detail, hold wheel Segment, Replay [UNCOVERED].
- `lab-bot-faces-orbs` Face state <x>, Animate 20 / Cap at 6, voice orb hero phases [UNCOVERED].

## How to get to it (user POV)

- Chats tab, Open settings, Component lab.
- Open `dash://lab` (web route `<web>/lab`).

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Paired via `pair(page,bridge)`.

- **Open the lab.** `page.getByRole('button',{name:'Open settings'}).first().click()`, `getByRole('button',{name:'Component lab',exact:true}).click()`; `getByRole('heading',{name:'Component lab',exact:true})` appears.
- **Reveal a block.** The list is virtualized: wheel the page until `page.getByTestId('lab-timeline')` (or another block id) is attached, then `scrollIntoViewIfNeeded()`.
- **Gesture tile.** `getByTestId('gesture-playground')` click opens `getByTestId('tile-detail')`; `getByRole('button',{name:'Close tile detail'})` closes it; double-click pins it locally.
- **Picks.** In `lab-timeline` click `getByRole('button',{name:'Pick bars'})`: `aria-selected=true`, text `Picked`. In `lab-lane-row` click `Pick compact`. `getByTestId('lab-picks')` reads `timeline: ... · lane-row: ...`; `Send picks` changes to `Sent to Dash feedback ✓`.
- **READ and chips.** `Replay` in `lab-read-strip` remounts the strip. In `lab-action-chip` click `Do` (`✓ Done`), then `Reset` restores Do / Not now.
- **Faces and orbs.** `Face state thinking` etc. set `aria-selected`; `Animate 20` then `Cap at 6`; hero phase buttons cycle.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/component-lab.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. Show the picked state and the `Sent to Dash feedback ✓` confirmation.

## Gotchas

- Blocks mount lazily; assert `toBeAttached` after scrolling, not `toBeVisible` first.
- Test ids for stat tiles and READ strips are built from a variant (`stat-number-cut`, `read-strip-slide`); they exist as templates in app source, not as literal strings.
- The stat-tile hold wheel needs a 650 ms real mouse hold; the wheel segment testid is `radial-segment` (template `radial-<id>`).
- Draft locators all exist in app source (checked by grep).
