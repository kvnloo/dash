import { homedir } from "node:os";
import { join } from "node:path";
import { hostGatewayProbe } from "./hermes-gateway-host";
import { HermesSessions } from "./hermes-sessions";
import type { HermesProfileInfo } from "./roster";

/** Native projection only: no CLI startup, secret sources, or child process tree. */
export async function readHermesProfiles(
  root = process.env.DASH_HERMES_ROOT ?? join(homedir(), ".hermes"),
  alive: (pid: number) => boolean = pid => {
    try {
      process.kill(pid, 0);
      return true;
    } catch { return false; }
  },
): Promise<HermesProfileInfo[]> {
  const sessions = new HermesSessions({ root });
  const gateway = hostGatewayProbe(root, alive);
  // Reuse native profile identity/deduplication, explicitly without credentials.
  return sessions.profiles(false).map(profile => ({
    id: profile.id,
    gateway: gateway.gatewayPids(profile.id, profile.home).length > 0 ? "running" : "stopped",
  }));
}

/** Stale-while-refreshing; callers never wait for discovery on the connect path. */
export class HermesProfileCache {
  private profiles: HermesProfileInfo[] = [];
  private pending: Promise<void> | undefined;

  constructor(private readonly load: () => Promise<HermesProfileInfo[]> = readHermesProfiles) {}

  read(): HermesProfileInfo[] {
    void this.refresh();
    return this.profiles;
  }

  refresh(): Promise<void> {
    if (!this.pending) {
      this.pending = Promise.resolve().then(() => this.load()).then(profiles => {
        this.profiles = profiles;
      }).catch(() => {
        // A failed read isn't an empty snapshot. Keep the last successful one.
      }).finally(() => { this.pending = undefined; });
    }
    return this.pending;
  }
}
