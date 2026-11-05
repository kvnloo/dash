// Host → phone file push. When an agent reply names a file the phone cannot open,
// the owner can tap "Send to phone"; the bridge pushes it with KDE Connect. Only
// files under allowlisted directories qualify, and only on an authenticated,
// explicit request. Nothing is ever pushed on an agent's initiative.
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** KDE Connect transfers are slow on mobile links; keep a hard ceiling. */
export const MAX_SHARE_BYTES = 200 * 1024 * 1024;

export type ShareCheck =
  | { ok: true; path: string; size: number }
  | { ok: false; status: number; message: string };

export type Run = (argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const SECRET_NAME = /(^|[._-])(env|token|tokens|secret|secrets|credential|credentials|password|passwd|id_rsa|id_ed25519|bootstrap-token)([._-]|$)|\.(pem|key|p12|pfx|kdbx|keystore)$/i;

function realDir(path: string): string | null {
  try {
    const real = realpathSync(path);
    return statSync(real).isDirectory() ? real : null;
  } catch { return null; }
}

/**
 * Allowlisted share roots: the defaults plus `DASH_SHARE_DIRS` (colon-separated). Missing
 * directories are dropped; the filesystem root and the home directory itself are refused
 * because they would allow everything.
 */
export function shareRoots(defaults: readonly string[], extra: string | undefined, home: string): string[] {
  const out: string[] = [];
  const homeReal = realDir(home);
  for (const raw of [...defaults, ...(extra ?? "").split(":")]) {
    const trimmed = raw.trim();
    if (!trimmed || !isAbsolute(trimmed)) continue;
    const real = realDir(resolve(trimmed));
    if (!real || real === sep || real === homeReal || out.includes(real)) continue;
    out.push(real);
  }
  return out;
}

/** Resolve a requested path to a real file inside an allowlisted root, or say why not. */
export function checkShareable(raw: unknown, roots: readonly string[]): ShareCheck {
  if (typeof raw !== "string" || !raw || raw.length > 4096 || raw.includes("\0")) return { ok: false, status: 400, message: "Give an absolute file path." };
  const expanded = raw.trim();
  if (!isAbsolute(expanded)) return { ok: false, status: 400, message: "Give an absolute file path." };
  let real: string;
  try { real = realpathSync(expanded); } catch { return { ok: false, status: 404, message: "That file is not on the host." }; }
  const root = roots.find(r => real.startsWith(r + sep));
  if (!root) return { ok: false, status: 403, message: "That folder is not shared with the phone." };
  const parts = relative(root, real).split(sep);
  if (parts.some(p => p.startsWith(".") || SECRET_NAME.test(p))) return { ok: false, status: 403, message: "Hidden and credential files are never sent." };
  let size: number;
  try {
    const stat = statSync(real);
    if (!stat.isFile()) return { ok: false, status: 400, message: "That path is not a file." };
    size = stat.size;
  } catch { return { ok: false, status: 404, message: "That file is not on the host." }; }
  if (size > MAX_SHARE_BYTES) return { ok: false, status: 413, message: "That file is too large to send." };
  return { ok: true, path: real, size };
}

/** The configured device, or the single reachable paired device. Never guesses between several. */
export async function pickDevice(configured: string | undefined, run: Run): Promise<string | null> {
  const id = configured?.trim();
  if (id) return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
  try {
    const listed = await run(["kdeconnect-cli", "-a", "--id-only"]);
    if (listed.code !== 0) return null;
    const ids = listed.stdout.split("\n").map(l => l.trim()).filter(l => /^[A-Za-z0-9_-]{8,64}$/.test(l));
    return ids.length === 1 ? ids[0] ?? null : null;
  } catch { return null; }
}

export async function shareToPhone(path: string, device: string, run: Run): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await run(["kdeconnect-cli", "-d", device, "--share", path]);
    return result.code === 0 ? { ok: true, message: "Sent to your phone with KDE Connect." } : { ok: false, message: "KDE Connect could not send it. Is the phone reachable?" };
  } catch {
    return { ok: false, message: "KDE Connect is not installed on the host." };
  }
}

export const bunRun: Run = async argv => {
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr };
};

/** Default roots: the bridge's working directory, the attachments store and common user folders. */
export function defaultShareDirs(cwd: string, attachmentsRoot: string, home: string): string[] {
  return [cwd, attachmentsRoot, join(home, "Downloads"), join(home, "Pictures"), join(home, "Documents")];
}
