// Synthetic workload, real app stores. Storage is replaced at the build boundary.
import * as app from "../app/src/store/app";
import { replyText, replyParts, replySummaries } from "../app/src/store/text";

const ids: string[] = [];
function run(count = 128): { retainedCharacters: number; conversations: number; turns: number } {
  for (let n = 0; n < count; n++) {
    const chat = app.createConversation("omp");
    const turn = app.beginTurn(chat.id, "synthetic retention probe");
    ids.push(turn.turnId);
    const text = `${ids.length}: synthetic answer line. `.repeat(8192);
    app.applyDeltas(new Map([[turn.turnId, { seq: 1, text }]]));
    app.applyTurnEvent({ type: "status", id: turn.turnId, seq: 2, text: "", part: { kind: "reasoning", text: `${ids.length}: synthetic reasoning. `.repeat(8192) } });
    app.applyTurnEvent({ type: "status", id: turn.turnId, seq: 3, text: "", summary: { kind: "turn", blockId: "turn", text: "synthetic summary", model: "fixture", durationMs: 1 } });
    app.applyTurnEvent({ type: "done", id: turn.turnId, seq: 4, exitCode: 0 });
    const final = app.store.get().conversations.find(c => c.id === chat.id)?.messages.at(-1);
    if (final?.role !== "assistant" || final.text !== text || !final.parts?.length) throw new Error("Checkpoint lost content");
    app.deleteConversation(chat.id);
  }
  return { retainedCharacters: ids.reduce((sum, id) => sum + replyText.get(id).length + replyParts.get(id).length + replySummaries.get(`${id}:turn`).length, 0), conversations: app.store.get().conversations.length, turns: ids.length };
}
Reflect.set(globalThis, "__retentionProbe", { run });
