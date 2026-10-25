export interface PenModeState { active: boolean; buttonDown: boolean }
/** A side-button rising edge toggles; contact, release and repeats never do. */
export function penButton(state: PenModeState, pressed: boolean): PenModeState {
  return { active: pressed && !state.buttonDown ? !state.active : state.active, buttonDown: pressed };
}
export function quoteSelection(draft: string, text: string): string {
  const quoted = text.trim().split("\n").map(line => `> ${line}`).join("\n");
  return text.trim() ? `${draft}${draft.trim() ? "\n\n" : ""}${quoted}\n\n` : draft;
}
export interface InkRegion { x: number; y: number; width: number; height: number }
/** Screen-space closed loop; reject scribbles/lines and tiny pen jitter. */
export function circleRegion(points: readonly { x: number; y: number }[]): InkRegion | null {
  if (points.length < 8) return null;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys), width = Math.max(...xs)-x, height = Math.max(...ys)-y;
  if (width < 24 || height < 16) return null;
  const first = points[0]!, last = points[points.length-1]!;
  if (Math.hypot(last.x-first.x, last.y-first.y) > Math.min(width, height)*0.4) return null;
  let area = 0;
  for (let i=0; i<points.length; i++) { const a=points[i]!, b=points[(i+1)%points.length]!; area += a.x*b.y-b.x*a.y; }
  return Math.abs(area)/2 > width*height*0.45 ? { x, y, width, height } : null;
}

/** Reserve capacity without changing composer layout while the screenshot is being taken. */
export class CircleSlots {
  private pending = new Map<string, number>();
  constructor(private limit: number) {}
  reserve(id: string, visible: number): (() => void) | null {
    const count = this.pending.get(id) ?? 0;
    if (visible + count >= this.limit) return null;
    this.pending.set(id, count + 1);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const next = (this.pending.get(id) ?? 1) - 1;
      if (next) this.pending.set(id, next); else this.pending.delete(id);
    };
  }
}
