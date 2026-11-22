import { record } from "./context";
import { parseCouncilRun, type CouncilRun } from "./council-run";

export const councilId = (id: unknown): id is string => typeof id === "string" && /^council-[a-f0-9]{32}$/.test(id);
const passageKey = (key: unknown): key is string => typeof key === "string" && /^(brief|verdict|report:[a-z0-9-]{1,24}|seat:[a-z0-9][a-z0-9._-]{0,39})$/.test(key);
const client = (id: unknown) => typeof id === "string" && /^[a-z0-9][a-z0-9._-]{0,31}$/.test(id);
const integer = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
const text = (s: unknown, max: number): s is string => typeof s === "string" && s.trim().length > 0 && [...s].length <= max;
const utc = (s: unknown) => typeof s === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(s) && Number.isFinite(Date.parse(s));
export const councilRevision = (n: unknown): n is number => integer(n, 1, Number.MAX_SAFE_INTEGER);

export interface CouncilPosition {
  elapsed_ms: number;
  passage: string | null;
  sentence: number;
  read_aloud: boolean;
  muted: boolean;
}

export interface CouncilSession {
  council_id: string;
  stored_session_id: string | null;
  revision: number;
  live: boolean;
  from: string;
  run: CouncilRun;
  passages: { key: string; label: string; text: string; seat: string | null }[];
  position: CouncilPosition;
}

export function parseCouncilPosition(raw: unknown): CouncilPosition | undefined {
  if (!record(raw)) return;
  const { elapsed_ms, passage, sentence, read_aloud, muted } = raw;
  if (!integer(elapsed_ms, 0, 86_400_000) || !(passage === null || passageKey(passage)) ||
    !integer(sentence, 0, 999) || typeof read_aloud !== "boolean" || typeof muted !== "boolean") return;
  return { elapsed_ms, passage, sentence, read_aloud, muted };
}

export function parseCouncilSession(raw: unknown): CouncilSession | undefined {
  if (!record(raw) || raw.schema !== "glide.council-session/v1") return;
  const { council_id, stored_session_id, revision, created_at, updated_at, started_by, updated_by, live, from } = raw;
  if (!councilId(council_id) || !(stored_session_id === null || text(stored_session_id, 200)) ||
    !councilRevision(revision) || !utc(created_at) || !utc(updated_at) || !client(started_by) || !client(updated_by) ||
    typeof live !== "boolean" || !text(from, 200) || !record(raw.run) || raw.run.schema !== "glide.council-run/v1" ||
    new TextEncoder().encode(JSON.stringify(raw.run)).length > 65_536 ||
    !Array.isArray(raw.passages) || raw.passages.length < 1 || raw.passages.length > 16) return;
  const run = parseCouncilRun(raw.run);
  if ("error" in run) return;
  const passages: CouncilSession["passages"] = [];
  for (const value of raw.passages) {
    const p: unknown = value;
    if (!record(p)) return;
    const { key, label, text: body, seat } = p;
    if (!passageKey(key) || !text(label, 40) || !text(body, 4000) ||
      !(seat === null || (typeof seat === "string" && run.seats.some(s => s.id === seat))) ||
      passages.some(previous => previous.key === key)) return;
    passages.push({ key, label, text: body, seat });
  }
  const position = parseCouncilPosition(raw.position);
  if (passages[0]?.key !== "brief" || !position ||
    (position.passage !== null && !passages.some(p => p.key === position.passage))) return;
  return { council_id, stored_session_id, revision, live, from, run, passages, position };
}

export function parseCouncilList(raw: unknown): { id: string; brief: string; live: boolean }[] | undefined {
  if (!record(raw) || !Array.isArray(raw.councils) || raw.councils.length > 64) return;
  const councils: NonNullable<ReturnType<typeof parseCouncilList>> = [];
  for (const value of raw.councils) {
    const row: unknown = value;
    if (!record(row) || !councilId(row.council_id) || !text(row.brief, 65_536) || typeof row.live !== "boolean") return;
    councils.push({ id: row.council_id, brief: row.brief, live: row.live });
  }
  return councils;
}
