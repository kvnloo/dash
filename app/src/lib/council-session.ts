import { record } from "../../../shared/context";
import { parseCouncilList, parseCouncilSession, type CouncilPosition, type CouncilSession } from "../../../shared/council-session";
import type { Settings } from "../model";
import { executionToken } from "./bridge-auth";

export interface CouncilTarget { session: string; profile: string; host?: string }
type Request = { verb: "list" } | { verb: "load"; council_id: string } |
  { verb: "position"; council_id: string; base_revision: number; position: CouncilPosition };

export function councilSessionApi(settings: Settings, target: CouncilTarget) {
  const query = new URLSearchParams({ session: target.session, profile: target.profile });
  if (target.host) query.set("host", target.host);
  const request = async (body: Request, signal?: AbortSignal): Promise<unknown> => {
    const response = await fetch(`http://${settings.address}/council/session?${query}`, {
      method: "POST", headers: { Authorization: `Bearer ${await executionToken(settings)}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal,
    });
    const raw: unknown = await response.json();
    if (!response.ok) {
      if (response.status === 409 && record(raw) && typeof raw.error === "string") throw new Error(raw.error);
      throw new Error("Saved councils unavailable. Check that Dash is paired with this Hermes session’s host and Glide is installed.");
    }
    return raw;
  };
  const session = (raw: unknown, id: string): CouncilSession => {
    const parsed = parseCouncilSession(raw);
    if (!parsed || parsed.council_id !== id) throw new Error("This saved council is invalid or uses an unsupported version.");
    return parsed;
  };
  return {
    async list(signal: AbortSignal) {
      const list = parseCouncilList(await request({ verb: "list" }, signal));
      if (!list) throw new Error("Could not read the saved council list.");
      return list;
    },
    async load(id: string, signal: AbortSignal) {
      return session(await request({ verb: "load", council_id: id }, signal), id);
    },
    async move(id: string, revision: number, position: CouncilPosition) {
      const updated = session(await request({ verb: "position", council_id: id, base_revision: revision, position }), id);
      if (updated.revision !== revision + 1) throw new Error("Council position could not be confirmed.");
      return updated.revision;
    },
  };
}

/** Coalesce snapshots while the previous write is pending. Never retry an uncertain or stale write. */
export function councilPositionWriter(api: ReturnType<typeof councilSessionApi>, saved: CouncilSession, onError: (message: string) => void) {
  let revision = saved.revision;
  let pending: CouncilPosition | undefined;
  let active = false;
  let failed = false;
  return async (position: CouncilPosition) => {
    if (failed) return;
    pending = position;
    if (active) return;
    active = true;
    try {
      while (pending) {
        const next = pending;
        pending = undefined;
        revision = await api.move(saved.council_id, revision, next);
      }
    } catch (error) {
      failed = true;
      pending = undefined;
      onError(error instanceof Error ? error.message : "Council position could not be saved.");
    } finally {
      active = false;
    }
  };
}
