import { createContext, useContext, useLayoutEffect, useMemo } from "react";
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
const owners = new Map<string, symbol>();

export function registerPage(screen: string, rows: readonly SettingRow[]): () => void {
  const owner = Symbol(screen);
  owners.set(screen, owner);
  pageControls.set(prev => ({ ...prev, [screen]: rows }));
  return () => pageControls.set(prev => {
    if (owners.get(screen) !== owner) return prev;
    owners.delete(screen);
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

export interface PageControlsFocus {
  routeFocused: boolean;
  activeMainPage: string | null;
}
const unfocused: PageControlsFocus = { routeFocused: false, activeMainPage: null };
const FocusContext = createContext<PageControlsFocus>(unfocused);
/** Host adapter: supply navigation focus AND Main's selected pager page. Default is inert. */
export const PageControlsFocusProvider = FocusContext.Provider;
export function pageIsFocused(screen: string, focus: PageControlsFocus): boolean {
  return focus.routeFocused && focus.activeMainPage === screen;
}
const emptyRows: readonly SettingRow[] = [];
export function pageRowsFor(screen: string, focus: PageControlsFocus, state = pageControls.get()): readonly SettingRow[] {
  return pageIsFocused(screen, focus) ? state[screen] ?? emptyRows : emptyRows;
}
/** Canonical host selector; even a still-mounted blurred host sees no page controls. */
export function usePageRows(screen: string): readonly SettingRow[] {
  const focus = useContext(FocusContext);
  return pageControls.use(state => pageRowsFor(screen, focus, state));
}

/** Commit-time lifecycle shared by the React hook and behavioral tests. */
export function createPageControlsBinding(screen: string) {
  let latest: readonly SettingRow[] = emptyRows;
  let published: readonly SettingRow[] | undefined;
  let signature: string | undefined;
  let cleanup: (() => void) | undefined;
  function dispose() {
    latest = emptyRows;
    published = undefined;
    signature = undefined;
    cleanup?.();
    cleanup = undefined;
  }
  return {
    dispose,
    update(rows: readonly SettingRow[], focus: PageControlsFocus) {
      if (!pageIsFocused(screen, focus)) { dispose(); return; }
      latest = rows;
      // JSON avoids collisions between labels/values containing delimiters.
      const nextSignature = JSON.stringify(rows.map(({ select, run, ...metadata }) => [metadata, Boolean(run)]));
      if (signature === nextSignature && published && pageControls.get()[screen] === published) return;
      cleanup?.();
      signature = nextSignature;
      const registered = rows.map(row => ({
        ...row,
        // Resolve at dispatch, not registration. A retained blurred/replaced row is inert.
        select: (index: number) => {
          if (published === registered && pageControls.get()[screen] === registered)
            latest.find(current => current.id === row.id)?.select(index);
        },
        run: row.run ? () => {
          if (published === registered && pageControls.get()[screen] === registered)
            latest.find(current => current.id === row.id)?.run?.();
        } : undefined,
      }));
      published = registered;
      cleanup = registerPage(screen, registered);
    },
  };
}

/** Register only after a committed focus change; layout cleanup removes rows on blur before paint. */
export function usePageControls(screen: string, rows: readonly SettingRow[]): void {
  const focus = useContext(FocusContext);
  const binding = useMemo(() => createPageControlsBinding(screen), [screen]);
  useLayoutEffect(() => binding.update(rows, focus));
  useLayoutEffect(() => () => binding.dispose(), [binding]);
}
