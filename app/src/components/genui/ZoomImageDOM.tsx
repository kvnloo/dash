'use dom';
import type { DOMProps } from "expo/dom";
import { useRef, useState } from "react";

export default function ZoomImageDOM({ uri, label }: { uri: string; label: string; dom?: DOMProps }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const points = useRef(new Map<number, { x: number; y: number }>());
  const previous = useRef({ x: 0, y: 0, distance: 0 });
  const bounded = (n: number) => Math.max(1, Math.min(6, n));
  const button = { minWidth: 44, minHeight: 44, background: "#151611", color: "#d7b986", border: "1px solid #837f74", borderRadius: 8, padding: "0 14px" };
  return <div style={{ height: "100vh", background: "#0c0c0a", overflow: "hidden", touchAction: "none", position: "relative" }}
    onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); points.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); previous.current = { x: e.clientX, y: e.clientY, distance: 0 }; }}
    onPointerUp={e => { points.current.delete(e.pointerId); previous.current.distance = 0; }}
    onPointerCancel={e => { points.current.delete(e.pointerId); previous.current.distance = 0; }}
    onPointerMove={e => {
      if (!points.current.has(e.pointerId)) return;
      points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...points.current.values()];
      if (a && b) {
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (previous.current.distance) { const ratio = distance / previous.current.distance; setView(v => ({ ...v, scale: bounded(v.scale * ratio) })); }
        previous.current.distance = distance;
      } else { const dx = e.clientX - previous.current.x; const dy = e.clientY - previous.current.y; setView(v => ({ ...v, x: v.x + dx, y: v.y + dy })); }
      previous.current.x = e.clientX; previous.current.y = e.clientY;
    }}
    onWheel={e => setView(v => ({ ...v, scale: bounded(v.scale * (e.deltaY < 0 ? 1.15 : .85)) }))}>
    <img src={uri} alt={label} draggable={false} style={{ width: "100%", height: "85%", objectFit: "contain", transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`, pointerEvents: "none" }} />
    <div style={{ position: "absolute", bottom: 80, left: 12, display: "flex", gap: 12 }}>
      <button aria-label="Zoom image in" onClick={() => setView(v => ({ ...v, scale: bounded(v.scale + .5) }))} style={button}>+</button>
      <button aria-label="Reset image zoom" onClick={() => setView({ scale: 1, x: 0, y: 0 })} style={button}>{view.scale.toFixed(1)}× · Reset</button>
    </div>
  </div>;
}
