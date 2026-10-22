/** Native has no cheap view-at-point lookup from JS; strokes carry the route instead. */
export function targetsAt(_points: readonly { x: number; y: number }[]): string[] {
  return [];
}
