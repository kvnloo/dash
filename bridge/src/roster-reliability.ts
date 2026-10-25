import type { HostInfo } from "../../shared/protocol";

type HostIdentity = Pick<HostInfo, "id" | "name" | "hostname" | "self">;

/**
 * Only roster-verified local identifiers are aliases for the paired bridge.
 * A remote host's routing ID wins over a coincidentally matching local
 * display/OS hostname: accepting that alias could execute a remote row here.
 */
export function localRoutingIds(hosts: readonly HostIdentity[], fallbackHostname: string): Set<string> {
  const local = hosts.find((host) => host.self);
  const remoteIds = new Set(hosts.filter((host) => !host.self).map((host) => host.id));
  const aliases = new Set<string>();

  for (const candidate of [fallbackHostname, local?.id, local?.name, local?.hostname]) {
    if (candidate && !remoteIds.has(candidate)) aliases.add(candidate);
  }
  return aliases;
}

/** An omitted host ID is the legacy paired-bridge route, not an empty ID. */
export function isLocalRoute(hostId: string | undefined, aliases: ReadonlySet<string>): boolean {
  return hostId === undefined || (hostId.length > 0 && aliases.has(hostId));
}

/**
 * Keeps the last observed gateway list while a bounded probe is in flight.
 * A failed/missing probe clears it. A superseded probe cannot overwrite a
 * newer result after a disconnect, process exit or rapid roster refresh.
 */
export class GatewayListSnapshot {
  private generation = 0;
  private list = "";

  read(): string {
    return this.list;
  }

  refresh(start: (settle: (result: string | null) => void) => void): void {
    const generation = ++this.generation;
    const settle = (result: string | null): void => {
      if (generation === this.generation) this.list = result ?? "";
    };
    try {
      start(settle);
    } catch {
      settle(null);
    }
  }
}
