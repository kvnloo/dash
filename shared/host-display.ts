import type { HostInfo } from "./protocol";

/** Routing IDs may be short DNS labels ("0"); never use them as a computer's name. */
export function hostDisplayName(host: Pick<HostInfo, "id" | "name" | "hostname">): string {
  return host.hostname.trim() || host.name.trim() || host.id;
}
