# Composer chips and bedtime capture gate

Status: PARTIALLY COVERED — `e2e/mbp-army/bedtime-capture.spec.ts` covers bedtime. See the separate composer model/rate inventory for model and token rate coverage.

- `bedtime-gate` [COVERED]: after the configured bedtime, Save for tomorrow stores the chat draft without an agent turn. Reload preserves the note; after wake, copying the note is local until the owner taps Send.
- `bedtime-main` [COVERED]: the unattached Main composer saves an unassigned thought without opening a chat.

Go to Settings → Bedtime capture, set the local bedtime and wake time, and enable the switch. At bedtime, type a text thought and choose Save for tomorrow. Open Saved for tomorrow to copy a note back to the draft or dismiss it.

Drive: `army-stack.sh drive <run> 1 e2e/mbp-army/bedtime-capture.spec.ts`. The test pairs with the real fixture bridge before setting the fake local clock; it checks fixture ACP records before and after actual Send.
