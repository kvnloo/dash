// Skia half of annotation mode, loaded lazily (on web CanvasKit must load first).
// Live ink is a derived Skia path fed by a UI-thread shared value: no JS per point.
import { Canvas, Path } from "@shopify/react-native-skia";
import { memo } from "react";

import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { meanPressure, strokeOutline, strokeWidth, type DrawTool, type InkColor, type Stroke, type Tool } from "../../lib/annotate/strokes";
import { outlinePath, strokePath } from "./composite";

export { composite } from "./composite";

export interface InkCanvasProps {
  strokes: readonly Stroke[];
  width: number;
  height: number;
  ink: Record<InkColor, string>;
  /** Flat [x, y, pressure, t, …] in screen points for the stroke being drawn. */
  live: SharedValue<number[]>;
  tool: Tool;
  color: InkColor;
}

const Committed = memo(function Committed({ stroke, width, height, ink }: { stroke: Stroke; width: number; height: number; ink: Record<InkColor, string> }) {
  return <Path path={strokePath(stroke, width, height)} style="stroke" strokeWidth={strokeWidth(stroke.tool, meanPressure(stroke.points))} strokeCap="round" strokeJoin="round" color={ink[stroke.color]} opacity={stroke.tool === "highlighter" ? 0.35 : 1} />;
});

export function InkCanvas({ strokes, width, height, ink, live, tool, color }: InkCanvasProps): React.JSX.Element {
  const drawTool: DrawTool = tool === "eraser" ? "pen" : tool;
  const path = useDerivedValue(() => {
    const flat = live.value;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i + 3 < flat.length; i += 4) { xs.push(flat[i] ?? 0); ys.push(flat[i + 1] ?? 0); }
    return outlinePath(strokeOutline(drawTool, xs, ys));
  });
  const width2 = useDerivedValue(() => {
    const flat = live.value;
    return tool === "eraser" ? 24 : strokeWidth(drawTool, flat.length >= 4 ? flat[flat.length - 2] ?? 0.5 : 0.5);
  });
  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      {strokes.map(stroke => <Committed key={stroke.id} stroke={stroke} width={width} height={height} ink={ink} />)}
      <Path path={path} style="stroke" strokeWidth={width2} strokeCap="round" strokeJoin="round" color={tool === "eraser" ? "#ffffff" : ink[color]} opacity={tool === "eraser" ? 0.25 : tool === "highlighter" ? 0.35 : 1} />
    </Canvas>
  );
}
