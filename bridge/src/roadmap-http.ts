import { readRoadmap, roadmapFile } from "./roadmap-store";
import { roadmapSections } from "../../shared/roadmap";

/** GET /roadmap: the roadmap document with its minimal-view sections (read-only). */
export function createRoadmapHttpHandler(options: { authorize(request: Request): Promise<boolean>; path?: string }) {
  return async (request: Request): Promise<Response | null> => {
    if (new URL(request.url).pathname !== "/roadmap") return null;
    if (!await options.authorize(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (request.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 });
    try {
      const doc = readRoadmap(options.path ?? roadmapFile());
      const s = roadmapSections(doc);
      return Response.json({ ...doc, sections: { you: s.you.map(i => i.id), running: s.running.map(i => i.id), list: s.list.map(i => i.id) } }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ error: "roadmap unavailable" }, { status: 503 });
    }
  };
}
