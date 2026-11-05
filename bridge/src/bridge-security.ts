import { timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";

export interface BridgeBindOptions {
  tailnetIp: string | null;
  requestedHost?: string;
  allowLoopback?: boolean;
}

export function isTailnetIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split(".").map(Number);
  return first === 100 && second !== undefined && second >= 64 && second <= 127;
}

export function resolveBridgeHost(options: BridgeBindOptions): string {
  const { tailnetIp, requestedHost, allowLoopback } = options;
  if (allowLoopback && (requestedHost === "127.0.0.1" || requestedHost === "::1")) return requestedHost;
  if (!tailnetIp || !isTailnetIPv4(tailnetIp)) {
    throw new Error("Tailscale IPv4 unavailable. Bridge startup refused. Isolated local tests require DASH_ALLOW_LOOPBACK=1 and DASH_HOST=127.0.0.1.");
  }
  if (requestedHost !== undefined && requestedHost !== tailnetIp) {
    throw new Error("DASH_HOST must equal this machine's detected Tailscale IPv4.");
  }
  return tailnetIp;
}

function loadSecret(directory: string, name: string, minimumLength: number): string {
  const path = join(directory, name);
  let secret: string;
  try {
    secret = readFileSync(path, "utf8").trim();
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    secret = crypto.randomUUID().replaceAll("-", "");
    try {
      writeFileSync(path, secret, { mode: 0o600, flag: "wx" });
    } catch (writeError) {
      if (!(writeError instanceof Error) || !("code" in writeError) || writeError.code !== "EEXIST") throw writeError;
      secret = readFileSync(path, "utf8").trim();
    }
  }
  if (secret.length < minimumLength || secret.length > 256 || /\s/.test(secret)) {
    throw new Error(`Invalid Dash ${name} file. Restore or rotate it locally before starting the bridge.`);
  }
  chmodSync(path, 0o600);
  return secret;
}

export function loadBridgeSecrets(directory: string): { token: string; bootstrapToken: string } {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const token = loadSecret(directory, "token", 16);
  const bootstrapToken = loadSecret(directory, "bootstrap-token", 32);
  if (secretMatches(token, bootstrapToken)) throw new Error("Dash bootstrap and execution tokens must be distinct.");
  return { token, bootstrapToken };
}

export function secretMatches(supplied: string | null, expected: string): boolean {
  if (supplied === null || supplied.length > 256) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}
