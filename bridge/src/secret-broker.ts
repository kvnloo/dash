// Secure sudo entry (#559): the bridge, not the agent, owns the password.
//
// `dash-sudo <cmd…>` (local, token-authenticated, loopback only) asks the broker to run one exact
// command. The broker mints a per-request X25519 key pair, shows the command and user@host on the
// phone (secret_request), opens the sealed password (secret_submit) in memory, writes it only into
// `sudo -k -S -p "" -- <cmd…>`'s stdin pipe, wipes it and returns the command's output.
//
// Rules (refusal is the default):
// - The plaintext never leaves this process except into sudo's stdin; it is never logged, never in
//   a socket message or HTTP response, and output that happens to contain it is redacted.
// - `-k` ignores and does not refresh sudo's credential cache, so one entry authorizes exactly the
//   command the owner saw, not 15 minutes of passwordless sudo for the agent.
// - `--` ends sudo's options: the agent cannot inject sudo flags (e.g. -A, -E, -u, -s).
// - The sudo binary is resolved from the bridge's own PATH (set when the bridge started), never the agent's.
// - stdin is closed right after the password line, so the command cannot read (or echo) it, and a
//   command sudo would run without a password (NOPASSWD) is refused before the phone is asked.
import { createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from "node:crypto";
import { bearerToken, secretMatches } from "./bridge-security";
import { MAX_SECRET_BYTES, MAX_SECRET_COMMAND, MAX_SECRET_REASON, SECRET_SEAL_INFO, secretAad, type SecretOutcome, type SecretRequest, type SecretResolved, type SecretSubmit } from "../../shared/secret";

const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const MAX_PENDING = 4;
const MAX_ARGS = 64;
const MAX_ARG = 1024;
const MAX_OUTPUT = 1024 * 1024;
const DEFAULT_TTL_MS = 120_000;
const DEFAULT_RUN_MS = 15 * 60_000;

export interface SudoRun { argv: string[]; cwd: string; reason?: string }
export interface SudoResult { outcome: SecretOutcome; exitCode: number | null; stdout: string; stderr: string; message?: string }
export interface SpawnResult { exitCode: number | null; stdout: Buffer; stderr: Buffer }
export type SudoSpawn = (cmd: string[], options: { cwd: string; stdin: Buffer; timeoutMs: number }) => Promise<SpawnResult>;

export interface SecretBrokerOptions {
  /** Resolves sudo from the bridge's own PATH (never the agent's); null refuses the request. */
  sudo: () => string | null;
  /** user@host shown on the phone. */
  account: string;
  ttlMs?: number;
  runMs?: number;
  now?: () => number;
  spawn?: SudoSpawn;
  /**
   * Whether sudo would prompt for this command. With a NOPASSWD rule, `sudo -S` never reads stdin,
   * so a password line would reach the command itself (and through it, the agent). Default:
   * `sudo -k -n -l -- <cmd>` exits 0 only when no password is needed.
   */
  needsPassword?: (sudo: string, argv: readonly string[]) => Promise<boolean>;
  /** Receives ids, counts and outcomes only; never the command text or any secret. */
  log?: (event: string, fields: Record<string, unknown>) => void;
}

interface Pending {
  request: SecretRequest;
  privateKey: KeyObject;
  publicRaw: Buffer;
  run: SudoRun;
  sudo: string;
  resolve: (result: SudoResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Display form of argv: plain words as is, anything else single-quoted. */
export function displayCommand(argv: readonly string[]): string {
  return argv.map(arg => /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`).join(" ");
}

export function validateSudoRun(raw: unknown): SudoRun | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "body must be an object";
  const argv: unknown = Reflect.get(raw, "argv");
  const cwd: unknown = Reflect.get(raw, "cwd");
  const reason: unknown = Reflect.get(raw, "reason");
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > MAX_ARGS) return `argv must be 1-${MAX_ARGS} strings`;
  const args: string[] = [];
  for (const arg of argv) {
    if (typeof arg !== "string" || arg.length > MAX_ARG || arg.includes("\0")) return "argv entries must be strings without NUL";
    args.push(arg);
  }
  if (args[0] === "" || args[0]!.startsWith("-")) return "argv[0] must be a command, not a sudo option";
  if (displayCommand(args).length > MAX_SECRET_COMMAND) return `command too long (max ${MAX_SECRET_COMMAND} characters shown)`;
  if (cwd !== undefined && (typeof cwd !== "string" || !cwd.startsWith("/") || cwd.includes("\0"))) return "cwd must be an absolute path";
  if (reason !== undefined && (typeof reason !== "string" || reason.length > MAX_SECRET_REASON || /[\u0000-\u001f\u007f]/.test(reason))) return "reason must be one short line";
  return { argv: args, cwd: typeof cwd === "string" ? cwd : process.cwd(), ...(typeof reason === "string" && reason.trim() ? { reason: reason.trim() } : {}) };
}

function rawPublicKey(key: KeyObject): Buffer {
  const der = key.export({ type: "spki", format: "der" });
  return Buffer.from(der.subarray(der.length - 32));
}

/** Replace every occurrence of `needle` bytes in `hay` (redaction is defence in depth only). */
function redact(hay: Buffer, needle: Buffer): Buffer {
  if (needle.length === 0) return hay;
  const parts: Buffer[] = [];
  let from = 0;
  for (let at = hay.indexOf(needle, from); at !== -1; at = hay.indexOf(needle, from)) {
    parts.push(hay.subarray(from, at), Buffer.from("[redacted]"));
    from = at + needle.length;
  }
  if (from === 0) return hay;
  parts.push(hay.subarray(from));
  return Buffer.concat(parts);
}

const capped = (b: Buffer) => (b.length > MAX_OUTPUT ? Buffer.concat([b.subarray(0, MAX_OUTPUT), Buffer.from("\n[output truncated]\n")]) : b);

export const defaultSudoSpawn: SudoSpawn = async (cmd, { cwd, stdin, timeoutMs }) => {
  const child = Bun.spawn(cmd, { cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  child.stdin.write(stdin);
  await child.stdin.end();
  const kill = setTimeout(() => child.kill(), timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).arrayBuffer(), new Response(child.stderr).arrayBuffer(), child.exited]);
    return { exitCode, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) };
  } finally { clearTimeout(kill); }
};

export const defaultNeedsPassword = async (sudo: string, argv: readonly string[]): Promise<boolean> => {
  try {
    const child = Bun.spawn([sudo, "-k", "-n", "-l", "--", ...argv], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    const kill = setTimeout(() => child.kill(), 10_000);
    try { return (await child.exited) !== 0; } finally { clearTimeout(kill); }
  } catch { return true; }
};

export class SecretBroker {
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(message: SecretRequest | SecretResolved) => void>();
  private readonly now: () => number;
  private readonly spawn: SudoSpawn;
  constructor(private readonly options: SecretBrokerOptions) {
    this.now = options.now ?? Date.now;
    this.spawn = options.spawn ?? defaultSudoSpawn;
  }

  /** Live phones get every open request now and every later request/resolution. */
  subscribe(send: (message: SecretRequest | SecretResolved) => void): () => void {
    this.listeners.add(send);
    for (const p of this.pending.values()) {
      try { send(p.request); } catch { this.listeners.delete(send); break; }
    }
    return () => { this.listeners.delete(send); };
  }

  openCount(): number { return this.pending.size; }

  private broadcast(message: SecretRequest | SecretResolved): void {
    for (const send of this.listeners) {
      try { send(message); } catch { this.listeners.delete(send); }
    }
  }

  private log(event: string, fields: Record<string, unknown>): void {
    try { this.options.log?.(event, fields); } catch { /* logging never fails a request */ }
  }

  async requestSudo(run: SudoRun): Promise<SudoResult> {
    const sudo = this.options.sudo();
    if (!sudo) return { outcome: "refused", exitCode: null, stdout: "", stderr: "", message: "sudo is not installed on this host" };
    if (this.pending.size >= MAX_PENDING) return { outcome: "refused", exitCode: null, stdout: "", stderr: "", message: "too many sudo requests are waiting on the phone" };
    if (!(await (this.options.needsPassword ?? defaultNeedsPassword)(sudo, run.argv))) {
      // Never collect a password sudo will not read: it would be the command's stdin.
      this.log("secret.resolved", { outcome: "refused", reason: "no-password-needed" });
      return { outcome: "refused", exitCode: null, stdout: "", stderr: "", message: "sudo does not ask for a password for this command here; no password was requested from the phone" };
    }
    if (this.pending.size >= MAX_PENDING) return { outcome: "refused", exitCode: null, stdout: "", stderr: "", message: "too many sudo requests are waiting on the phone" };
    const { privateKey, publicKey } = generateKeyPairSync("x25519");
    const publicRaw = rawPublicKey(publicKey);
    const id = randomBytes(16).toString("base64url");
    const request: SecretRequest = {
      type: "secret_request", id, kind: "sudo", command: displayCommand(run.argv), account: this.options.account,
      ...(run.reason ? { reason: run.reason } : {}), publicKey: publicRaw.toString("base64"), expiresAt: this.now() + (this.options.ttlMs ?? DEFAULT_TTL_MS),
    };
    return new Promise(resolve => {
      const timer = setTimeout(() => this.finish(id, "expired", "No password was entered on the phone in time."), this.options.ttlMs ?? DEFAULT_TTL_MS);
      this.pending.set(id, { request, privateKey, publicRaw, run, sudo, resolve, timer });
      this.log("secret.request", { id, argc: run.argv.length });
      this.broadcast(request);
    });
  }

  cancel(id: string): void { this.finish(id, "cancelled", "The owner declined on the phone."); }

  private finish(id: string, outcome: SecretOutcome, message: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    this.log("secret.resolved", { id, outcome });
    this.broadcast({ type: "secret_resolved", id, outcome, message });
    p.resolve({ outcome, exitCode: null, stdout: "", stderr: "", message });
  }

  /** Open a sealed password. Throws on any mismatch; the caller wipes the result. */
  private open(p: Pending, submit: SecretSubmit): Buffer {
    const ephemeralRaw = Buffer.from(submit.ephemeralKey, "base64");
    const nonce = Buffer.from(submit.nonce, "base64");
    const sealed = Buffer.from(submit.ciphertext, "base64");
    if (ephemeralRaw.length !== 32 || nonce.length !== 12 || sealed.length < 17 || sealed.length > MAX_SECRET_BYTES + 16) throw new Error("bad sealed secret");
    const ephemeral = createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, ephemeralRaw]), format: "der", type: "spki" });
    const shared = diffieHellman({ privateKey: p.privateKey, publicKey: ephemeral });
    try {
      if (shared.every(byte => byte === 0)) throw new Error("low-order key");
      const key = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([ephemeralRaw, p.publicRaw]), SECRET_SEAL_INFO, 32));
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAAD(Buffer.from(secretAad(p.request.id)));
        decipher.setAuthTag(sealed.subarray(sealed.length - 16));
        return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
      } finally { key.fill(0); }
    } finally { shared.fill(0); }
  }

  async submit(submit: SecretSubmit): Promise<void> {
    const p = this.pending.get(submit.id);
    if (!p) return;
    let secret: Buffer;
    try { secret = this.open(p, submit); }
    catch { this.finish(submit.id, "failed", "The sealed password could not be opened. Try again from the agent."); return; }
    this.pending.delete(submit.id);
    clearTimeout(p.timer);
    if (secret.length === 0 || secret.includes(0x0a) || secret.includes(0x0d) || secret.includes(0)) {
      secret.fill(0);
      this.log("secret.resolved", { id: submit.id, outcome: "refused" });
      const message = "A password cannot be empty or contain line breaks.";
      this.broadcast({ type: "secret_resolved", id: submit.id, outcome: "refused", message });
      p.resolve({ outcome: "refused", exitCode: null, stdout: "", stderr: "", message });
      return;
    }
    const stdin = Buffer.concat([secret, Buffer.from("\n")]);
    let result: SpawnResult;
    try {
      result = await this.spawn([p.sudo, "-k", "-S", "-p", "", "--", ...p.run.argv], { cwd: p.run.cwd, stdin, timeoutMs: this.options.runMs ?? DEFAULT_RUN_MS });
    } catch {
      secret.fill(0); stdin.fill(0);
      this.log("secret.resolved", { id: submit.id, outcome: "failed" });
      const message = "sudo could not be started.";
      this.broadcast({ type: "secret_resolved", id: submit.id, outcome: "failed", message });
      p.resolve({ outcome: "failed", exitCode: null, stdout: "", stderr: "", message });
      return;
    }
    const stdout = capped(redact(result.stdout, secret)).toString("utf8");
    const stderr = capped(redact(result.stderr, secret)).toString("utf8");
    secret.fill(0); stdin.fill(0);
    const message = result.exitCode === 0 ? "Ran with sudo." : `sudo exited ${result.exitCode ?? "by signal"}.`;
    this.log("secret.resolved", { id: submit.id, outcome: "delivered", exitCode: result.exitCode });
    this.broadcast({ type: "secret_resolved", id: submit.id, outcome: "delivered", message });
    p.resolve({ outcome: "delivered", exitCode: result.exitCode, stdout, stderr, message });
  }

  dispose(): void {
    for (const id of [...this.pending.keys()]) this.finish(id, "cancelled", "The bridge is shutting down.");
    this.listeners.clear();
  }
}

/** POST /secret/sudo on the loopback listener: { argv, cwd?, reason? } with the bridge token.
 * Same admission as /notice: loopback peer, loopback Host, no browser Origin, bearer token. */
export function createSudoHttpHandler(options: { token: string; broker: SecretBroker }) {
  return async (request: Request, peer: string | null, holdOpen: () => void): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== "/secret/sudo") return null;
    if ((peer !== "127.0.0.1" && peer !== "::1" && peer !== "::ffff:127.0.0.1") || request.headers.has("origin") ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return new Response("forbidden", { status: 403 });
    if (!options.token.trim() || !secretMatches(bearerToken(request), options.token)) return new Response("unauthorized", { status: 401 });
    if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
    let body: unknown;
    try { body = JSON.parse(await request.text()); } catch { return new Response("invalid JSON", { status: 400 }); }
    const run = validateSudoRun(body);
    if (typeof run === "string") return new Response(run, { status: 400 });
    holdOpen();
    const result = await options.broker.requestSudo(run);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  };
}
