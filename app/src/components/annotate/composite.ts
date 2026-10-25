// Screenshot of the app under the overlay, with the strokes painted on top by
// Skia so the result is identical on Android and web.
import { Skia, StrokeCap, StrokeJoin, PaintStyle, type SkCanvas, type SkPath } from "@shopify/react-native-skia";
import type { RefObject } from "react";
import type { View } from "react-native";
import { captureRef } from "react-native-view-shot";
import { meanPressure, strokeOutline, strokeWidth, type InkColor, type Stroke } from "../../lib/annotate/strokes";

export function outlinePath(lines: readonly (readonly number[])[]): SkPath {
  "worklet";
  const path = Skia.Path.Make();
  for (const line of lines) {
    if (line.length < 2) continue;
    path.moveTo(line[0] ?? 0, line[1] ?? 0);
    if (line.length === 2) path.lineTo((line[0] ?? 0) + 0.01, line[1] ?? 0);
    for (let i = 2; i < line.length; i += 2) path.lineTo(line[i] ?? 0, line[i + 1] ?? 0);
  }
  return path;
}

/** A committed stroke as a Skia path in a w×h pixel space. */
export function strokePath(stroke: Stroke, w: number, h: number): SkPath {
  return outlinePath(strokeOutline(stroke.tool, stroke.points.map(p => p.x * w), stroke.points.map(p => p.y * h)));
}

export function drawStrokes(canvas: SkCanvas, strokes: readonly Stroke[], w: number, h: number, scale: number, ink: Record<InkColor, string>): void {
  for (const stroke of strokes) {
    const paint = Skia.Paint();
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeCap(StrokeCap.Round);
    paint.setStrokeJoin(StrokeJoin.Round);
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(ink[stroke.color]));
    paint.setStrokeWidth(strokeWidth(stroke.tool, meanPressure(stroke.points)) * scale);
    if (stroke.tool === "highlighter") paint.setAlphaf(0.35);
    canvas.drawPath(strokePath(stroke, w, h), paint);
  }
}

/** PNG bytes of `target` with the strokes composited, plus a data URI for preview. */
export async function composite(target: RefObject<View | null>, strokes: readonly Stroke[], screen: { width: number; height: number }, ink: Record<InkColor, string>, background: string, region?: { x: number; y: number; width: number; height: number }): Promise<{ bytes: Uint8Array; dataUri: string }> {
  const base64 = await captureRef(target, { format: "png", result: "base64" });
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(base64.replace(/^data:image\/\w+;base64,/, "")));
  const w = image?.width() ?? Math.round(screen.width);
  const h = image?.height() ?? Math.round(screen.height);
  const surface = Skia.Surface.Make(w, h);
  if (!surface) throw new Error("Could not allocate the annotation image.");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color(background));
  if (image) canvas.drawImage(image, 0, 0);
  drawStrokes(canvas, strokes, w, h, w / screen.width, ink);
  surface.flush();
  const scaleX = w / screen.width, scaleY = h / screen.height;
  const snapshot = region ? surface.makeImageSnapshot({ x: Math.max(0, Math.floor(region.x * scaleX)), y: Math.max(0, Math.floor(region.y * scaleY)), width: Math.max(1, Math.min(w - Math.max(0, Math.floor(region.x * scaleX)), Math.ceil(region.width * scaleX))), height: Math.max(1, Math.min(h - Math.max(0, Math.floor(region.y * scaleY)), Math.ceil(region.height * scaleY))) }) : surface.makeImageSnapshot();
  const bytes = snapshot.encodeToBytes();
  return { bytes, dataUri: `data:image/png;base64,${snapshot.encodeToBase64()}` };
}
