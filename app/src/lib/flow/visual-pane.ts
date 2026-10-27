/** Pure presentation state for the Brainstorm visual pane.
 * A GenUI content value must be consumed by the OpenUI renderer, not displayed
 * as a source/code block. An invalid parse deliberately has no source payload.
 */
export type PaneContent =
  | { readonly kind: "empty" }
  | { readonly kind: "loader"; readonly generation: number }
  | { readonly kind: "genui"; readonly generation: number; readonly status: "loading" | "ready" | "invalid"; readonly source: string }
  | { readonly kind: "artifact"; readonly generation: number; readonly html: string }
  | { readonly kind: "figure"; readonly generation: number; readonly figureId: string };

export interface PaneState {
  readonly generation: number;
  readonly turnEnded: boolean;
  readonly content: PaneContent;
  readonly dimmed: boolean;
  readonly pendingArtifact: { readonly generation: number; readonly html: string } | null;
}

export type PaneEvent =
  | { readonly type: "turn-commit"; readonly generation: number }
  | { readonly type: "gen-bump"; readonly generation: number }
  | { readonly type: "genui"; readonly generation: number; readonly status: "loading" | "ready" | "invalid"; readonly source: string }
  | { readonly type: "artifact-ready"; readonly generation: number; readonly html: string }
  | { readonly type: "turn-end"; readonly generation: number }
  | { readonly type: "figure"; readonly generation: number; readonly figureId: string };

export type PaneTrace = "genui.loader" | "genui.first_node" | "genui.discard";
export interface PaneReduction {
  readonly state: PaneState;
  readonly trace: PaneTrace[];
}

export function createPaneState(): PaneState {
  return { generation: 0, turnEnded: false, content: { kind: "empty" }, dimmed: false, pendingArtifact: null };
}

function unchanged(state: PaneState): PaneReduction {
  return { state, trace: [] };
}

/** A future-generation event implicitly invalidates the old turn's completion. */
function advance(state: PaneState, generation: number): PaneState {
  return {
    generation,
    turnEnded: false,
    content: state.content,
    dimmed: true,
    pendingArtifact: null,
  };
}

export function reducePane(state: PaneState, event: PaneEvent): PaneReduction {
  // Rejected or superseded work can never paint, clear a pending artifact, or
  // reset a newer turn. Guard malformed numeric generations as well.
  if (!Number.isSafeInteger(event.generation) || event.generation < 0 || event.generation < state.generation) {
    return { state, trace: ["genui.discard"] };
  }

  if (event.type === "turn-commit") {
    if (state.generation === event.generation && state.content.kind === "loader" &&
        state.content.generation === event.generation && !state.turnEnded &&
        !state.dimmed && state.pendingArtifact === null) {
      return unchanged(state);
    }
    return {
      state: {
        generation: event.generation,
        turnEnded: false,
        content: { kind: "loader", generation: event.generation },
        dimmed: false,
        pendingArtifact: null,
      },
      trace: ["genui.loader"],
    };
  }

  if (event.type === "gen-bump") {
    if (event.generation === state.generation) return unchanged(state);
    return { state: advance(state, event.generation), trace: [] };
  }

  // Except for an explicit commit, receiving a future generation is an
  // implicit bump. In particular, it must NOT inherit an ended older turn.
  const current = event.generation > state.generation
    ? advance(state, event.generation)
    : state;

  if (event.type === "genui") {
    // Once the turn-end artifact is published, delayed OpenUI chunks cannot
    // replace it. This also prevents duplicate first-node marks.
    if (current.content.kind === "artifact" && current.content.generation === event.generation) {
      return unchanged(state);
    }
    const source = event.status === "invalid" ? "" : event.source;
    if (current.content.kind === "genui" &&
        current.content.generation === event.generation &&
        current.content.status === event.status &&
        current.content.source === source &&
        !current.dimmed) {
      return unchanged(state);
    }
    const first = current.content.kind !== "genui" || current.content.generation !== event.generation;
    return {
      state: {
        ...current,
        content: { kind: "genui", generation: event.generation, status: event.status, source },
        dimmed: false,
      },
      trace: first ? ["genui.first_node"] : [],
    };
  }

  if (event.type === "artifact-ready") {
    if (current.turnEnded) {
      if (current.content.kind === "artifact" &&
          current.content.generation === event.generation &&
          current.content.html === event.html &&
          current.pendingArtifact === null &&
          !current.dimmed) {
        return unchanged(state);
      }
      return {
        state: {
          ...current,
          content: { kind: "artifact", generation: event.generation, html: event.html },
          dimmed: false,
          pendingArtifact: null,
        },
        trace: [],
      };
    }
    if (current.pendingArtifact?.generation === event.generation &&
        current.pendingArtifact.html === event.html) {
      return unchanged(state);
    }
    return {
      state: { ...current, pendingArtifact: { generation: event.generation, html: event.html } },
      trace: [],
    };
  }

  if (event.type === "turn-end") {
    const artifact = current.pendingArtifact;
    if (artifact && artifact.generation === event.generation) {
      return {
        state: {
          ...current,
          turnEnded: true,
          content: { kind: "artifact", generation: event.generation, html: artifact.html },
          dimmed: false,
          pendingArtifact: null,
        },
        trace: [],
      };
    }
    if (current.turnEnded) return unchanged(state);
    return { state: { ...current, turnEnded: true }, trace: [] };
  }

  if (event.type === "figure") {
    // Cached figures can fill the loader, but may never displace a stream
    // already begun or an artifact already published for this generation.
    // Preserving the streaming content also makes first_node one-shot.
    if (current.content.generation === event.generation &&
        (current.content.kind === "genui" || current.content.kind === "artifact")) {
      return unchanged(state);
    }
    if (current.content.kind === "figure" &&
        current.content.generation === event.generation &&
        current.content.figureId === event.figureId && !current.dimmed) {
      return unchanged(state);
    }
    return {
      state: {
        ...current,
        content: { kind: "figure", generation: event.generation, figureId: event.figureId },
        dimmed: false,
      },
      trace: [],
    };
  }

  return unchanged(state);
}
