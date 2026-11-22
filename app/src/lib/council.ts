// DA-075: the council exchange as one seekable clock. The brief types onto the card, one envelope
// goes to each seat, recorded turns drive each seat's state, and the replies converge into a report.
// Pure: it replays what the run recorded and never invents a reply, verdict or receipt.
import type { CouncilRun } from "../../../shared/council-run";

export const TURN_MS = 700;
const DELIVERY_MS = 900;
const CLAUSE_MS = 650;

export type CouncilPhase = "seated" | "brief" | "sending" | "working" | "report" | "done";
export type SeatState = "waiting" | "received" | "thinking" | "drafting" | "done";
export interface ReportClause { readonly label: string; readonly text: string }
export interface CouncilExchange {
  readonly phase: CouncilPhase;
  readonly brief: string;
  readonly constraints: readonly string[];
  readonly seats: readonly SeatState[];
  readonly clauses: readonly ReportClause[];
  readonly round: number;
}

/** A report quotes the snapshot: verdict, agreements, dissent, abstentions, citation receipts. */
export function reportClauses(run: CouncilRun): ReportClause[] {
  const name = (seat: number) => run.seats[seat]?.name ?? "Seat";
  const clauses: ReportClause[] = [{ label: "Verdict", text: run.outcome ?? (run.verdicts.length ? "Recorded seat replies" : "No verdict recorded") }];
  for (const [stance, label] of [["agree", "Agreements"], ["dissent", "Dissent"], ["abstain", "Abstentions"]] as const) {
    const replies = run.verdicts.filter(v => v.stance === stance);
    clauses.push({ label, text: replies.length ? replies.map(v => `${name(v.seat)}: ${v.text}`).join(" ") : "None recorded." });
  }
  const receipts = run.seats.flatMap((seat, i) => {
    const turn = [...run.events].reverse().find(e => e.type === "turn" && e.seat === i && e.cites.length > 0);
    return turn?.type === "turn" ? [`Round ${turn.round}: ${seat.name} cited ${turn.cites.map(name).join(", ")}.`] : [];
  });
  clauses.push({ label: "Receipts", text: receipts.length ? receipts.join(" ") : "No citation receipts recorded." });
  return clauses;
}

function turnStarts(run: CouncilRun, glide: boolean): number[] {
  let at = 0;
  return run.events.map(e => { const start = at; at += e.type === "turn" ? (glide ? 520 : TURN_MS) : glide ? 90 : 0; return start; });
}

export function councilTiming(run: CouncilRun, reduce = false, glide = false) {
  const chars = run.brief.length + run.constraints.join("").length;
  const typing = reduce ? 0 : Math.min(3200, Math.max(900, chars * 24));
  const working = typing + (reduce ? 0 : DELIVERY_MS);
  const turns = run.events.reduce((ms, e) => ms + (e.type === "turn" ? (glide ? 520 : TURN_MS) : glide ? 90 : 0), 0);
  const report = working + (reduce ? 0 : turns);
  return { typing, working, report, total: report + (reduce ? 0 : reportClauses(run).length * CLAUSE_MS) };
}

/** The exchange `t` ms after Convene (`null` = not convened yet). Reduced motion jumps to the end. */
export function councilAt(run: CouncilRun, t: number | null, reduce = false, glide = false): CouncilExchange {
  const time = councilTiming(run, reduce, glide);
  const elapsed = t === null ? 0 : reduce ? time.total : Math.max(0, t);
  const phase: CouncilPhase = t === null ? "seated" : elapsed < time.typing ? "brief" : elapsed < time.working ? "sending"
    : elapsed < time.report ? "working" : elapsed < time.total ? "report" : "done";
  const chars = run.brief.length + run.constraints.join("").length;
  let typed = phase === "seated" ? 0 : phase === "brief" ? Math.floor(chars * elapsed / Math.max(1, time.typing)) : chars;
  const brief = run.brief.slice(0, typed);
  typed -= run.brief.length;
  const constraints = run.constraints.map(line => { const shown = line.slice(0, Math.max(0, typed)); typed -= line.length; return shown; });
  const delivery = phase === "sending" ? (elapsed - time.typing) / DELIVERY_MS : phase === "seated" || phase === "brief" ? 0 : 1;
  const work = phase === "working" ? elapsed - time.working : phase === "report" || phase === "done" ? Infinity : -1;
  const starts = turnStarts(run, glide);
  const turnMs = glide ? 520 : TURN_MS;
  let round = 0;
  const seats = run.seats.map((_, i): SeatState => {
    if (t === null) return "waiting";
    if (delivery < (i + 1) / run.seats.length) return "waiting";
    if (work < 0) return "received";
    const mine = run.events.map((e, k) => ({ e, k })).filter(({ e }) => e.type === "turn" && e.seat === i);
    const last = mine.at(-1);
    if (!last || work >= (starts[last.k] ?? 0) + turnMs) return "done";
    const now = mine.find(({ k }) => work >= (starts[k] ?? 0) && work < (starts[k] ?? 0) + turnMs);
    if (now?.e.type === "turn") round = Math.max(round, now.e.round);
    return now ? "drafting" : "thinking";
  });
  const all = reportClauses(run);
  const clauses = phase === "done" ? all : phase === "report" ? all.slice(0, 1 + Math.floor((elapsed - time.report) / CLAUSE_MS)) : [];
  return { phase, brief, constraints, seats, clauses, round };
}

/** What Read aloud says before the seats work: the brief and its constraints. */
export function briefSpeech(run: CouncilRun): string { return [run.brief, ...run.constraints].join(" "); }
/** What Read aloud says once the report is complete. */
export function reportSpeech(run: CouncilRun): string { return reportClauses(run).map(c => `${c.label}. ${c.text}`).join(" "); }

/** Sentences, so a caption shows one at a time and a return can resume where it stopped. */
export function councilSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+["')\]]?|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) ?? [];
}
