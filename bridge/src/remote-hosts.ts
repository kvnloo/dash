// Continue a Claude Code or Codex chat that was recorded on another of the owner's computers.
// The phone keeps one paired bridge. That bridge reaches the other computer over SSH and drives
// that computer's own ACP adapter (`dash-acp`, bridge/bin) through stdio, exactly like a local
// adapter: the session, its files and its credentials never leave the computer that owns them.
//
//   DASH_REMOTE_HOSTS="host-a" | "host-a=ssh-alias,other"   AgentsView machine names this bridge may
//                                                      route turns to (=ssh destination, default
//                                                      the same name). Unset: no remote routing.
//   DASH_REMOTE_SHELL="ssh -T -o BatchMode=yes"        the transport; it gets `<dest> <command>`.
//   DASH_REMOTE_ACP="dash-acp"                          the adapter launcher on the other computer.
import { AGENTSVIEW_PREFIX } from "./agentsview-sessions";

/** Harnesses whose recorded sessions can be resumed over ACP on the computer that recorded them. */
export const REMOTE_HARNESSES: readonly string[] = ["claude", "codex"];

export interface RemoteHost {
  /** The AgentsView machine name. */
  machine: string;
  /** The chat-index host id the phone sees for that machine (`machine:<name>`). */
  hostId: string;
  /** SSH destination. */
  dest: string;
}

/** The chat-index host id for an AgentsView machine name (shared with chat-index/agentsview-src). */
export function machineHostId(raw: string): string {
  return `machine:${raw.trim().replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 56) || "unknown"}`;
}

const NAME = /^[A-Za-z0-9._-]{1,64}$/;
const DEST = /^[A-Za-z0-9._@:-]{1,128}$/;

export function remoteHosts(env: Record<string, string | undefined> = process.env): RemoteHost[] {
  const out: RemoteHost[] = [];
  for (const entry of (env.DASH_REMOTE_HOSTS ?? "").split(",")) {
    const [machine = "", dest = machine] = entry.trim().split("=").map(s => s.trim());
    if (!NAME.test(machine) || !DEST.test(dest) || out.some(h => h.machine === machine)) continue;
    out.push({ machine, hostId: machineHostId(machine), dest });
  }
  return out;
}

/** Host ids the phone may send turns to through this bridge, besides this computer. */
export function remoteRouteIds(hosts: readonly RemoteHost[] = remoteHosts()): string[] {
  return hosts.map(h => h.hostId);
}

export function remoteHostFor(hostId: string | undefined, hosts: readonly RemoteHost[] = remoteHosts()): RemoteHost | undefined {
  return hostId ? hosts.find(h => h.hostId === hostId) : undefined;
}

/** Why a turn for `host` cannot run, or undefined when it can. */
export function remoteTurnProblem(host: RemoteHost, turn: { harness: string; profileId?: string; sessionId?: string; cwd?: string; attachments?: number }): string | undefined {
  if (!REMOTE_HARNESSES.includes(turn.harness)) return `Only Claude Code and Codex chats on ${host.machine} can be continued from this bridge.`;
  if (!turn.sessionId || turn.profileId !== `${AGENTSVIEW_PREFIX}${turn.harness}:${turn.sessionId}`) return `Open the chat recorded on ${host.machine} from Chats to continue it.`;
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(turn.sessionId)) return "That session id cannot be resumed.";
  if (!turn.cwd || !turn.cwd.startsWith("/") || /['\\\n\r\0]/.test(turn.cwd)) return `That chat has no usable working directory on ${host.machine}.`;
  if (turn.attachments) return `Attachments stay on this bridge; send text to the chat on ${host.machine}.`;
  return undefined;
}

const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

/**
 * argv for the local process that carries the ACP stdio to the other computer. The remote
 * command is one quoted string, so it means the same in sh, bash, zsh and fish.
 */
export function remoteAcpCommand(host: RemoteHost, harness: string, cwd: string, env: Record<string, string | undefined> = process.env): string[] {
  const launcher = env.DASH_REMOTE_ACP?.trim() || "dash-acp";
  return remoteShellCommand(host, [launcher, harness, "--cwd", quote(cwd)].join(" "), env);
}

/** Shared SSH destination and transport for turns and read-only history. */
export function remoteShellCommand(host: RemoteHost, command: string, env: Record<string, string | undefined> = process.env): string[] {
  const shell = (env.DASH_REMOTE_SHELL?.trim() || "ssh -T -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=30").split(/\s+/);
  return [...shell, host.dest, command];
}
