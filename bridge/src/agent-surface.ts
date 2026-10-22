import { mkdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { commandRejection, parseSnapshot, parseSurfaceCommand, sameTarget, type SurfaceCommand, type SurfaceSnapshot, type SurfaceReceipt } from "../../shared/agent-surface";
import { record } from "../../shared/z0bridge-identity";
import { secretMatches } from "./bridge-security";

interface Peer { key: object; subject: string; send(value: unknown): void }
interface Pending { resolve(receipt: SurfaceReceipt): void; timer: ReturnType<typeof setTimeout>; command: SurfaceCommand }
interface Binding { peer: Peer; state: SurfaceSnapshot; capability: string; expiresAt: number; pending: Map<string, Pending>; receipts: Map<string, { payload: string; receipt: SurfaceReceipt }>; file?: string }
/** Scoped control on the existing authenticated socket. Never evaluates JS or broadcasts. */
export class AgentSurfaceBroker {
  private bindings = new Map<string, Binding>();
  constructor(private options: { directory?: string; url(): string; now?: () => number; timeoutMs?: number }) {}
  private now() { return (this.options.now ?? Date.now)(); }
  private revoke(client: string): void {
    const b = this.bindings.get(client); if (!b) return;
    this.bindings.delete(client);
    if (b.file) { try { unlinkSync(b.file); } catch { /* Already removed. */ } }
    for (const [id, p] of b.pending) { clearTimeout(p.timer); p.resolve({ id, status: "rejected", reason: "disconnected-or-disabled", snapshot: b.state }); }
  }
  disconnect(key: object): void { for (const [id, b] of this.bindings) if (b.peer.key === key) this.revoke(id); }
  receive(peer: Peer, raw: unknown): boolean {
    if (!record(raw)) return false;
    if (raw.type === "surface_state") {
      const s = parseSnapshot(raw.state);
      if (!s) { if (raw.state === null) this.disconnect(peer.key); return true; }
      if (!/^dash-[a-zA-Z0-9-]{1,100}$/.test(s.target.client)) return true;
      const old = this.bindings.get(s.target.client);
      // An authenticated second client cannot claim another connected socket's identity.
      if (old && (old.peer.key !== peer.key || old.peer.subject !== peer.subject)) return true;
      if (!s.enabled) { if (old) this.revoke(s.target.client); return true; }
      if (s.expiresAt <= this.now() || s.expiresAt > this.now() + 15000) return true;
      if (old && !sameTarget(old.state.target, s.target)) this.revoke(s.target.client);
      const b = this.bindings.get(s.target.client);
      if (b && b.expiresAt > this.now()) { b.state = s; return true; }
      if (b) this.revoke(s.target.client);
      if (this.bindings.size >= 32) return true;
      const next: Binding = { peer, state: s, capability: randomBytes(32).toString("base64url"), expiresAt: this.now() + 10 * 60_000, pending: new Map(), receipts: new Map() };
      try { if (this.options.directory) {
        mkdirSync(this.options.directory, { recursive: true, mode: 0o700 });
        const stat = statSync(this.options.directory);
        if (!stat.isDirectory() || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) return true;
        next.file = join(this.options.directory, `${s.target.client}-${randomBytes(6).toString("hex")}.json`);
        writeFileSync(next.file, JSON.stringify({ version: 1, scope: "dash:surface", principal: peer.subject, url: this.options.url(), capability: next.capability, target: s.target, expiresAt: next.expiresAt }), { mode: 0o600, flag: "wx" });
      } } catch { return true; /* Private grant storage failure: never enable remote control. */ }
      this.bindings.set(s.target.client, next);
      return true;
    }
    if (raw.type === "surface_receipt") {
      const r = raw.receipt;
      if (!record(r) || typeof r.id !== "string" || !(r.status === "rendered" || r.status === "rejected")) return true;
      const s = parseSnapshot(r.snapshot);
      if (!s) return true;
      const b = this.bindings.get(s.target.client), p = b?.pending.get(r.id);
      if (!b || !p || b.peer.key !== peer.key || b.peer.subject !== peer.subject || !sameTarget(s.target, b.state.target)) return true;
      const receipt: SurfaceReceipt = { id: r.id, status: r.status, ...(typeof r.reason === "string" ? { reason: r.reason.slice(0, 120) } : {}), snapshot: s };
      b.state = s; b.pending.delete(r.id); clearTimeout(p.timer);
      b.receipts.set(r.id, { payload: JSON.stringify(p.command), receipt });
      while (b.receipts.size > 128) { const first = b.receipts.keys().next().value; if (first) b.receipts.delete(first); }
      p.resolve(receipt); return true;
    }
    return false;
  }
  private apply(b: Binding, command: SurfaceCommand): Promise<SurfaceReceipt> {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        b.pending.delete(command.id);
        const receipt: SurfaceReceipt = { id: command.id, status: "rejected", reason: "render-ack-timeout", snapshot: b.state };
        b.receipts.set(command.id, { payload: JSON.stringify(command), receipt });
        while (b.receipts.size > 128) { const first = b.receipts.keys().next().value; if (first) b.receipts.delete(first); }
        resolve(receipt);
      }, this.options.timeoutMs ?? 4000);
      b.pending.set(command.id, { resolve, timer, command });
      b.peer.send({ type: "surface_command", command });
    });
  }
  async http(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/agent-surface/")) return;
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
    const match = /^\/agent-surface\/(dash-[a-zA-Z0-9-]{1,100})\/(state|command)$/.exec(url.pathname);
    if (!match) return json({ error: "not-found" }, 404);
    const b = this.bindings.get(match[1] ?? "");
    const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!b || !secretMatches(supplied ?? null, b.capability)) return json({ error: "unauthorized" }, 401);
    if (b.expiresAt <= this.now() || b.state.expiresAt <= this.now()) { this.revoke(b.state.target.client); return json({ error: "expired" }, 401); }
    if (match[2] === "state") {
      if (request.method !== "GET") return json({ error: "method" }, 405);
      if (b.pending.size) return json({ error: "busy" }, 409);
      const receipt = await this.apply(b, { id: `snapshot-${randomBytes(12).toString("hex")}`, target: b.state.target, route: b.state.route, generation: b.state.generation, expiresAt: this.now() + 5000, op: "snapshot" });
      return json(receipt, receipt.status === "rendered" ? 200 : 409);
    }
    if (request.method !== "POST") return json({ error: "method" }, 405);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "content-type" }, 415);
    // Stream bounded input: a malicious chunked body must not allocate without limit.
    const reader = request.body?.getReader(); if (!reader) return json({ error: "empty" }, 400);
    let text = "", bytes = 0;
    const decoder = new TextDecoder();
    while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 16384) { await reader.cancel(); return json({ error: "payload-limit" }, 413); } text += decoder.decode(chunk.value, { stream: true }); }
    text += decoder.decode();
    let value: unknown; try { value = JSON.parse(text); } catch { return json({ error: "invalid-json" }, 400); }
    const command = parseSurfaceCommand(value); if (!command) return json({ error: "invalid-command" }, 400);
    if (!sameTarget(command.target, b.state.target)) return json({ error: "wrong-target" }, 403);
    const old = b.receipts.get(command.id);
    if (old) return JSON.stringify(command) === old.payload ? json(old.receipt, old.receipt.status === "rendered" ? 200 : 409) : json({ error: "id-conflict" }, 409);
    const rejection = commandRejection(command, b.state, this.now());
    if (rejection) return json({ error: rejection }, 409);
    if (b.pending.size) return json({ error: "busy" }, 409);
    const receipt = await this.apply(b, command);
    return json(receipt, receipt.status === "rendered" ? 200 : 409);
  }
}
