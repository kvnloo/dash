import { mkdir, readFile, writeFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { ConversationPersistence, type ConversationFiles } from "../app/src/store/conversation-persistence";
import { parseConversation, type Conversation } from "../app/src/model";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error("Usage: bun scripts/recover-conversation-storage.ts <private-legacy-json> <private-output-directory>");
const parsed: unknown = JSON.parse(await readFile(input, "utf8"));
if (!Array.isArray(parsed)) throw Error("Legacy snapshot is not an array");
const chats: Conversation[] = [];
for (const raw of parsed) {
  const chat = parseConversation(raw);
  if (!chat) throw Error("Recovery refuses to discard an invalid legacy record");
  chats.push(chat);
}
for (const area of ["durable", "cache"]) await mkdir(join(output, area), { recursive: true, mode: 0o700 });
const files: ConversationFiles = {
  list: area => readdir(join(output, area)),
  async read(area, name) { try { return await readFile(join(output, area, name), "utf8"); } catch { return null; } },
  async write(area, name, value) { const target = join(output, area, name); await writeFile(`${target}.tmp`, value, { mode: 0o600 }); await rename(`${target}.tmp`, target); },
  async remove(area, name) { await rm(join(output, area, name), { force: true }); },
};
const store = new ConversationPersistence(files);
await store.save(chats);
const restored = await new ConversationPersistence(files).load();
if (restored.length !== chats.length) throw Error("Recovery changed the conversation count");
for (const original of chats.filter(chat => !chat.sessionId)) {
  const copy = restored.find(chat => chat.id === original.id);
  if (JSON.stringify(copy) !== JSON.stringify(original)) throw Error("Local-only conversation did not roundtrip exactly");
}
await files.write("durable", ".migration-complete.json", "true");
console.log(JSON.stringify({ chats: chats.length, hostBacked: chats.filter(chat => chat.sessionId).length, localOnly: chats.filter(chat => !chat.sessionId).length, restored: restored.length, cached: (await files.list("cache")).length, localRoundtrip: true }));
