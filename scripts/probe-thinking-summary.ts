import { ThinkingSummarizer } from "../bridge/src/thinking-summary";
import { resolveRoles } from "../bridge/src/model-roles";

// Explicit opt-in, synthetic text only. Never load real chats or change roles.
if (!process.argv.includes("--luna")) throw new Error("Use --luna to authorize one synthetic Luna inference");
const model = "openai-codex/gpt-6-luna";
const service = new ThinkingSummarizer(() => resolveRoles({}, { modelRoles: { smol: model } }));
const input = { chatId: "synthetic-summary-transport", blockId: "demo", text: "Synthetic demo only. Checked a demo branch, found two failing tests, and planned a fix. The fix has not been implemented.", kind: "final", enabled: true } satisfies Parameters<ThinkingSummarizer["summarize"]>[0];
const disabled = await service.summarize({ ...input, enabled: false });
if (disabled !== null) throw new Error("Disabled summaries unexpectedly ran");
const result = await service.summarize(input);
if (!result || result.unavailable || result.model !== model) {
  console.log(JSON.stringify({ ok: false, requestedModel: model, result })); throw new Error("Synthetic Luna summary failed");
}
const cached = await service.summarize(input);
if (!cached?.cached || cached.text !== result.text) throw new Error("Summary cache readback failed");
console.log(JSON.stringify({ ok: true, provider: "openai-codex", model: result.model, text: result.text, elapsedMs: result.elapsedMs, disabledSkipped: true, cacheVerified: true, tools: [], fallback: false, syntheticOnly: true }, null, 2));
