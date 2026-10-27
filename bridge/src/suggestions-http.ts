import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { CommandSuggestion, SuggestionInventory } from "../../shared/suggestions";
import { AcpClient } from "./acp/client";
import { acpCommand } from "./acp/supervisor";
import { bearerToken, secretMatches } from "./bridge-security";

export async function harnessCommands(harness: string, cwd: string): Promise<CommandSuggestion[]> {
  const command = acpCommand(harness);
  if (!command) throw new Error("This harness has no installed ACP adapter.");
  const client = new AcpClient({ command, cwd, timeoutMs: 15000, sink: { delta() {}, status() {}, session() {}, error() {} } });
  try { return await client.discoverCommands(cwd); }
  finally { await client.close(); }
}

export async function workspaceFiles(cwd: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd, stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => proc.kill(), 3000);
  try {
    const text = await new Response(proc.stdout).text();
    if (await proc.exited !== 0) throw new Error("File mentions need a Git working directory.");
    return [...new Set(text.split("\0").filter(path => path && !path.split("/").some(part => part === ".env" || part.startsWith(".env.") || /^(credentials|auth|token)\.(json|ya?ml)$/.test(part))))].sort().slice(0, 2000);
  } finally { clearTimeout(timer); }
}

export function createSuggestionsHttpHandler(options: {
  token: string; cwd: string;
  commands?: typeof harnessCommands; files?: typeof workspaceFiles;
}) {
  const cache = new Map<string, { at: number; value: Promise<SuggestionInventory> }>();
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== "/suggestions") return null;
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
    if (!secretMatches(bearerToken(request), options.token)) return json({ error: "unauthorized" }, 401);
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    const harness = url.searchParams.get("harness") ?? "hermes";
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(harness)) return json({ error: "invalid harness" }, 400);
    let cwd: string;
    try {
      const raw = url.searchParams.get("cwd") || options.cwd;
      if (!isAbsolute(raw)) return json({ error: "Working directory must be absolute." }, 400);
      cwd = realpathSync(raw);
    } catch { return json({ error: "Working directory is unavailable." }, 400); }
    const key = `${harness}:${cwd}`;
    let entry = cache.get(key);
    if (!entry || Date.now() - entry.at > 5 * 60_000) {
      // Coalesce repeated keystrokes. No prompt, tool call or paid model turn is sent.
      if (cache.size >= 32) cache.delete(cache.keys().next().value ?? "");
      const value = Promise.allSettled([(options.commands ?? harnessCommands)(harness, cwd), (options.files ?? workspaceFiles)(cwd)]).then(([commands, files]): SuggestionInventory => ({
        commands: commands.status === "fulfilled" ? commands.value : [],
        files: files.status === "fulfilled" ? files.value : [],
        commandError: commands.status === "rejected" ? "Commands unavailable. Check this harness’s ACP adapter on the bridge." : undefined,
        fileError: files.status === "rejected" ? "Files unavailable. Open a Git workspace on the bridge." : undefined,
      }));
      entry = { at: Date.now(), value };
      cache.set(key, entry);
    }
    return json(await entry.value);
  };
}
