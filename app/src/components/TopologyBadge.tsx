/** Silhouettes from pinned encodings/topology-graphs.json. Topology is declared, never inferred. */
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import {
  loadVisualCatalog,
  resolveProvider,
  resolveTopology,
  type TopologyGraph,
} from "../catalog/visual";

const VIEW_W = 72;
const VIEW_H = 44;

export function TopologyBadge({
  topologyId,
  providerId = "unknown",
  width = 144,
}: {
  topologyId: string;
  providerId?: string;
  width?: number;
}) {
  const catalog = loadVisualCatalog();
  const topology = resolveTopology(catalog, topologyId);
  const graph = catalog.graph(topology.pattern);
  const provider = resolveProvider(catalog, providerId);
  const scale = width / VIEW_W;
  const height = VIEW_H * scale;
  const edgeColor = `${provider.hue}99`;
  const envelope = useMemo(() => envelopeCircles(graph, scale, edgeColor), [graph, scale, edgeColor]);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`${topology.label} topology`}
      style={[styles.frame, { width, height }]}
    >
      {envelope}
      {graph.edges.map(([from, to], index) => {
        const a = graph.nodes[from];
        const b = graph.nodes[to];
        if (!a || !b) return null;
        return (
          <Edge
            key={`${from}-${to}-${index}`}
            x1={a[0] * scale}
            y1={a[1] * scale}
            x2={b[0] * scale}
            y2={b[1] * scale}
            color={edgeColor}
            soft={graph.soft}
          />
        );
      })}
      {graph.center === "blackboard" ? (
        <View
          style={[
            styles.board,
            {
              left: 27 * scale,
              top: 14 * scale,
              width: 18 * scale,
              height: 16 * scale,
              borderRadius: 2 * scale,
              borderColor: edgeColor,
            },
          ]}
        />
      ) : null}
      {graph.center === "marketplace" ? (
        <View
          style={[
            styles.market,
            {
              left: 28 * scale,
              top: 14 * scale,
              width: 16 * scale,
              height: 16 * scale,
              borderColor: edgeColor,
              transform: [{ rotate: "45deg" }],
            },
          ]}
        />
      ) : null}
      {graph.center === "unknown" ? (
        <View
          style={[
            styles.unknown,
            {
              left: 28 * scale,
              top: 10 * scale,
              width: 16 * scale,
              height: 24 * scale,
              borderColor: provider.hue,
            },
          ]}
        />
      ) : null}
      {graph.nodes.map(([x, y, radius], index) => (
        <View
          key={`${x}-${y}-${index}`}
          style={{
            position: "absolute",
            left: x * scale - radius * scale,
            top: y * scale - radius * scale,
            width: radius * 2 * scale,
            height: radius * 2 * scale,
            borderRadius: radius * scale,
            backgroundColor: provider.hue,
          }}
        />
      ))}
    </View>
  );
}

function envelopeCircles(graph: TopologyGraph, scale: number, color: string) {
  if (graph.envelope === "council") return <Ring cx={36} cy={22} r={18} scale={scale} color={color} />;
  if (graph.envelope === "supervisor") return <Ring cx={36} cy={22} r={19} scale={scale} color={color} />;
  if (graph.envelope === "marketplace") return <Ring cx={36} cy={22} r={18} scale={scale} color={color} dashed />;
  if (graph.envelope === "cluster") {
    return (
      <>
        <Ring cx={16} cy={16} r={12} scale={scale} color={color} />
        <Ring cx={50} cy={15} r={12} scale={scale} color={color} />
        <Ring cx={34} cy={34} r={11} scale={scale} color={color} />
      </>
    );
  }
  return null;
}

function Ring({
  cx,
  cy,
  r,
  scale,
  color,
  dashed,
}: {
  cx: number;
  cy: number;
  r: number;
  scale: number;
  color: string;
  dashed?: boolean;
}) {
  const size = r * 2 * scale;
  return (
    <View
      style={{
        position: "absolute",
        left: cx * scale - r * scale,
        top: cy * scale - r * scale,
        width: size,
        height: size,
        borderRadius: r * scale,
        borderWidth: dashed ? 1 : StyleSheet.hairlineWidth,
        borderColor: color,
        borderStyle: dashed ? "dashed" : "solid",
        opacity: 0.45,
      }}
    />
  );
}

function Edge({
  x1,
  y1,
  x2,
  y2,
  color,
  soft,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  soft: boolean;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <View
      style={{
        position: "absolute",
        left: (x1 + x2) / 2 - length / 2,
        top: (y1 + y2) / 2 - 0.5,
        width: length,
        height: StyleSheet.hairlineWidth,
        backgroundColor: color,
        opacity: soft ? 0.35 : 0.7,
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

export function OrchestraCore({
  hue,
  size = 36,
}: {
  hue: string;
  size?: number;
}) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }} accessibilityRole="image">
      <View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: hue,
          opacity: 0.35,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.7,
          height: size * 0.7,
          borderRadius: size / 2,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: hue,
          opacity: 0.7,
        }}
      />
      <View
        style={{
          width: size * 0.28,
          height: size * 0.28,
          borderRadius: size / 2,
          backgroundColor: hue,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: "relative" },
  board: { position: "absolute", borderWidth: StyleSheet.hairlineWidth, backgroundColor: "transparent" },
  market: { position: "absolute", borderWidth: StyleSheet.hairlineWidth, backgroundColor: "transparent" },
  unknown: { position: "absolute", borderWidth: StyleSheet.hairlineWidth, backgroundColor: "transparent", opacity: 0.7 },
});
