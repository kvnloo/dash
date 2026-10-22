// Turn a drawing into one chat message: text with stroke markers, a strokes JSON
// document, and the names the two uploads get on the host.
import { annotateTranscript, marker, segmentFor, type Segment } from "./align";
import type { Stroke } from "./strokes";

export const ANNOTATION_SCHEMA = "dash.annotation.v1";

export interface ScreenInfo {
  /** Stable screen id, e.g. the route key. */
  id: string;
  route: string;
  width: number;
  height: number;
}

export interface AnnotationDoc {
  schema: typeof ANNOTATION_SCHEMA;
  createdAt: number;
  screen: ScreenInfo;
  strokes: {
    id: number;
    tool: Stroke["tool"];
    color: Stroke["color"];
    pointer: Stroke["pointer"];
    startedAt: number;
    endedAt: number;
    targets: string[];
    segment?: string;
    /** [x, y, pressure, ms since startedAt], x/y normalized to the screen. */
    points: [number, number, number, number][];
  }[];
  transcript: { text: string; segments: Segment[] };
}

const round = (n: number, places = 4) => Math.round(n * 10 ** places) / 10 ** places;

export function annotationDoc(input: { strokes: readonly Stroke[]; segments: readonly Segment[]; screen: ScreenInfo; createdAt: number }): AnnotationDoc {
  const { text } = annotateTranscript(input.strokes, input.segments);
  return {
    schema: ANNOTATION_SCHEMA,
    createdAt: input.createdAt,
    screen: input.screen,
    strokes: input.strokes.map(s => ({
      id: s.id,
      tool: s.tool,
      color: s.color,
      pointer: s.pointer,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      targets: s.targets ?? [],
      ...(segmentFor(s, input.segments) ? { segment: segmentFor(s, input.segments)?.id } : {}),
      points: s.points.map(p => [round(p.x), round(p.y), round(p.p, 2), p.t - s.startedAt]),
    })),
    transcript: { text, segments: [...input.segments] },
  };
}

export function attachmentNames(createdAt: number): { image: string; json: string } {
  const stamp = new Date(createdAt).toISOString().replace(/[:.]/g, "-");
  return { image: `annotation-${stamp}.png`, json: `annotation-${stamp}.json` };
}

/** Center of a stroke as whole percentages of the screen. */
export function strokeCenter(points: readonly { x: number; y: number }[]): [number, number] {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return [Math.round(cx * 100), Math.round(cy * 100)];
}

/** One line per stroke so the agent can map markers to what was drawn and where. */
export function strokeLegend(strokes: readonly Stroke[]): string {
  return strokes.map(s => {
    const [x, y] = strokeCenter(s.points);
    const red = s.color === "red" ? " (red)" : "";
    const on = s.targets?.length ? " on " + s.targets.join(", ") : "";
    return marker(s.id) + " " + s.tool + red + " at " + x + "%," + y + "%" + on;
  }).join("\n");
}

/** The message text. The screenshot and JSON travel as attachments. */
export function composeMessage(input: { strokes: readonly Stroke[]; segments: readonly Segment[]; screen: ScreenInfo; typed?: string }): string {
  const { text, unspoken } = annotateTranscript(input.strokes, input.segments);
  const said = [input.typed?.trim(), text].filter(Boolean).join("\n");
  const count = input.strokes.length;
  const plural = count === 1 ? "" : "s";
  const head = "Annotated " + input.screen.route + " (" + count + " stroke" + plural + "). Screenshot with the marks and the strokes JSON are attached.";
  const silent = unspoken.length > 0 ? "\nAlso marked without speaking: " + unspoken.map(marker).join(" ") : "";
  const body = said ? said + silent : "";
  const legend = count > 0 ? strokeLegend(input.strokes) : "";
  return [head, body, legend].filter(Boolean).join("\n\n");
}

/** Mid-turn Hermes sessions take the annotation as a steer; otherwise it is a normal send. */
export function annotationSendMode(steerable: boolean): "steer" | "queue" {
  return steerable ? "steer" : "queue";
}
