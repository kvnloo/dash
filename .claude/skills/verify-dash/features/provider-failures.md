# Provider out of usage or rate limited

When the agent's provider refuses a prompt because the account is out of usage or credits (HTTP 402), the chat says so in fixed words: "the agent's provider account is out of usage or credits on this host". A 429 says the provider is rate limiting this host. Neither is reported as a host authentication problem, and the provider's own text never reaches the phone (issue #501). The composer stays usable.

Status: COVERED by `e2e/mbp-army/concurrent-turns.spec.ts` › "a provider 402 says the agent's account is out of usage, and the chat stays usable" and › "a provider 429 says the host is being rate limited, and the chat stays usable"

## Sub-features

- `provider-402` out-of-usage sentence shown [covered: "a provider 402 says the agent's account is out of usage, and the chat stays usable"]
- `provider-429` rate-limit sentence shown [covered: "a provider 429 says the host is being rate limited, and the chat stays usable"]
- `provider-text-hidden` the provider's own words never reach the chat or `bridge.log` [covered: both tests for the chat, the 402 test for bridge.log]
- `provider-model-restore` "could not restore model" hint [UNCOVERED]

## How to get to it (user POV)

- Send a message to an agent whose provider account has run out of usage or is being rate limited; the red error text names the cause.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The fixture agent answers a prompt containing `ARMY_402` (or `ARMY_429`) with a JSON-RPC error whose `data.http_status` is 402 (or 429) and whose `data.details` is `ARMY_PROVIDER_DETAIL ...`.

- **402.** `openChat`, `send(page,'ARMY_402 ping the broke provider')`. `out of usage or credits` is visible, `check host authentication` and `ARMY_PROVIDER_DETAIL` are absent. Send `ask again after the 402`: `ARMY_REPLY: ask again after the 402` appears.
- **429.** The same with `ARMY_429`: `rate limiting this host` is visible and `out of usage or credits` is absent.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/concurrent-turns.spec.ts -g "provider 4"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`.

## Gotchas

- The sentences are the bridge's, in `acpRequestFailure` (`bridge/src/acp/client.ts`). A real provider's wording differs; the bridge also matches the status and phrases such as `balance exhausted`.
