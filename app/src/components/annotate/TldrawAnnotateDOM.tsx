"use dom";
// Based on the measured Expo DOM spike; kept mounted while idle to avoid cold opens.
import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { useDOMImperativeHandle, type DOMProps, type DOMImperativeFactory } from "expo/dom";
import { AssetRecordType, Box, DefaultColorStyle, GeoShapeGeoStyle, Tldraw, createShapeId, type Editor, type TLShapeId } from "tldraw";
import "tldraw/tldraw.css";
import { annotationShapeToStroke, isAnnotationShape, type TimedInk } from "../../lib/annotate/tldraw-adapter";
import { appendInkSample, pressureOf } from "../../lib/annotate/pointer";
import type { InkColor, PointerKind, Stroke, Tool } from "../../lib/annotate/strokes";
import { annotationAssetUrls } from "./tldraw-assets";

export interface TldrawAnnotateHandle extends DOMImperativeFactory {
  undo(): void;
  redo(): void;
  clear(...args: Parameters<DOMImperativeFactory[string]>): void;
  retain(...args: Parameters<DOMImperativeFactory[string]>): void;
  export(...args: Parameters<DOMImperativeFactory[string]>): void;
}
interface Props {
  ref?: Ref<TldrawAnnotateHandle>;
  active: boolean;
  bgUri?: string;
  width: number;
  height: number;
  tool: Tool;
  color: InkColor;
  penMode: boolean;
  mode: "screen" | "dex";
  onReady(ms: number): Promise<void>;
  onStylusObserved(): Promise<void>;
  onDrawing(strokes: Stroke[]): Promise<void>;
  onExportDone(uri: string): Promise<void>;
  dom?: DOMProps;
}
const BG = createShapeId("annotation-background");

export default function TldrawAnnotateDOM(props: Props) {
  const latest = useRef(props); latest.current = props;
  const [editor, setEditor] = useState<Editor>();
  const inks = useRef(new Map<TLShapeId, TimedInk>());
  const nextId = useRef(1);
  const capture = useRef<{ pointerId: number; kind: PointerKind; flat: number[]; before: Set<TLShapeId> } | undefined>(undefined);
  const opened = useRef<number | undefined>(undefined);
  const mountedAt = useRef(performance.now());
  const publish = useCallback(() => {
    if (!editor) return;
    const strokes: Stroke[] = [];
    for (const shape of editor.getCurrentPageShapes()) {
      const ink = inks.current.get(shape.id);
      if (!ink || !isAnnotationShape(editor, shape)) continue;
      const stroke = annotationShapeToStroke(editor, shape, ink, latest.current.width, latest.current.height);
      if (stroke) strokes.push(stroke);
    }
    strokes.sort((a, b) => a.id - b.id);
    void latest.current.onDrawing(strokes);
  }, [editor]);

  useDOMImperativeHandle<TldrawAnnotateHandle>(props.ref ?? null, () => ({
    undo() { editor?.undo(); publish(); },
    redo() { editor?.redo(); publish(); },
    retain(...args: Parameters<DOMImperativeFactory[string]>) {
      if (!editor || !Array.isArray(args[0])) return;
      const kept = new Set(args[0].filter(id => typeof id === "number"));
      const removed = editor.getCurrentPageShapes().filter(shape => {
        const ink = inks.current.get(shape.id);
        // Uncommitted ink may still be under the pen while an upload finishes.
        return ink && !kept.has(ink.id);
      }).map(shape => shape.id);
      editor.run(() => editor.deleteShapes(removed), { history: "ignore" });
      editor.clearHistory();
      for (const id of removed) inks.current.delete(id);
      if (kept.size === 0) nextId.current = 1;
      publish();
    },
    clear(...args: Parameters<DOMImperativeFactory[string]>) {
      const reset = args[0] === true;
      if (!editor) return;
      editor.deleteShapes([...editor.getCurrentPageShapeIds()].filter(id => id !== BG));
      if (reset) { editor.clearHistory(); inks.current.clear(); nextId.current = 1; }
      publish();
    },
    export(...args: Parameters<DOMImperativeFactory[string]>) {
      if (!editor) return;
      const bounds = args[0];
      const inkOnly = args[1] !== false;
      const ids = [...editor.getCurrentPageShapeIds()].filter(id => !inkOnly || id !== BG);
      const b = bounds && typeof bounds === "object" && !Array.isArray(bounds) && typeof bounds.x === "number" && typeof bounds.y === "number" && typeof bounds.w === "number" && typeof bounds.h === "number"
        ? { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }
        : { x: 0, y: 0, w: latest.current.width, h: latest.current.height };
      void editor.toImage(ids, { format: "png", background: !inkOnly, bounds: new Box(b.x, b.y, b.w, b.h), padding: 0, pixelRatio: 1 }).then(({ blob }) => {
        const reader = new FileReader();
        reader.onload = () => { if (typeof reader.result === "string") void latest.current.onExportDone(reader.result); };
        reader.readAsDataURL(blob);
      });
    },
  }), [editor, publish]);

  useEffect(() => {
    if (!editor) return;
    editor.setCurrentTool(props.tool === "pen" ? "draw" : props.tool === "highlighter" ? "highlight" : props.tool === "box" || props.tool === "circle" ? "geo" : props.tool);
    editor.setStyleForNextShapes(DefaultColorStyle, props.color === "red" ? "red" : "yellow");
    if (props.tool === "box" || props.tool === "circle") editor.setStyleForNextShapes(GeoShapeGeoStyle, props.tool === "box" ? "rectangle" : "ellipse");
    editor.updateInstanceState({ isPenMode: props.penMode });
  }, [editor, props.tool, props.color, props.penMode]);
  useEffect(() => {
    if (!editor || !props.bgUri) return;
    const assetId = AssetRecordType.createId("annotation-background");
    editor.run(() => {
      editor.createAssets([{ id: assetId, typeName: "asset", type: "image", meta: {}, props: { name: "screen.png", src: props.bgUri ?? null, w: props.width, h: props.height, mimeType: "image/png", isAnimated: false } }]);
      if (editor.getShape(BG)) editor.updateShape({ id: BG, type: "image", props: { assetId, w: props.width, h: props.height } });
      else editor.createShape({ id: BG, type: "image", x: 0, y: 0, isLocked: true, props: { assetId, w: props.width, h: props.height } });
    }, { history: "ignore" });
  }, [editor, props.bgUri, props.width, props.height]);
  useEffect(() => {
    if (!props.active) { opened.current = undefined; return; }
    opened.current ??= performance.now();
    if (!editor) return;
    const frame = requestAnimationFrame(() => {
      const ms = performance.now() - (opened.current ?? performance.now());
      console.info("[annotate-tldraw] ready-to-draw", { ms, coldMs: performance.now() - mountedAt.current });
      void latest.current.onReady(ms);
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, props.active]);
  useEffect(() => editor?.store.listen(() => { if (!capture.current) publish(); }, { scope: "document", source: "user" }), [editor, publish]);

  function sample(event: React.PointerEvent<HTMLDivElement>) {
    const current = capture.current;
    if (!editor || !current || current.pointerId !== event.pointerId) return;
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const e of [...samples, event.nativeEvent]) {
      const page = editor.screenToPage({ x: e.clientX, y: e.clientY });
      current.flat = appendInkSample(current.flat, page.x, page.y, pressureOf(current.kind, e.pressure), Date.now());
    }
  }
  return <div data-testid="annotate-tldraw" data-ready={editor ? "true" : "false"}
    style={{ position: "absolute", inset: 0, visibility: props.active ? "visible" : "hidden", pointerEvents: props.active ? "auto" : "none" }}
    onPointerDownCapture={event => {
      if (props.active && event.pointerType === "pen") void latest.current.onStylusObserved();
      if (!editor || !props.active || event.button !== 0 || (props.penMode && event.pointerType !== "pen")) return;
      const kind = event.pointerType === "pen" ? "stylus" : event.pointerType === "touch" ? "touch" : "mouse";
      capture.current = { pointerId: event.pointerId, kind, flat: [], before: new Set(editor.getCurrentPageShapeIds()) };
      sample(event);
    }} onPointerMoveCapture={sample} onPointerCancelCapture={() => { capture.current = undefined; }}
    onPointerUpCapture={event => {
      sample(event);
      const current = capture.current; capture.current = undefined;
      if (!editor || !current) return;
      // tldraw finalizes its shape in the bubble handler before this frame.
      requestAnimationFrame(() => {
        const shape = editor.getCurrentPageShapes().find(shape => !current.before.has(shape.id) && isAnnotationShape(editor, shape));
        if (!shape || !isAnnotationShape(editor, shape)) { publish(); return; }
        const xs = current.flat.filter((_, index) => index % 4 === 0);
        const ys = current.flat.filter((_, index) => index % 4 === 1);
        if (current.flat.length < 8 || Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < 6) {
          editor.deleteShapes([shape.id]); publish(); return;
        }
        const inverse = editor.getShapePageTransform(shape).clone().invert();
        const points = [];
        for (let i = 0; i < current.flat.length; i += 4) {
          const point = inverse.applyToPoint({ x: current.flat[i] ?? 0, y: current.flat[i + 1] ?? 0 });
          points.push({ x: point.x, y: point.y, p: current.flat[i + 2] ?? 0.5, t: current.flat[i + 3] ?? Date.now() });
        }
        inks.current.set(shape.id, { id: nextId.current++, color: latest.current.color, pointer: current.kind, points, targets: [] });
        publish();
      });
    }}>
    <style>{`.tl-background { background: transparent !important; } .tl-grid { display: none; }`}</style>
    <Tldraw hideUi assetUrls={annotationAssetUrls} onMount={editor => {
      editor.user.updateUserPreferences({ isSnapMode: false, animationSpeed: 0, locale: "en" });
      editor.setCurrentTool("draw"); editor.setCamera({ x: 0, y: 0, z: 1 });
      setEditor(editor);
    }} />
  </div>;
}
