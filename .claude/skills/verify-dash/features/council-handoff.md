# Saved Glide council handoff

Open Council in a saved Hermes chat, pick the council from that chat, and continue listening through the orb from the sentence Glide saved.

Status: COVERED by `e2e/mbp-army/council.spec.ts` › "Glide council opens from its Hermes chat and Dash resumes and writes back the saved sentence"

## Sub-features

- `council-list` list the attached conversation's saved councils. [covered: "Glide council opens from its Hermes chat and Dash resumes and writes back the saved sentence"]
- `council-resume` refuse unknown record versions, continue the original passages at the stored sentence, and write revisioned progress as Dash. [covered: "Glide council opens from its Hermes chat and Dash resumes and writes back the saved sentence"]

## How to get to it (user POV)

- In the original Hermes conversation on its paired host, open Options → Council → Saved councils in this chat, and select the brief.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes. The spec starts an isolated real bridge with a pinned-core gateway fixture.

- **Find the saved council.** Open the `ARMY native fixture` row from Chats, then `Options. Current surface: Chat` and `composer-menu-row-council`. The fixture's saved brief appears.
- **Open the record.** The unsupported version produces an alert and no speech. Once the valid record is available, selecting that row opens the orb at “Moss wants text only.”
- **Continue listening.** Advance the scripted speech; the next sentence and next passage appear in the orb. The RPC attachment records the revision, passage and sentence written by Dash.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/council.spec.ts -g "Glide council opens"`
- **Proof.** Check `resumed-orb.png`, `trace.zip`, and the `council-gateway-rpc` attachment in the Playwright report.

## Gotchas

- This proves sentence selection and syncing, not audio quality or the native speech engine.
- The read-only local/demo Council card is separate; it does not acquire a Glide revision.
