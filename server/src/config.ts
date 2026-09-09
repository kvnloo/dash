import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  port: number;
  /** Pairing token the phone must present. */
  token: string;
  /** Default working directory for harness turns. */
  cwd: string;
}

const DIR = join(homedir(), ".config", "dash");
const FILE = join(DIR, "config.json");

// Unambiguous when read aloud or typed on a phone: no 0/o, 1/i/l.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function randomToken(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readStored(): Promise<Partial<Config>> {
  const file = Bun.file(FILE);
  if (!(await file.exists())) return {};
  const raw: unknown = await file.json().catch(() => undefined);
  if (!isRecord(raw)) return {};
  return {
    port: typeof raw.port === "number" ? raw.port : undefined,
    token: typeof raw.token === "string" ? raw.token : undefined,
    cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
  };
}

/** Load `~/.config/dash/config.json`, creating it with a fresh token on first run. */
export async function loadConfig(env: NodeJS.ProcessEnv): Promise<Config> {
  const stored = await readStored();
  const envPort = Number(env.DASH_PORT);
  const config: Config = {
    port: Number.isInteger(envPort) && envPort > 0 ? envPort : stored.port ?? 8787,
    token: env.DASH_TOKEN ?? stored.token ?? randomToken(8),
    cwd: env.DASH_CWD ?? stored.cwd ?? join(homedir(), "workspace"),
  };
  if (stored.token !== config.token || stored.port !== config.port || stored.cwd !== config.cwd) {
    mkdirSync(DIR, { recursive: true });
    await Bun.write(FILE, `${JSON.stringify(config, null, 2)}\n`);
  }
  return config;
}

export const CONFIG_PATH = FILE;
