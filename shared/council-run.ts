/**
 * A council run snapshot (DA-075): one brief sent to several agent seats, what each seat reported
 * back, and the outcome. Same payload as Glide's `glide.council-run/v1`, so one recorder serves both
 * apps. Dependency-free; the bridge reads it from disk and the app validates it again. This module
 * only parses: it never computes a verdict or invents a reply.
 */

export const COUNCIL_SCHEMAS = ["glide.council-run/v1", "dash.council-run/v1"] as const;
export type CouncilStance = "agree" | "dissent" | "abstain";
export interface CouncilSeat { readonly id: string; readonly name: string; readonly family: string }
export type CouncilEvent =
  | { readonly type: "turn"; readonly seat: number; readonly round: number; readonly cites: readonly number[] }
  | { readonly type: "spawn"; readonly seat: number };
export interface CouncilVerdict { readonly seat: number; readonly stance: CouncilStance; readonly text: string }
export interface CouncilRun {
  readonly brief: string;
  readonly constraints: readonly string[];
  readonly rounds: number;
  readonly seats: readonly CouncilSeat[];
  readonly events: readonly CouncilEvent[];
  readonly verdicts: readonly CouncilVerdict[];
  readonly outcome?: string;
}
/** What `GET /council/run` answers: a run read from the owner's recorder, or why there is none. */
export type CouncilRunReply = { readonly run: CouncilRun; readonly from: string } | { readonly run: null; readonly reason: string };

const SEAT_ID = /^[a-z0-9][a-z0-9._-]{0,39}$/;

class Bad extends Error {}
const fail = (where: string, what: string): never => { throw new Bad(`${where}: ${what}`); };
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function obj(value: unknown, where: string): Record<string, unknown> {
  return record(value) ? value : fail(where, "expected an object");
}
function text(value: unknown, where: string, max: number): string {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : fail(where, `expected text of 1-${max} characters`);
}
function whole(value: unknown, where: string, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fail(where, `expected a whole number ${min}-${max}`);
}
function list(value: unknown, where: string, min: number, max: number): unknown[] {
  return Array.isArray(value) && value.length >= min && value.length <= max ? value : fail(where, `expected a list of ${min}-${max}`);
}

/** A run as the council recorded it, or why it is not one. Seats are referred to by index afterwards. */
export function parseCouncilRun(raw: unknown): CouncilRun | { error: string } {
  try { return readRun(raw); } catch (error) {
    if (error instanceof Bad) return { error: `not a council run (${error.message})` };
    throw error;
  }
}

function readRun(raw: unknown): CouncilRun {
  const d = obj(raw, "run");
  if (!COUNCIL_SCHEMAS.some(schema => schema === d.schema)) fail("schema", `expected "${COUNCIL_SCHEMAS[0]}"`);
  const rounds = whole(d.rounds, "rounds", 1, 8);
  const index = new Map<string, number>();
  const seats = list(d.seats, "seats", 2, 6).map((value, i): CouncilSeat => {
    const s = obj(value, `seats.${i}`);
    const id = text(s.id, `seats.${i}.id`, 40);
    if (!SEAT_ID.test(id)) fail(`seats.${i}.id`, "expected a lowercase id");
    if (index.has(id)) fail(`seats.${i}.id`, "two seats share an id");
    index.set(id, i);
    return { id, name: text(s.name, `seats.${i}.name`, 24), family: text(s.family, `seats.${i}.family`, 24) };
  });
  const seat = (value: unknown, where: string): number => index.get(typeof value === "string" ? value : "") ?? fail(where, "names an unknown seat");
  const events = list(d.events ?? [], "events", 0, 400).map((value, i): CouncilEvent => {
    const e = obj(value, `events.${i}`);
    if (e.type === "spawn") return { type: "spawn", seat: seat(e.seat, `events.${i}.seat`) };
    if (e.type !== "turn") return fail(`events.${i}.type`, 'expected "turn" or "spawn"');
    const cites = list(e.cites ?? [], `events.${i}.cites`, 0, 6).map((c, k) => seat(c, `events.${i}.cites.${k}`));
    return { type: "turn", seat: seat(e.seat, `events.${i}.seat`), round: whole(e.round, `events.${i}.round`, 1, rounds), cites };
  });
  const heard = new Set<number>();
  const verdicts = list(d.verdicts ?? [], "verdicts", 0, 6).map((value, i): CouncilVerdict => {
    const v = obj(value, `verdicts.${i}`);
    const s = seat(v.seat, `verdicts.${i}.seat`);
    if (heard.has(s)) fail(`verdicts.${i}.seat`, "seat already has a verdict");
    heard.add(s);
    const stance = v.stance;
    if (stance !== "agree" && stance !== "dissent" && stance !== "abstain") return fail(`verdicts.${i}.stance`, "expected agree, dissent or abstain");
    return { seat: s, stance, text: text(v.text, `verdicts.${i}.text`, 240) };
  });
  const constraints = list(d.constraints ?? [], "constraints", 0, 8).map((value, i) => text(value, `constraints.${i}`, 160));
  return {
    brief: text(d.brief, "brief", 280), constraints, rounds, seats, events, verdicts,
    ...(d.outcome === undefined ? {} : { outcome: text(d.outcome, "outcome", 160) }),
  };
}

/** The app's view of a bridge reply; anything malformed is "no run", never a partial run. */
export function parseCouncilRunReply(raw: unknown): CouncilRunReply {
  if (!record(raw)) return { run: null, reason: "the bridge sent no council reply" };
  if (raw.run === null) return { run: null, reason: typeof raw.reason === "string" && raw.reason.length <= 200 ? raw.reason : "no council run recorded" };
  const run = parseCouncilRun(raw.run);
  if ("error" in run) return { run: null, reason: run.error };
  return { run, from: typeof raw.from === "string" && raw.from.length <= 80 ? raw.from : "bridge" };
}

/** A synthetic run for the DEMO tag: invented seats and brief, never real council output. */
export function demoCouncilRun(): CouncilRun {
  const run = parseCouncilRun({
    schema: COUNCIL_SCHEMAS[1],
    brief: "Should Dash read council reports aloud by default on the phone?",
    constraints: ["Keep the text card usable without audio.", "Stop speaking on any tap."],
    rounds: 2,
    seats: [
      { id: "argon", name: "Argon", family: "Google" },
      { id: "astra", name: "Astra", family: "OpenAI" },
      { id: "fable", name: "Fable", family: "Anthropic" },
    ],
    events: [
      { type: "turn", seat: "argon", round: 1 }, { type: "turn", seat: "astra", round: 1 }, { type: "turn", seat: "fable", round: 1 },
      { type: "turn", seat: "argon", round: 2, cites: ["fable"] }, { type: "turn", seat: "astra", round: 2, cites: ["argon"] }, { type: "turn", seat: "fable", round: 2 },
    ],
    verdicts: [
      { seat: "argon", stance: "agree", text: "Yes, as an opt-in toggle remembered per device." },
      { seat: "astra", stance: "agree", text: "Yes, if the orb view returns to the card on any tap." },
      { seat: "fable", stance: "dissent", text: "No; default to text and offer one tap to listen." },
    ],
    outcome: "Offer read aloud as an opt-in",
  });
  if ("error" in run) throw new Error(run.error);
  return run;
}
