import snapshot from "../../catalog/roadmap.json";
import { RoadmapView } from "../../vendor/ripple/native/RoadmapView";
import type { RoadmapDocument, RoadmapStage } from "../../vendor/ripple/native/roadmap";
function stage(raw: string): RoadmapStage {
  if (raw === "planned" || raw === "partial" || raw === "candidate" || raw === "preview" || raw === "verified") return raw;
  throw new Error("Invalid roadmap stage");
}
const document: RoadmapDocument = { ...snapshot, items: snapshot.items.map(item => ({ ...item, stage: stage(item.stage) })) };
export function RippleRoadmap() { return <RoadmapView document={document} />; }
