'use dom';

import type { DOMProps } from "expo/dom";
import { useMemo, useState } from "react";
import { Background, Controls, ReactFlow, MarkerType, Position, type Node, type Edge } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import type { Diagram } from "../../lib/mermaid";

/** Expo DOM: browser ReactFlow on web, SDK WebView on Expo Go. No model code enters this document. */
export default function DiagramDOM({ diagram, palette }: { diagram: Diagram; palette: { bg: string; text: string; gold: string; muted: string }; dom?: DOMProps }) {
  const [selected, setSelected] = useState("");
  const { nodes, edges } = useMemo(() => {
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: diagram.direction, nodesep: 32, ranksep: 60 });
    for (const node of diagram.nodes) graph.setNode(node.id, { width: 160, height: 58 });
    for (const edge of diagram.edges) graph.setEdge(edge.source, edge.target);
    dagre.layout(graph);
    const nodes: Node[] = diagram.nodes.map(n => {
      const pos = graph.node(n.id);
      const sourcePosition = diagram.direction === "LR" ? Position.Right : diagram.direction === "RL" ? Position.Left : diagram.direction === "BT" ? Position.Top : Position.Bottom;
      const targetPosition = diagram.direction === "LR" ? Position.Left : diagram.direction === "RL" ? Position.Right : diagram.direction === "BT" ? Position.Bottom : Position.Top;
      return { id: n.id, sourcePosition, targetPosition, position: { x: pos.x - 80, y: pos.y - 29 }, data: { label: n.label }, style: { width: 160, minHeight: 58, background: palette.bg, color: palette.text, border: `1px solid ${palette.gold}`, borderRadius: 10, font: "14px system-ui" } };
    });
    const edges: Edge[] = diagram.edges.map(e => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed, color: palette.gold }, style: { stroke: palette.gold }, labelStyle: { fill: palette.text }, labelBgStyle: { fill: palette.bg } }));
    return { nodes, edges };
  }, [diagram, palette]);
  return <div style={{ height: 350, background: palette.bg, color: palette.text, borderRadius: 14, overflow: "hidden", font: "13px system-ui" }}>
    <div role="application" aria-label="Interactive Mermaid diagram" style={{ height: 300 }}>
      <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: .25 }} minZoom={.15} maxZoom={3} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => { const n = diagram.nodes.find(n => n.id === node.id); setSelected(n ? `${n.label}${n.detail ? ` — ${n.detail}` : ""}` : ""); }} colorMode="dark" preventScrolling={false}>
        <Background color={palette.muted} gap={20} /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
    <div role="status" style={{ padding: "8px 12px", borderTop: `1px solid ${palette.muted}`, height: 50, overflow: "auto" }}>{selected || "Pan · pinch to zoom · tap a node for detail"}</div>
  </div>;
}
