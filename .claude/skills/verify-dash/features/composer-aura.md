# Composer rim motion

The input bar has a thin accent rim along its top edge, after the docked composer in OMP and Tern. Focused: a quiet hairline. Typing: the hairline brightens and each keystroke flicks it brighter. While the agent works: a soft accent band sweeps along the rim on the shared shimmer cadence. When the turn ends the band goes away. Under reduce motion, a blurred screen or a backgrounded app the band rests in the middle and nothing travels.

Status: COVERED by `e2e/mbp-army/composer-aura.spec.ts` › "composer rim brightens while typing and sweeps while the agent works, then rests"; "composer rim never travels under reduce motion but still shows the agent is working"

## Sub-features

- `aura-focus` focusing the field shows `composer-aura-focused`. [covered]
- `aura-typing` typing switches to `composer-aura-typing` with a brighter rim, then settles. [covered]
- `aura-working` a running turn shows `composer-aura-working` and a moving `composer-aura-sweep`; still one `agent-orb`. [covered]
- `aura-rest` the sweep is gone after the reply. [covered]
- `aura-reduce-motion` the sweep does not travel under reduce motion. [covered]
- `aura-native` Android rendering and feel. [UNCOVERED: needs the S25]

## Driving it with the tester army

- `openChat(page, bridge)`, click the composer, `page.keyboard.type(...)`, then Send an `ARMY_HOLD` prompt and release it by writing `army-release` in the bridge dir.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/composer-aura.spec.ts`
