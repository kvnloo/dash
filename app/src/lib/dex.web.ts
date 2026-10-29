import { DEX_OFF, type DexListener, type DexSimulation, type DexState } from "./dex-types";
export * from "./dex-types";
// Web has no native feature. Explicit developer simulation is the only opt-in.
export const available = false;
export const detects = false;
let state: DexState = DEX_OFF;
const listeners = new Set<DexListener>();
function update(next: DexState) { state = next; for (const listener of listeners) listener(state); return state; }
export async function getState() { return state; }
export async function openPad() { if (state.mode === "off") return false; update({ ...state, padOpen: true }); return true; }
export async function closePad() { update({ ...state, padOpen: false }); return true; }
export async function moveMainToDex() { return state.mode !== "off"; }
export function subscribe(listener: DexListener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function simulate(input: DexSimulation) {
  if (!["off", "dual", "standalone"].includes(input.mode)) throw new Error("Invalid DeX mode");
  const tv = input.tv ?? { w: 1920, h: 1080 };
  if (!Number.isFinite(tv.w) || !Number.isFinite(tv.h) || tv.w <= 0 || tv.h <= 0) throw new Error("Invalid TV size");
  return update(input.mode === "off" ? DEX_OFF : { available: true, mode: input.mode, source: "web-simulation", tvDisplayId: 1, mainDisplayId: 1, padOpen: true, tv });
}
declare global { interface Window { __dashDex?: { simulate: typeof simulate; getState: typeof getState } } }
if (typeof window !== "undefined") window.__dashDex = { simulate, getState };
