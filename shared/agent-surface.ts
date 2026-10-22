import { record } from "./z0bridge-identity";

export const SURFACE_ROUTES = ["chat", "bots", "chats", "orchestra", "settings", "trace", "lab", "back"] as const;
export type SurfaceRoute = typeof SURFACE_ROUTES[number];
export interface SurfaceTarget { client: string; host: string; profile: string; session: string; chat: string }
export interface Rect { x: number; y: number; width: number; height: number }
export interface SurfaceSnapshot {
  target: SurfaceTarget; enabled: boolean; route: string; generation: number; expiresAt: number;
  viewport: Rect; insets: { top: number; bottom: number; left: number; right: number; keyboard: number };
  anchors: Record<string, Rect>; annotationOpen: boolean;
}
export interface Primitive {
  kind: "arrow" | "box" | "circle" | "label";
  anchor?: string;
  rect?: Rect;
  text?: string;
}
export interface SurfaceCommand {
  id: string; target: SurfaceTarget; route: string; generation: number; expiresAt: number;
  op: "snapshot" | "navigate" | "annotation.open" | "draw" | "clear" | "dismiss";
  destination?: SurfaceRoute; ttlMs?: number; primitives?: Primitive[];
}
export interface SurfaceReceipt { id: string; status: "rendered" | "rejected"; reason?: string; snapshot: SurfaceSnapshot }
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const name = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 256;
export function parseTarget(x: unknown): SurfaceTarget | undefined {
  if (!record(x) || !name(x.client) || !name(x.host) || !name(x.profile) || !name(x.session) || !name(x.chat)) return;
  return { client: x.client, host: x.host, profile: x.profile, session: x.session, chat: x.chat };
}
export function sameTarget(a: SurfaceTarget, b: SurfaceTarget): boolean {
  return a.client === b.client && a.host === b.host && a.profile === b.profile && a.session === b.session && a.chat === b.chat;
}
export function parseRect(x: unknown): Rect | undefined {
  if (!record(x) || !finite(x.x) || !finite(x.y) || !finite(x.width) || !finite(x.height) || x.width <= 0 || x.height <= 0) return;
  return { x: x.x, y: x.y, width: x.width, height: x.height };
}
export function parseSnapshot(x: unknown): SurfaceSnapshot | undefined {
  if (!record(x)) return;
  const target = parseTarget(x.target), viewport = parseRect(x.viewport), i = x.insets;
  if (!target || !viewport || viewport.width > 10000 || viewport.height > 10000 || typeof x.enabled !== "boolean" || !name(x.route) ||
      !finite(x.generation) || !Number.isSafeInteger(x.generation) || !finite(x.expiresAt) || typeof x.annotationOpen !== "boolean" ||
      !record(i) || !finite(i.top) || !finite(i.bottom) || !finite(i.left) || !finite(i.right) || !finite(i.keyboard) ||
      [i.top, i.bottom, i.left, i.right, i.keyboard].some(v => v < 0 || v > 10000) || !record(x.anchors) || Object.keys(x.anchors).length > 64) return;
  const anchors: Record<string, Rect> = {};
  for (const [key, value] of Object.entries(x.anchors)) { const rect = parseRect(value); if (!rect || !name(key)) return; anchors[key] = rect; }
  return { target, viewport, enabled: x.enabled, route: x.route, generation: x.generation, expiresAt: x.expiresAt,
    annotationOpen: x.annotationOpen, anchors, insets: { top: i.top, bottom: i.bottom, left: i.left, right: i.right, keyboard: i.keyboard } };
}
export function parseSurfaceCommand(x: unknown): SurfaceCommand | undefined {
  if (!record(x) || !name(x.id) || !/^[a-zA-Z0-9_.-]+$/.test(x.id) || !name(x.route) || !finite(x.generation) || !Number.isSafeInteger(x.generation) || !finite(x.expiresAt)) return;
  const target = parseTarget(x.target);
  if (!target || !(x.op === "snapshot" || x.op === "navigate" || x.op === "annotation.open" || x.op === "draw" || x.op === "clear" || x.op === "dismiss")) return;
  let destination: SurfaceRoute | undefined;
  if (x.op === "navigate") { destination = SURFACE_ROUTES.find(r => r === x.destination); if (!destination) return; }
  const primitives: Primitive[] = [];
  if (x.op === "draw") {
    if (!finite(x.ttlMs) || x.ttlMs < 500 || x.ttlMs > 15000 || !Array.isArray(x.primitives) || !x.primitives.length || x.primitives.length > 16) return;
    for (const p of x.primitives) {
      if (!record(p) || !(p.kind === "arrow" || p.kind === "box" || p.kind === "circle" || p.kind === "label") ||
          Object.keys(p).some(k => !["kind", "anchor", "rect", "text"].includes(k)) ||
          (p.text !== undefined && (typeof p.text !== "string" || p.text.length > 120 || /[\u0000-\u001f]/.test(p.text)))) return;
      const rect = p.rect === undefined ? undefined : parseRect(p.rect);
      if (p.anchor !== undefined ? !name(p.anchor) || p.rect !== undefined : !rect || rect.x < 0 || rect.y < 0 || rect.x + rect.width > 1 || rect.y + rect.height > 1) return;
      primitives.push({ kind: p.kind, ...(typeof p.anchor === "string" ? { anchor: p.anchor } : { rect }), ...(typeof p.text === "string" ? { text: p.text } : {}) });
    }
  }
  // No arbitrary route params, JavaScript, approval or send-message payloads.
  const keys = ["id", "target", "route", "generation", "expiresAt", "op", ...(x.op === "navigate" ? ["destination"] : []), ...(x.op === "draw" ? ["ttlMs", "primitives"] : [])];
  if (Object.keys(x).some(k => !keys.includes(k))) return;
  return { id: x.id, target, route: x.route, generation: x.generation, expiresAt: x.expiresAt, op: x.op, ...(destination ? { destination } : {}), ...(x.op === "draw" && finite(x.ttlMs) ? { ttlMs: x.ttlMs, primitives } : {}) };
}
export function commandRejection(c: SurfaceCommand, s: SurfaceSnapshot, now = Date.now()): string | undefined {
  if (!s.enabled) return "control-disabled";
  if (!sameTarget(c.target, s.target)) return "wrong-target";
  if (c.expiresAt <= now || c.expiresAt > now + 15000 || s.expiresAt <= now) return "expired";
  if (c.route !== s.route || c.generation !== s.generation) return "stale-layout";
  if (c.op === "draw" && c.primitives?.some(p => p.anchor && !s.anchors[p.anchor])) return "unknown-anchor";
}
/** Clip every primitive to the currently usable viewport, including IME/safe areas. */
export function primitiveRect(p: Primitive, s: SurfaceSnapshot): Rect | undefined {
  const v = s.viewport, i = s.insets;
  const r = p.anchor ? s.anchors[p.anchor] : p.rect ? { x: p.rect.x * v.width, y: p.rect.y * v.height, width: p.rect.width * v.width, height: p.rect.height * v.height } : undefined;
  if (!r) return;
  const x = Math.max(i.left, r.x), y = Math.max(i.top, r.y);
  const right = Math.min(v.width - i.right, r.x + r.width), bottom = Math.min(v.height - Math.max(i.bottom, i.keyboard), r.y + r.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined;
}
