import { expect, test } from "bun:test";
import { createSuggestionsHttpHandler, workspaceFiles } from "./suggestions-http";
import { AcpClient } from "./acp/client";
import { parseSuggestionInventory } from "../../shared/suggestions";

test("suggestion HTTP auth, methods, harness selection and coalescing", async () => {
  const calls: string[] = [];
  const handler = createSuggestionsHttpHandler({ token: "test-only", cwd: process.cwd(), commands: async harness => { calls.push(harness); return [{ name: "help", description: harness }]; }, files: async () => ["app/App.tsx"] });
  expect((await handler(new Request("http://localhost/suggestions")))?.status).toBe(401);
  const request = (suffix = "", method = "GET") => new Request(`http://localhost/suggestions${suffix}`, { method, headers: { Authorization: "Bearer test-only" } });
  expect((await handler(request("", "POST")))?.status).toBe(405);
  expect((await handler(request("?harness=../../bad")))?.status).toBe(400);
  const responses = await Promise.all([handler(request("?harness=hermes")), handler(request("?harness=hermes"))]);
  expect(await responses[0]?.json()).toEqual({ commands: [{ name: "help", description: "hermes" }], files: ["app/App.tsx"] });
  expect(calls).toEqual(["hermes"]);
});
test("source failures are distinct from genuinely empty results", async () => {
  const handler = createSuggestionsHttpHandler({ token: "t", cwd: process.cwd(), commands: async () => { throw new Error("down"); }, files: async () => [] });
  const response = await handler(new Request("http://localhost/suggestions", { headers: { Authorization: "Bearer t" } }));
  const result = parseSuggestionInventory(await response?.json());
  expect(result.commandError).toContain("unavailable");
  expect(result.files).toEqual([]);
  expect(result.fileError).toBeUndefined();
});
test("file inventory reads the real Git workspace, not a mock catalog", async () => {
  const files = await workspaceFiles(process.cwd());
  expect(files).toContain("app/App.tsx");
  expect(files.some(file => file.includes("node_modules/") || /(^|\/)\.env($|\.)/.test(file))).toBe(false);
});
test("ACP catalog accepts advertisements before session/new completes and never prompts", async () => {
  const code = `const readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);let result;if(m.method==='initialize')result={protocolVersion:1,agentCapabilities:{}};else if(m.method==='session/new'){console.log(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'catalog',update:{sessionUpdate:'available_commands_update',availableCommands:[{name:'help',description:'Real ACP frame'}]}}}));result={sessionId:'catalog'}}else process.exit(7);console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}))});`;
  const client = new AcpClient({ command: ["node", "-e", code], cwd: process.cwd(), timeoutMs: 5000, sink: { delta() { throw new Error("unexpected text"); }, status() {}, error() {}, session() { throw new Error("catalog must not adopt a chat"); } } });
  try { expect(await client.discoverCommands(process.cwd())).toEqual([{ name: "help", description: "Real ACP frame" }]); }
  finally { await client.close(); }
});
