import { useLayoutEffect, useState } from "react";
import { createStore, type Store } from "../store/createStore";
import type { MapFilter, MapKind, MapNode, MapRelation, OrchestraMap } from "./orchestra-map";
import { defaultView, ORCHESTRA_VIEWS, type OrchestraView } from "./orchestra-views";
import type { SettingRow } from "./settings-registry";

export const ORCHESTRA_LEGEND: readonly (MapKind | MapRelation)[] = ["chat", "subagent", "repo", "host", "delegated", "touched", "hosted", "workspace"];
export interface OrchestraControlState {
  view: OrchestraView;
  chosen: boolean;
  filter: MapFilter | null;
  focusId: string | null;
  focusOnly: boolean;
  /** Every explicit switch, including reselecting a view, restarts the view transition. */
  viewRevision: number;
}
export interface OrchestraController {
  state: Store<OrchestraControlState>;
  syncNodes(nodes: MapNode[]): void;
  switchView(view: OrchestraView): void;
  setFilter(filter: MapFilter | null): void;
  highlight(kind: MapKind | MapRelation): void;
  only(kind: MapKind | MapRelation): void;
  focus(id: string | null): void;
  focusHost(id: string): void;
  scope(only: boolean): void;
  reset(): void;
}
/** The graph and its registered menu dispatch these same actions, never mirrored page state. */
export function createOrchestraController(nodes: MapNode[]): OrchestraController {
  const state = createStore<OrchestraControlState>({ view: defaultView(nodes), chosen: false, filter: null, focusId: null, focusOnly: false, viewRevision: 0 });
  return {
    state,
    syncNodes(nodes) { state.set(s => s.chosen || s.view === defaultView(nodes) ? s : { ...s, view: defaultView(nodes) }); },
    switchView(view) { state.set(s => ({ ...s, view, chosen: true, filter: null, focusId: null, focusOnly: false, viewRevision: s.viewRevision + 1 })); },
    setFilter(filter) { state.set(s => ({ ...s, filter })); },
    highlight(kind) { state.set(s => ({ ...s, filter: s.filter?.kind === kind ? null : { kind, only: false } })); },
    only(kind) { state.set(s => ({ ...s, filter: { kind, only: true }, focusOnly: false })); },
    focus(focusId) { state.set(s => ({ ...s, focusId })); },
    focusHost(focusId) { state.set(s => ({ ...s, focusId, focusOnly: true })); },
    scope(focusOnly) { state.set(s => ({ ...s, focusOnly })); },
    reset() { state.set(s => ({ ...s, filter: null, focusOnly: false, focusId: null })); },
  };
}
export function useOrchestraController(graph: OrchestraMap): OrchestraController {
  const [controller] = useState(() => createOrchestraController(graph.nodes));
  useLayoutEffect(() => controller.syncNodes(graph.nodes), [controller, graph.nodes]);
  return controller;
}

export function orchestraControlRows(controller: OrchestraController, graph: OrchestraMap): SettingRow[] {
  const { view, filter, focusId, focusOnly } = controller.state.get();
  const rows: SettingRow[] = [
    { id: "orchestra-view", label: "View", kind: "scrub", home: "composer", values: ORCHESTRA_VIEWS.map(mode => mode.title), index: ORCHESTRA_VIEWS.findIndex(mode => mode.id === view), select: index => { const mode = ORCHESTRA_VIEWS[index]; if (mode) controller.switchView(mode.id); } },
    { id: "orchestra-focus", label: "Scope", kind: "toggle", home: "composer", values: ["All", "Focus"], index: focusOnly ? 1 : 0, select: index => controller.scope(index === 1), hint: focusId ? "Show selected node and its neighbours" : "Select a node before focusing" },
    { id: "orchestra-filter", label: "Highlight", kind: "scrub", home: "composer", values: ["All", ...ORCHESTRA_LEGEND], index: filter ? ORCHESTRA_LEGEND.indexOf(filter.kind) + 1 : 0, select: index => { const kind = ORCHESTRA_LEGEND[index - 1]; controller.setFilter(kind ? { kind, only: false } : null); } },
    { id: "orchestra-selection", label: "Selection", kind: "scrub", home: "composer", values: ["None", ...graph.nodes.map(node => node.label)], index: graph.nodes.findIndex(node => node.id === focusId) + 1, select: index => controller.focus(graph.nodes[index - 1]?.id ?? null) },
    { id: "orchestra-reset", label: "Reset", kind: "action", home: "composer", values: [], index: 0, select: () => controller.reset(), run: () => controller.reset() },
  ];
  if (filter) rows.splice(3, 0, { id: "orchestra-filter-scope", label: "Filter", kind: "toggle", home: "composer", values: ["Highlight", "Only"], index: filter.only ? 1 : 0, select: index => index === 1 ? controller.only(filter.kind) : controller.setFilter({ kind: filter.kind, only: false }) });
  return rows;
}
