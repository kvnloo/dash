import { DEX_OFF, type DexListener, type DexSimulation } from "./dex-types";
export * from "./dex-types";
export const available = false;
export async function getState() { return DEX_OFF; }
export async function openPad() { return false; }
export async function closePad() { return false; }
export async function moveMainToDex() { return false; }
export function subscribe(_listener: DexListener) { return () => {}; }
export function simulate(_input: DexSimulation) { return DEX_OFF; }
