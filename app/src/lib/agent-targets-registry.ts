// Registry half of agent-targets(.web).ts, platform-neutral so both variants share one map.
// Where an agent's pointer may land (docs/specs/ui-control.md). React Native cannot look a view up by
// testID, so native screens register the elements an agent may point at; web (agent-targets.web.ts)
// also resolves any rendered data-testid. Unknown or offscreen targets resolve to null: never guessed.
export interface TargetRect { x: number; y: number; width: number; height: number }

interface Measurable {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
}

const registry = new Map<string, Measurable>();
const refs = new Map<string, (view: Measurable | null) => void>();

/** Stable ref callback for `ref={agentTarget("chat-annotate")}`; the newest mounted view wins. */
export function agentTarget(testID: string): (view: Measurable | null) => void {
  let ref = refs.get(testID);
  if (!ref) {
    let mine: Measurable | null = null;
    ref = view => {
      if (view) { mine = view; registry.set(testID, view); }
      else if (registry.get(testID) === mine) { registry.delete(testID); mine = null; }
    };
    refs.set(testID, ref);
  }
  return ref;
}

export function onScreen(rect: TargetRect, window: { width: number; height: number }): boolean {
  return rect.width > 0 && rect.height > 0 && rect.x + rect.width > 0 && rect.y + rect.height > 0 && rect.x < window.width && rect.y < window.height;
}

export function measureRegistered(testID: string, window: { width: number; height: number }): Promise<TargetRect | null> {
  const view = registry.get(testID);
  if (!view) return Promise.resolve(null);
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 250);
    try {
      view.measureInWindow((x, y, width, height) => {
        clearTimeout(timer);
        const rect = { x, y, width, height };
        resolve([x, y, width, height].every(Number.isFinite) && onScreen(rect, window) ? rect : null);
      });
    } catch { clearTimeout(timer); resolve(null); }
  });
}
