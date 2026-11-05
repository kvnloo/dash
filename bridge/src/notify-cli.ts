import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseNoticeInput, parseServerMessage } from "../../shared/protocol";

export async function notifyCli(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [title, body, ...flags] = args;
  const fields: Record<string, string> = {};
  let invalid = false;
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i], value = flags[i + 1];
    if ((flag !== "--url" && flag !== "--class") || !value || fields[flag.slice(2)] !== undefined) { invalid = true; break; }
    fields[flag.slice(2)] = value;
  }
  const input = parseNoticeInput({ title, body, ...fields });
  if (!input || invalid) {
    process.stderr.write('Usage: dash-notify "title" "body" [--url dash://...] [--class critical|decision|report|digest] (title ≤80, body ≤600)\n'); return 2;
  }
  try {
    const port = Number(env.DASH_NOTICE_PORT ?? (Number(env.DASH_PORT ?? "4747") + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid notice port");
    const token = readFileSync(join(env.DASH_CREDENTIAL_DIR ?? join(homedir(), ".dash"), "token"), "utf8").trim();
    if (!token || /\s/.test(token)) throw new Error("missing execution token");
    const response = await fetch(`http://127.0.0.1:${port}/notice`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(5000) });
    if (response.status === 202) {
      const held: unknown = await response.json();
      if (typeof held !== "object" || held === null || !("held" in held) || held.held !== true || !("releaseAt" in held) || !(held.releaseAt === null || typeof held.releaseAt === "string")) throw new Error("invalid held response");
      process.stdout.write(`held ${held.releaseAt ?? "morning digest"}\n`); return 0;
    }
    if (response.status !== 201) { process.stderr.write(`dash-notify: bridge refused notice (HTTP ${response.status})\n`); return 1; }
    const notice = parseServerMessage(await response.json());
    if (notice?.type !== "notice") throw new Error("invalid bridge response");
    process.stdout.write(`${notice.id}\n`); return 0;
  } catch {
    process.stderr.write("dash-notify: cannot send notice; check local bridge, port and credential directory\n"); return 1;
  }
}
