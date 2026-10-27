import type { Editor, TLArrowShape, TLDrawShape, TLGeoShape, TLHighlightShape, TLShape } from "tldraw";
import type { InkColor, PointerKind, Stroke, StrokePoint } from "./strokes";

export interface TimedInk {
  id: number;
  color: InkColor;
  pointer: PointerKind;
  /** Shape-local samples: camera zoom/pan never changes capture coordinates. */
  points: StrokePoint[];
  targets: string[];
}
export type AnnotationShape = TLDrawShape | TLHighlightShape | TLArrowShape | TLGeoShape;
export function isAnnotationShape(editor: Editor, shape: TLShape): shape is AnnotationShape {
  return editor.isShapeOfType<TLDrawShape>(shape, "draw") || editor.isShapeOfType<TLHighlightShape>(shape, "highlight") ||
    editor.isShapeOfType<TLArrowShape>(shape, "arrow") ||
    (editor.isShapeOfType<TLGeoShape>(shape, "geo") && ["rectangle", "ellipse"].includes(shape.props.geo));
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Keep the agent contract independent of tldraw records, compressed paths and camera. */
export function annotationShapeToStroke(editor: Editor, shape: AnnotationShape, ink: TimedInk, width: number, height: number): Stroke | null {
  if (width <= 0 || height <= 0) return null;
  const first = ink.points[0], last = ink.points.at(-1);
  if (!first || !last || ink.points.length < 2) return null;
  const transform = editor.getShapePageTransform(shape);
  let local = ink.points;
  if (shape.type === "arrow") local = [{ ...first, ...shape.props.start }, { ...last, ...shape.props.end }];
  if (shape.type === "geo") local = [{ ...first, x: 0, y: 0 }, { ...last, x: shape.props.w, y: shape.props.h }];
  const points = local.map(point => {
    const page = transform.applyToPoint(point);
    return { x: clamp(page.x / width), y: clamp(page.y / height), p: point.p, t: point.t };
  });
  const tool = shape.type === "draw" ? "pen" : shape.type === "highlight" ? "highlighter" : shape.type === "arrow" ? "arrow" : shape.props.geo === "ellipse" ? "circle" : "box";
  return { id: ink.id, tool, color: ink.color, pointer: ink.pointer, points, startedAt: first.t, endedAt: last.t, targets: ink.targets };
}
