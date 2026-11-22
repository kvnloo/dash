// DA-075: which Council card is open. One card app-wide; the live call and any chat open the same one.
import type { CouncilTarget } from "../lib/council-session";
import { createStore } from "./createStore";

export type CouncilOrigin = "z0live" | "chat";
export interface CouncilOpen { readonly open: boolean; readonly from: CouncilOrigin; readonly opened: number; readonly target?: CouncilTarget }

export const council = createStore<CouncilOpen>({ open: false, from: "chat", opened: 0 });
export function openCouncil(from: CouncilOrigin, target?: CouncilTarget): void { council.set(s => ({ open: true, from, target, opened: s.opened + 1 })); }
export function closeCouncil(): void { council.set(s => ({ ...s, open: false })); }
