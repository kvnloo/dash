/**
 * Labels of the controls under a stroke (screen points). Cheap: three probes,
 * nearest ancestor with an accessible name or test id, overlay excluded.
 */
export function targetsAt(points: readonly { x: number; y: number }[]): string[] {
  const doc = globalThis.document;
  if (!doc || points.length === 0) return [];
  const probes = [points[0], points[Math.floor(points.length / 2)], points.at(-1)];
  const out: string[] = [];
  for (const p of probes) {
    if (!p) continue;
    for (const el of doc.elementsFromPoint(p.x, p.y)) {
      if (el.closest('[data-testid="annotation-overlay"]')) continue;
      const owner = el.closest("[data-testid],[aria-label]");
      const label = owner?.getAttribute("data-testid") ?? owner?.getAttribute("aria-label");
      if (label && !out.includes(label)) out.push(label.slice(0, 60));
      if (label) break;
    }
  }
  return out.slice(0, 4);
}
