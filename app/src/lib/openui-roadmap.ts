import { createLibrary, createStreamingParser, defineComponent } from "@openuidev/lang-core";
import { z } from "zod";
// Parse a bounded presentation handle only. No generated data, JS, queries, mutations or actions.
const component = defineComponent({ name: "Roadmap", props: z.object({ handle: z.string() }), description: "Receipt-backed ephemeral roadmap from the host's approved local registry.", component: null });
const library = createLibrary({ components: [component], root: "Roadmap" });
const schema = library.toJSONSchema();
export function parseRoadmapLang(source: string, complete: boolean): "ready" | "loading" | "invalid" {
  if (source.length > 512) return "invalid";
  const result = createStreamingParser(schema, "Roadmap").set(source, complete);
  if (!complete) return "loading";
  // Strict single static statement: parser recovery never grants publication.
  if (!/^\s*root\s*=\s*Roadmap\(\s*"dash-roadmap"\s*\)\s*;?\s*$/.test(source)) return "invalid";
  if (!result.root || result.root.typeName !== "Roadmap" || result.root.partial || result.meta.incomplete || result.meta.errors.length || result.meta.unresolved.length || result.meta.orphaned.length || result.meta.statementCount !== 1 || result.queryStatements.length || result.mutationStatements.length || Object.keys(result.stateDeclarations).length || result.root.props.handle !== "dash-roadmap") return "invalid";
  return "ready";
}
