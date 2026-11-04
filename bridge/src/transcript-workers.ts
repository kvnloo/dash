import type { SessionWorker } from "./hermes-workers";

const MAX_WORKERS = 32;
const TITLE_LIMIT = 60;
const MAX_INPUT_BYTES = 1024 * 1024;
const SUBAGENT_TOOLS = new Set(["task", "agent", "spawn_agent", "subagent", "delegate_task"]);

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function field(value: Record<string, unknown>, names: readonly string[]): string | undefined {
  for (const name of names) {
    const result = text(value[name]);
    if (result !== undefined) return result;
  }
  return undefined;
}

function toolName(event: Record<string, unknown>): string | undefined {
  const direct = field(event, ["name", "tool_name", "toolName", "tool"]);
  const nested = object(event.function) ? field(event.function, ["name"]) : undefined;
  // ACP titles use "Task: description"; only the prefix is a tool name.
  const title = field(event, ["title"]);
  return direct ?? nested ?? (title ? title.split(":")[0]?.trim() : undefined);
}

function toolInput(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const functionInput = object(event.function) ? event.function.arguments : undefined;
  let value: unknown = event.input ?? event.rawInput ?? event.arguments ?? event.args
    ?? event.parameters ?? functionInput;
  if (typeof value === "string") {
    if (value.length > MAX_INPUT_BYTES) return undefined;
    try { value = JSON.parse(value); } catch { return undefined; }
  }
  return object(value) ? value : undefined;
}

function titleOf(event: Record<string, unknown>, name: string): string {
  const input = toolInput(event);
  const description = text(input?.description) ?? text(event.description);
  const prompt = text(input?.prompt);
  const short = (description ?? prompt ?? name).replace(/\s+/g, " ").trim();
  // Slice by Unicode code points so a surrogate pair cannot be cut in half.
  return Array.from(short).slice(0, TITLE_LIMIT).join("");
}

function eventTime(event: Record<string, unknown>, fallback: number): number {
  const raw = event.timestamp ?? event.created_at ?? event.createdAt
    ?? event.time ?? event.at ?? event.ts;
  const number = typeof raw === "number" ? raw
    : typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : undefined;
  if (number !== undefined && Number.isFinite(number) && number >= 0) {
    // Common archive event timestamps are Unix seconds; worker timestamps use ms.
    return number >= 1_000_000_000 && number < 100_000_000_000 ? number * 1000 : number;
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

type IndexedWorker = { worker: SessionWorker; order: number };

/**
 * A status-only projection of raw Claude, Codex, or OMP tool events.
 * Never preserves prompts, tool inputs, tool results, or transcript messages.
 * The caller must scope events to one authenticated harness/session.
 */
export function workersFromToolEvents(events: readonly unknown[], now: number): SessionWorker[] {
  if (!Number.isFinite(now)) return [];

  const workers = new Map<string, IndexedWorker>();
  let order = 0;

  function finish(id: string | undefined, at: number): void {
    if (!id) return;
    const entry = workers.get(id);
    if (!entry) return;
    const { worker } = entry;
    entry.worker = {
      id: worker.id,
      title: worker.title,
      phase: "idle",
      startedAt: worker.startedAt,
      lastActivityAt: at,
    };
    entry.order = order++;
  }

  function visit(value: unknown, inheritedTime: number, depth: number): void {
    if (!object(value) || depth > 5) return;
    const at = eventTime(value, inheritedTime);
    const kind = field(value, ["sessionUpdate", "type", "event", "kind"])?.toLowerCase();

    if (kind === "tool_use" || kind === "tool_call" || kind === "function_call") {
      const name = toolName(value);
      const id = field(value, ["id", "toolCallId", "tool_call_id", "call_id", "callId"]);
      if (name && id && SUBAGENT_TOOLS.has(name.toLowerCase())) {
        const worker: SessionWorker = {
          id,
          title: titleOf(value, name),
          phase: "tool",
          tool: name,
          startedAt: at,
          lastActivityAt: at,
        };
        workers.set(id, { worker, order: order++ });
      }
      if (value.status === "completed" || value.status === "failed" || value.status === "cancelled") {
        finish(id, at);
      }
    } else if (kind === "tool_result" || kind === "tool_output" || kind === "function_call_output") {
      finish(field(value, ["tool_use_id", "toolCallId", "tool_call_id", "call_id", "callId", "id"]), at);
    } else if (kind === "tool_call_update" &&
      (value.status === "completed" || value.status === "failed" || value.status === "cancelled")) {
      finish(field(value, ["toolCallId", "tool_call_id", "call_id", "callId", "id"]), at);
    }

    // Claude JSONL wraps tool blocks in message.content; Codex/OMP can wrap
    // them in payload/update/data. Preserve the parent's timestamp.
    for (const wrapper of [value.payload, value.message, value.update, value.data]) {
      if (object(wrapper)) visit(wrapper, at, depth + 1);
    }
    if (Array.isArray(value.content)) {
      for (const block of value.content) visit(block, at, depth + 1);
    }
  }

  for (const event of events) visit(event, now, 0);

  return Array.from(workers.values())
    .sort((left, right) => right.worker.lastActivityAt - left.worker.lastActivityAt || right.order - left.order)
    .slice(0, MAX_WORKERS)
    .map(entry => entry.worker);
}
