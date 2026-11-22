import { useEffect, useState } from "react";
import { parseRoles, type ResolvedRole } from "../../../shared/model-roles";
import { executionToken } from "../lib/bridge-auth";
import type { Settings } from "../model";

/**
 * The paired host's configured model roles (`GET /models`, the same reading as Settings › Models), loaded
 * only while `enabled` (the badge's model list is open). An old bridge or a failed read is an empty list,
 * never an invented model.
 */
export function useHostModelRoles(settings: Settings | null | undefined, enabled: boolean): ResolvedRole[] {
  const [roles, setRoles] = useState<ResolvedRole[]>([]);
  const address = settings?.address;
  useEffect(() => {
    if (!enabled || !settings || !address) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const token = await executionToken(settings);
        const response = await fetch(`http://${address}/models`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal });
        const rows = response.ok ? parseRoles(await response.json()) : null;
        if (!abort.signal.aborted) setRoles(rows ?? []);
      } catch { if (!abort.signal.aborted) setRoles([]); }
    })();
    return () => abort.abort();
    // Settings identity changes on every save; the address is what the reading belongs to.
  }, [enabled, address]);
  return roles;
}
