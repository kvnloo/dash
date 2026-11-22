// Read-only T3 Code orchestration v2 adapter. Credentials stay on the Dash bridge.
import { createHash } from "node:crypto";
import { chatKey, decodeCursor, encodeCursor, MESSAGE_TEXT_MAX, type ChatSummary, type HistoryMessage } from "../../shared/protocol";
import { redact } from "./reply-parts";

const REQUEST_ID = "1";
const PROTOCOL = "2";
const TIMEOUT_MS = 3000;
const LIST_TTL_MS = 10_000;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stamp = (value: unknown) => typeof value === "string" ? Date.parse(value) : NaN;
const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

type ReadMethod = "orchestration.subscribeShell" | "orchestration.getThreadProjection";
type EventLog = (event: string, fields: { operation: string }) => void;

export function createT3CodeSource(server: string | undefined, token: string | undefined, log: EventLog) {
  if (!server && !token) return undefined;
  let base: URL;
  try {
    base = new URL(server ?? "");
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/" || !token?.trim()) throw new Error();
  } catch {
    log("t3code.invalid_config", { operation: "configure" });
    return undefined;
  }
  const hostId = `machine:t3code-${digest(base.origin)}`;
  const prefix = `${hostId}:t3code:`;
  const authorization = `Bearer ${token.trim()}`;

  async function read(method: ReadMethod, payload: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
    const response = await fetch(new URL("/api/auth/websocket-ticket", base), {
      method: "POST", headers: { Authorization: authorization, "x-t3-orchestration-protocol": PROTOCOL },
      redirect: "error", signal: deadline,
    });
    if (!response.ok) throw new Error("Ticket request failed");
    const body: unknown = await response.json();
    if (!record(body) || typeof body.ticket !== "string" || !body.ticket) throw new Error("Missing ticket");
    deadline.throwIfAborted();
    const url = new URL("/ws", base);
    url.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("orchestrationProtocol", PROTOCOL);
    url.searchParams.set("wsTicket", body.ticket);
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      function finish(result?: { value: unknown }) {
        deadline.removeEventListener("abort", finishOnAbort);
        if (socket.readyState < WebSocket.CLOSING) socket.close();
        if (result) resolve(result.value);
        else reject(new Error("T3 Code read failed"));
      }
      const finishOnAbort = () => finish();
      deadline.addEventListener("abort", finishOnAbort, { once: true });
      socket.onopen = () => socket.send(JSON.stringify({ _tag: "Request", id: REQUEST_ID, tag: method, payload, headers: [] }));
      socket.onerror = () => finish();
      socket.onclose = () => finish();
      socket.onmessage = ({ data }) => {
        if (typeof data !== "string") return finish();
        let frame: unknown;
        try { frame = JSON.parse(data); } catch { return finish(); }
        if (!record(frame)) return finish();
        if (frame._tag === "Defect" || frame._tag === "ClientProtocolError") return finish();
        if (String(frame.requestId) !== REQUEST_ID) return;
        if (method === "orchestration.subscribeShell" && frame._tag === "Chunk" && Array.isArray(frame.values)) {
          const snapshot = frame.values.find(value => record(value) && value.kind === "snapshot");
          if (record(snapshot)) return finish({ value: snapshot.snapshot });
          socket.send(JSON.stringify({ _tag: "Ack", requestId: REQUEST_ID }));
        } else if (frame._tag === "Exit") {
          if (method !== "orchestration.subscribeShell" && record(frame.exit) && frame.exit._tag === "Success") return finish({ value: frame.exit.value });
          finish();
        }
      };
    });
  }

  let listing: { expires: number; rows: Promise<ChatSummary[]> } | undefined;
  function list(): Promise<ChatSummary[]> {
    if (listing && listing.expires > Date.now()) return listing.rows;
    const rows = read("orchestration.subscribeShell", {}, new AbortController().signal).then(shell => {
      if (!record(shell) || !Array.isArray(shell.threads)) throw new Error("Invalid shell snapshot");
      const threads: unknown[] = [...shell.threads, ...(Array.isArray(shell.archivedThreads) ? shell.archivedThreads : [])];
      const summaries = new Map<string, ChatSummary>();
      for (const thread of threads) {
        if (!record(thread) || typeof thread.id !== "string" || !thread.id || thread.id.length > 256 || thread.deletedAt) continue;
        const startedAt = stamp(thread.createdAt), lastActivityAt = stamp(thread.updatedAt);
        if (!Number.isFinite(startedAt) || !Number.isFinite(lastActivityAt)) continue;
        const title = typeof thread.title === "string" ? redact(thread.title.split(/[\r\n]/, 1)[0] ?? "").trim().slice(0, 200) : "";
        const kind = "t3code";
        const key = chatKey({ hostId, kind, sessionId: thread.id });
        summaries.set(key, {
          key, kind, hostId, hostName: "T3 Code", sessionId: thread.id, title: title || "T3 Code thread",
          startedAt, lastActivityAt, messageCount: 0, origin: "t3code", chatable: false,
        });
      }
      return [...summaries.values()];
    }).catch(() => {
      log("t3code.unavailable", { operation: "list" });
      return [];
    });
    listing = { expires: Date.now() + LIST_TTL_MS, rows };
    return rows;
  }

  async function transcript(threadId: string, signal: AbortSignal): Promise<HistoryMessage[] | undefined> {
    try {
      const projection = await read("orchestration.getThreadProjection", { threadId }, signal);
      if (!record(projection) || !record(projection.thread) || projection.thread.id !== threadId || !Array.isArray(projection.messages)) throw new Error("Invalid projection");
      return projection.messages.flatMap((message: unknown): HistoryMessage[] => {
        if (!record(message) || (message.role !== "user" && message.role !== "assistant")
          || typeof message.id !== "string" || typeof message.text !== "string") return [];
        const at = stamp(message.createdAt);
        if (!Number.isFinite(at) || !message.text.trim()) return [];
        return [{ id: `t3:${digest(message.id)}`, role: message.role, text: redact(message.text), at }];
      }).sort((a, b) => a.at - b.at);
    } catch {
      if (!signal.aborted) log("t3code.unavailable", { operation: "history" });
      return undefined;
    }
  }

  return {
    hostId, prefix, list, transcript,
    async history(threadId: string, limit: number, before: string | undefined, signal: AbortSignal) {
      const rows = await transcript(threadId, signal);
      if (!rows) return undefined;
      const boundary = before ? decodeCursor(before) : null;
      const end = before
        ? (boundary?.key === prefix + threadId ? rows.findIndex(row => row.id === boundary.id) : -1)
        : rows.length;
      if (end < 0) return null;
      const start = Math.max(0, end - limit);
      return {
        messages: rows.slice(start, end).map(row => row.text.length > MESSAGE_TEXT_MAX
          ? { ...row, text: row.text.slice(0, MESSAGE_TEXT_MAX), truncated: true } : row),
        before: start > 0 ? encodeCursor({ key: prefix + threadId, id: rows[start]?.id }) : null,
      };
    },
  };
}
