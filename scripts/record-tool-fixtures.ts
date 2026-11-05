// Pull actual native call/result pairs read-only; sanitize BEFORE writing a fixture.
import { Database } from "bun:sqlite";
import { formatTool, object } from "../shared/tool-format";
const db = new Database("/workspace/hermes-home/profiles/clean/state.db", { readonly: true });
db.exec("PRAGMA query_only=ON");
const names = ["terminal", "read_file", "write_file", "patch", "search_files", "memory", "skill_view", "skill_manage", "delegate_task", "web_search", "web_extract", "browser_exec", "mcp__ctx__status", "vision_analyze", "execute_code", "clarify", "todo_list", "bash"];
const fixtures = [];
for (const name of names) {
  const rows = db.query<{ tool_calls: string }, [string]>("SELECT tool_calls FROM messages WHERE tool_calls IS NOT NULL AND tool_calls LIKE ? ORDER BY length(tool_calls) ASC LIMIT 200").all(`%\"${name}\"%`);
  let found = false;
  for (const row of rows) {
    const calls: unknown = JSON.parse(row.tool_calls);
    if (!Array.isArray(calls)) continue;
    for (const raw of calls) {
      const call = object(raw); const fn = object(call.function);
      if (fn.name !== name || typeof call.id !== "string") continue;
      const result = db.query<{ content: string }, [string]>("SELECT content FROM messages WHERE role='tool' AND tool_call_id=? LIMIT 1").get(call.id);
      if (!result || result.content.length > 12000) continue;
      const args = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments);
      const candidate = object(JSON.parse(args));
      if ((name === "terminal" || name === "bash") && !candidate.command) continue;
      if ((name === "read_file" || name === "write_file" || name === "patch") && !candidate.path) continue;
      if (result.content.includes("does not exist")) continue;
      try { if (object(JSON.parse(result.content)).error) continue; } catch { /* plain native output */ }
      // Keep real metadata/shape; replace arbitrary payload bodies (not needed to test formatting).
      let a = object(JSON.parse(args));
      for (const k of ["content", "old_content", "new_content", "old_string", "new_string", "prompt", "goal", "question", "code"]) if (typeof a[k] === "string" && String(a[k]).length > 120) a = { ...a, [k]: String(a[k]).slice(0, 120) };
      const tool = { name, args: JSON.stringify(a), output: result.content, status: "ok", durationMs: 123 };
      const clean = formatTool(tool);
      let output = clean.output;
      try { const r = object(JSON.parse(output)); for (const key of ["content", "matches_text", "subagents", "responses", "note"]) if (key in r) r[key] = "[fixture payload omitted]"; output = JSON.stringify(r); } catch { output = "[native plain-text payload omitted]"; }
      fixtures.push({ ...tool, args: clean.args, output, source: "clean/state.db native tool_call_id pair; payloads shortened/omitted, secrets redacted" });
      found = true; break;
    }
    if (found) break;
  }
}
db.close();
await Bun.write(new URL("../shared/fixtures/native-tools.json", import.meta.url), JSON.stringify(fixtures, null, 2));
console.log(JSON.stringify({ count: fixtures.length, names: fixtures.map(f => f.name) }));
