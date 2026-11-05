import type { ComponentType } from "react";
import type { ThinkingPhase } from "./thinking";

/**
 * Typed boundary over @kvnloo/aodl-views (zerOS orchestration views, pinned by SHA in
 * package.json). The package ships TypeScript source written without Dash's
 * noUncheckedIndexedAccess, so Dash loads it with require() (Metro bundles it as usual) and
 * narrows the few exports it uses here instead of type-checking the library's internals.
 */
export type AgentThinkingProps = { phase: ThinkingPhase; tool?: string; size?: 20 | 64; caption?: boolean; testID?: string };
export type AodlGraph = { nodes: unknown[]; edges: unknown[] };
export type GraphViewProps = { graph: AodlGraph; width: number; height?: number; initialLayout?: "spine" | "constellation" | "radial" | "islands"; initialMode?: "focus" | "all"; testID?: string };

type Module = Record<string, unknown>;

function isRecord(value: unknown): value is Module {
  return typeof value === "object" && value !== null;
}

function isComponent<P>(value: unknown): value is ComponentType<P> {
  return typeof value === "function" || (isRecord(value) && "$$typeof" in value);
}

function isGraph(value: unknown): value is AodlGraph {
  return isRecord(value) && Array.isArray(value.nodes) && Array.isArray(value.edges);
}

let loaded: Module | null | undefined;
function aodl(): Module | null {
  if (loaded !== undefined) return loaded;
  try {
    const mod: unknown = require("@kvnloo/aodl-views");
    loaded = isRecord(mod) ? mod : null;
  } catch {
    loaded = null;
  }
  return loaded;
}

export function aodlAgentThinking(): ComponentType<AgentThinkingProps> | null {
  const value = aodl()?.AgentThinking;
  return isComponent<AgentThinkingProps>(value) ? value : null;
}

export function aodlGraphView(): ComponentType<GraphViewProps> | null {
  const value = aodl()?.GraphView;
  return isComponent<GraphViewProps>(value) ? value : null;
}

/** aodl-views' own Dash roster adapter: hosts -> chats graph. */
export function aodlGraphFromRoster(hosts: unknown): AodlGraph | null {
  const fn = aodl()?.fromDashRoster;
  if (typeof fn !== "function") return null;
  const graph: unknown = fn(hosts);
  return isGraph(graph) ? graph : null;
}
