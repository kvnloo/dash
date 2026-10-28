// The roadmap's file on the host: the bridge's /roadmap, the orchestrate triage lane, the Tern
// pane and the `dash-roadmap` CLI all read this one file. Writes are atomic (temp file + rename),
// so a watcher never sees half a document.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { emptyRoadmap, parseRoadmap, type RoadmapDocument } from "../../shared/roadmap";

/** `$DASH_ROADMAP_FILE`, else `~/.local/state/dash/roadmap.json`. */
export function roadmapFile(env: Record<string, string | undefined> = process.env): string {
  return env.DASH_ROADMAP_FILE || join(homedir(), ".local/state/dash/roadmap.json");
}

/** The document; empty when the file does not exist yet. Throws on a corrupt file. */
export function readRoadmap(path = roadmapFile()): RoadmapDocument {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return emptyRoadmap();
    throw e;
  }
  const doc = parseRoadmap(JSON.parse(text));
  if (!doc) throw new Error(`${path}: not a valid roadmap document`);
  return doc;
}

export function writeRoadmap(doc: RoadmapDocument, path = roadmapFile()): void {
  if (!parseRoadmap(doc)) throw new Error("refusing to write an invalid roadmap document");
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 1) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

export function updateRoadmap(change: (doc: RoadmapDocument) => RoadmapDocument, path = roadmapFile()): RoadmapDocument {
  const next = change(readRoadmap(path));
  writeRoadmap(next, path);
  return next;
}
