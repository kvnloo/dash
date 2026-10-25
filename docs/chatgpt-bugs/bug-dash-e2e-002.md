# DASH-E2E-002 — Web ContextGauge disclosure-state fix pack

Issue: https://github.com/kvnloo/dash/issues/187  
Lane base inspected: integrate/chatgpt-lane-20261025 @ 56729f2068a3239f52eb3e04431b389a6ac4e2c0  
Owner of producer: Hermes. This issue permits writing only this document and the adjacent named regression test.

## Evidence and first wrong assumption

- Reported E2E observation (issue #187, **not independently re-executed**): in the paired Expo **web** build, activating the Context window gauge opens the details card, but the actual button lacks aria-expanded both before and after activation.
- Current [ContextGauge implementation](https://github.com/kvnloo/dash/blob/56729f2068a3239f52eb3e04431b389a6ac4e2c0/app/src/components/ContextCard.tsx) computes the button's name from the current snapshot and passes accessibilityState={{ expanded: control.open }} to PressScale. That source-level state is correct but is not sufficient evidence that the **web DOM attribute** exists.
- [PressScale](https://github.com/kvnloo/dash/blob/56729f2068a3239f52eb3e04431b389a6ac4e2c0/app/src/components/PressScale.tsx) passes its remaining PressableProps through with {...rest} to the inner React Native Pressable. It does not deliberately strip aria-expanded.
- **First wrong assumption:** treating React Native accessibilityState.expanded on the wrapper as proof that a web accessibility client receives aria-expanded. The reported DOM contradicts that assumption. Do not fix this by changing the visual gauge, fabricating a context snapshot, or swapping the conversation target.

## Exact Hermes-owned patch

In app/src/components/ContextCard.tsx, in the **ContextGauge** return element only, replace this unique substring:

~~~tsx
accessibilityState={{ expanded: control.open }} onPress={control.toggle} style={styles.gauge}>
~~~

with:

~~~tsx
accessibilityState={{ expanded: control.open }} aria-expanded={control.open} onPress={control.toggle} style={styles.gauge}>
~~~

This adds a direct web ARIA attribute while keeping the existing native accessibilityState, accessibilityRole, dynamically truthful accessibilityLabel, onPress={control.toggle}, 44×44 gauge style and all existing card rendering intact. PressScale already forwards the extra prop; do **not** edit PressScale for this fix. Do not introduce aria-controls with a fixed ID: multiple mounted chats could produce duplicate IDs or reference the wrong panel.

The new regression test imports the real ContextGauge from the producer module in an isolated Bun child with mocked native-only surfaces. It requires both the existing native accessibilityState.expanded **and** an explicitly supplied aria-expanded Boolean on the production JSX props, for open/closed, measured, unavailable/zero-capacity and two distinct session identities. The unpatched producer is expected to fail this test. The test checks the producer contract, not react-native-web DOM rendering or a native screen reader.

## Hermes acceptance gates (not run)

1. Apply the single-substring patch above in Hermes' separately owned ContextCard.tsx scope. No merge from this PR is required for a patch until the write lease is released.
2. Before applying it, run bun test app/src/lib/bug-dash-e2e-002.chatgpt-lane.test.ts and confirm that absence of direct aria-expanded fails. After the patch, rerun it and confirm that all synthetic cases satisfy the disclosure contract. Do not count source inspection as a runtime pass.
3. Run bun test app/src bridge/src shared; bun run typecheck; bun run lint; bun scripts/mutate.ts where affected.
4. Pair the Expo web build to the isolated **real** bridge. Open chat A with the context gauge; inspect the actual role=button. In the closed state the button must have aria-expanded="false" and the details card be hidden. Activate by pointer, Enter and Space: attribute must be "true", the same chat's card visible. Activate again: "false", card hidden. With a screen reader, confirm the expanded/collapsed state is announced.
5. Switch between chat A and chat B and repeat; confirm the control toggles only its owning panel. On a host with no native context reading, an offline host and an ended session, keep the label **Context window, unavailable**, do not claim a numeric occupancy or live session, and still reflect the actual card visibility with aria-expanded. Check zero/unknown maximum as unavailable, never 0% implied as a valid reading.
6. On Android with TalkBack (and iOS VoiceOver if supported), verify native accessibilityState.expanded continues to follow card visibility. Verify touch target >= 44dp and unchanged reduced-motion behavior.

## Unverified / blocked

The actual web DOM, screen-reader announcement, real bridge pairing, offline/ended lifecycle, phone hardware behavior and CI outcomes are **not verified** in this ChatGPT-only lane. ContextCard.tsx is Hermes-owned and not in this issue's write allowlist, so the production patch must be applied by Hermes. The adjacent test intentionally exposes the gap until that happens. No new production module is needed, and no other task's files should change.
