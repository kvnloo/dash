import type { HostInfo } from "../../../shared/protocol";

/** openIn describes another viewer, not whether a gateway can accept a message. */
export function sessionViewerLabel(surface: string, targetHostId: string | undefined, connection: { hosts: HostInfo[]; host?: string }): string {
  const host = connection.hosts.find(h => h.id === targetHostId || h.hostname === targetHostId);
  const name = host?.hostname || host?.name || connection.host || "the host";
  return `Also open in ${surface} on ${name} · reply here to continue`;
}
