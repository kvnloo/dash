import { commandRejection, parseSurfaceCommand, primitiveRect, type Primitive, type SurfaceReceipt, type SurfaceSnapshot, type SurfaceTarget, type Rect, type SurfaceRoute } from "../../../shared/agent-surface";
import { record } from "../../../shared/z0bridge-identity";
import { createStore } from "../store/createStore";

interface SurfaceState { enabled: boolean; target?: SurfaceTarget; route: string; generation: number; viewport: Rect; insets: SurfaceSnapshot["insets"]; anchors: Record<string, Rect>; annotationOpen: boolean; drawings: Primitive[]; drawUntil: number }
export const surface = createStore<SurfaceState>({ enabled: false, route: "", generation: 1, viewport: { x: 0, y: 0, width: 1, height: 1 }, insets: { top: 0, bottom: 0, left: 0, right: 0, keyboard: 0 }, anchors: {}, annotationOpen: false, drawings: [], drawUntil: 0 });
export const surfaceClient = `dash-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
const mainTabs = new Map<string, number>();
export function setSurfaceMainTab(key: string, tab: number | undefined): void { if (tab === undefined) mainTabs.delete(key); else mainTabs.set(key, tab); }
export function surfaceMainTab(key: string): number | undefined { return mainTabs.get(key); }
let send: ((value: unknown) => void) | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;
let actions: { navigate(route: SurfaceRoute): void; openAnnotation(): void; rendered(): Promise<void> } | undefined;
const receipts = new Map<string, { payload: string; receipt: SurfaceReceipt }>();
let busy = false;
let committed: SurfaceState | undefined;
export function markSurfaceCommitted(state: SurfaceState): void { committed = state; }
export function surfaceIsCommitted(): boolean { return committed === surface.get(); }
export function setSurfaceActions(next: typeof actions): void { actions = next; }
export function snapshot(): SurfaceSnapshot | undefined {
  const s = surface.get();
  return s.target ? { target: s.target, enabled: s.enabled, route: s.route, generation: s.generation, viewport: s.viewport, insets: s.insets, anchors: s.anchors, annotationOpen: s.annotationOpen, expiresAt: Date.now() + 10000 } : undefined;
}
export function publishSurface(): void { const state = snapshot(); send?.({ type: "surface_state", state: state ?? null }); }
export function setSurfaceTransport(next: typeof send): void { send = next; if (next) publishSurface(); }
export function updateSurface(patch: Partial<Pick<SurfaceState, "route" | "viewport" | "insets" | "anchors" | "annotationOpen" | "target">>): void {
  const previous = surface.get();
  const next = { ...previous, ...patch };
  if (JSON.stringify({ ...previous, generation: 0, drawings: [] }) === JSON.stringify({ ...next, generation: 0, drawings: [] })) return;
  const changedTarget = JSON.stringify(previous.target) !== JSON.stringify(next.target);
  surface.set({ ...next, enabled: changedTarget ? false : next.enabled, generation: previous.generation + 1, drawings: [], drawUntil: 0 });
  if (changedTarget) receipts.clear();
  publishSurface();
}
export function allowSurface(enabled: boolean): void {
  receipts.clear(); clearTimeout(expiry);
  surface.set(s => ({ ...s, enabled, generation: s.generation + 1, drawings: [], drawUntil: 0 })); publishSurface();
}
export function clearSurface(): void { clearTimeout(expiry); surface.set(s => ({ ...s, drawings: [], drawUntil: 0 })); }
export async function receiveSurface(raw: unknown): Promise<boolean> {
  if (!record(raw) || raw.type !== "surface_command") return false;
  const c = parseSurfaceCommand(raw.command), s = snapshot();
  if (!c || !s) return true;
  const payload = JSON.stringify(c), old = receipts.get(c.id);
  if (old) {
    send?.({ type: "surface_receipt", receipt: old.payload === payload ? old.receipt : { id: c.id, status: "rejected", reason: "id-conflict", snapshot: s } }); return true;
  }
  let reason = commandRejection(c, s);
  if (!actions) reason = "not-ready";
  if (busy) reason = "busy";
  if (c.op === "draw" && c.primitives?.some(p => !primitiveRect(p, s))) reason = "anchor-occluded";
  const acquired = !reason;
  if (acquired) busy = true;
  try {
    if (!reason && actions) {
      if (c.op === "navigate" && c.destination) actions.navigate(c.destination);
      else if (c.op === "annotation.open") actions.openAnnotation();
      else if (c.op === "clear" || c.op === "dismiss") clearSurface();
      else if (c.op === "draw") {
        clearTimeout(expiry);
        surface.set(s => ({ ...s, drawings: c.primitives ?? [], drawUntil: Date.now() + (c.ttlMs ?? 500) }));
        expiry = setTimeout(clearSurface, c.ttlMs);
      }
      // Acknowledgement comes after React layout/effect + frame fences, not dispatch.
      await actions.rendered();
      const after = snapshot();
      if (!after || !after.enabled) reason = "control-disabled";
      else if (JSON.stringify(after.target) !== JSON.stringify(c.target)) reason = "wrong-target";
      else if (c.op === "navigate" && c.destination && c.destination !== "back" && after.route !== c.destination) reason = "navigation-not-applied";
      else if (c.op === "annotation.open" && !after.annotationOpen) reason = "annotation-not-applied";
      else if (c.op === "draw" && surface.get().drawings.length !== c.primitives?.length) reason = "layout-changed";
    }
  } catch { reason = "apply-failed"; }
  finally { if (acquired) busy = false; }
  const receipt: SurfaceReceipt = { id: c.id, status: reason ? "rejected" : "rendered", ...(reason ? { reason } : {}), snapshot: snapshot() ?? s };
  receipts.set(c.id, { payload, receipt });
  while (receipts.size > 128) { const first = receipts.keys().next().value; if (first) receipts.delete(first); }
  send?.({ type: "surface_receipt", receipt });
  return true;
}
