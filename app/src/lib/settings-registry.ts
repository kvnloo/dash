import { useEffect, useRef } from "react";
import { createStore } from "../store/createStore";

/**
 * One canonical list of display settings. Both the composer filter menu and the header display
 * menu render from it, so a control has exactly one home and is never drawn twice.
 *
 * - `home: "composer"`: frequently scrubbed axes and page controls. Hold-slide-dwell-scrub.
 * - `home: "header"`: rarely changed settings (thinking summaries, thumb side, large type).
 */
export type SettingHome = "composer" | "header";

export interface SettingRow {
  id: string;
  label: string;
  /** "scrub": arm then move left/right through `values`. "action": arm/tap runs `run`. "toggle": two values. */
  kind: "scrub" | "action" | "toggle";
  values: readonly string[];
  index: number;
  select(index: number): void;
  run?(): void;
  home: SettingHome;
  /** Accessibility hint and Lab legend text. */
  hint?: string;
}

/** Rows every screen shows first, in this order. Values are filled in by the menu. */
export const GLOBAL_ROW_IDS = ["info", "layout"] as const;

/** Rare settings the header menu keeps. Ids are stable for #103's header display menu. */
export const HEADER_ROW_IDS = ["thinking-summaries", "handedness", "large-type"] as const;

export const pageControls = createStore<Record<string, readonly SettingRow[]>>({});
/** The screen whose page rows the composer menu shows (Main's pager reports its tab). */
export const activeScreen = createStore<string>("chats");

export function registerPage(screen: string, rows: readonly SettingRow[]): () => void {
  pageControls.set(prev => ({ ...prev, [screen]: rows }));
  return () => pageControls.set(prev => {
    if (prev[screen] !== rows) return prev;
    const next = { ...prev };
    delete next[screen];
    return next;
  });
}

/** Rows for one menu: global axes first, then the page's own rows for that home. */
export function rowsFor(home: SettingHome, global: readonly SettingRow[], page: readonly SettingRow[] = []): SettingRow[] {
  return [...global, ...page].filter(row => row.home === home);
}

/** Next index for a plain tap on a row: cycles, so every row works without the gesture. */
export function tapIndex(row: Pick<SettingRow, "index" | "values" | "kind">): number {
  if (row.kind === "action") return row.index;
  return (row.index + 1) % Math.max(1, row.values.length);
}

/** Registers a screen's rows; re-registers whenever a row's value changes. */
export function usePageControls(screen: string, rows: readonly SettingRow[]): void {
  const latest = useRef(rows);
  latest.current = rows;
  const signature = rows.map(row => `${row.id}:${row.kind}:${row.home}:${row.label}:${row.hint}:${row.index}:${row.values.join("|")}`).join(",");
  useEffect(() => registerPage(screen, latest.current.map(row => ({
    ...row,
    // A callback may change with selection/session even when its displayed value does not.
    // Keep registered metadata stable, but dispatch to this render's callback by stable ID.
    select: index => latest.current.find(current => current.id === row.id)?.select(index),
    run: row.run ? () => latest.current.find(current => current.id === row.id)?.run?.() : undefined,
  }))), [screen, signature]);
}
