// Agent -> app UI control (docs/specs/ui-control.md). An agent on this computer posts one v1
// envelope to the loopback listener (bridge/bin/dash-ui); the hub forwards it to every connected
// phone that advertised ui_control_hello with agent control switched on, then waits briefly for
// the app's ack so the agent learns what actually happened. No taps, no screen scraping.
import { parseUiControl, UI_CONTROL_SCHEMA, type UiControlAckStatus, type UiControlClientMessage, type UiControlCommand, type UiControlFrame } from "../../shared/ui-control";
import { bearerToken, secretMatches } from "./bridge-security";

export interface UiControlPeer {
  send(frame: UiControlFrame): boolean;
}

type Ack = Extract<UiControlClientMessage, { type: "ui_control_ack" }>;

export interface UiControlOutcome {
  status: UiControlAckStatus | "timeout" | "no_phone" | "disabled" | "busy";
  ref?: string;
  detail?: string;
  screen?: string;
  /** Time the app spent between receiving the frame and acking it. */
  appMs?: number;
  /** Bridge receipt -> first conclusive ack. */
  ms?: number;
}

/** Bounded delivery: a runaway agent cannot flood the phone. */
export const UI_CONTROL_RATE = { windowMs: 1000, max: 20 };
export const UI_CONTROL_WAIT_MS = 3000;

export class UiControlHub {
  private readonly peers = new Map<UiControlPeer, boolean>();
  private readonly waiting = new Map<string, (ack: Ack, from: UiControlPeer) => void>();
  private sent: number[] = [];
  constructor(private readonly now: () => number = Date.now) {}

  hello(peer: UiControlPeer, enabled: boolean): void { this.peers.set(peer, enabled); }
  leave(peer: UiControlPeer): void { this.peers.delete(peer); }
  ack(peer: UiControlPeer, ack: Ack): void { this.waiting.get(ack.ref)?.(ack, peer); }

  async dispatch(command: UiControlCommand, waitMs = UI_CONTROL_WAIT_MS): Promise<UiControlOutcome> {
    const started = this.now();
    if (this.peers.size === 0) return { status: "no_phone", detail: "No Dash phone that supports agent control is connected to this bridge." };
    const enabled = [...this.peers].filter(([, on]) => on).map(([peer]) => peer);
    if (enabled.length === 0) return { status: "disabled", detail: "Agent control is off on the phone. Turn it on in Dash: Settings > Agent control." };
    this.sent = this.sent.filter(at => started - at < UI_CONTROL_RATE.windowMs);
    if (this.sent.length >= UI_CONTROL_RATE.max) return { status: "busy", detail: `At most ${UI_CONTROL_RATE.max} commands per second.` };
    this.sent.push(started);
    const ref = crypto.randomUUID().replaceAll("-", "");
    const frame: UiControlFrame = { type: "ui_control", schema: UI_CONTROL_SCHEMA, ref, command };
    return await new Promise<UiControlOutcome>(resolve => {
      const pending = new Set<UiControlPeer>();
      let first: UiControlOutcome | undefined;
      const finish = (outcome: UiControlOutcome) => { clearTimeout(timer); this.waiting.delete(ref); resolve(outcome); };
      const timer = setTimeout(() => finish(first ?? { status: "timeout", ref, detail: `The phone did not answer within ${waitMs} ms.` }), waitMs);
      // A done from any phone wins; otherwise report the first answer once every phone has spoken.
      this.waiting.set(ref, (ack, from) => {
        if (!pending.delete(from)) return;
        const outcome: UiControlOutcome = {
          status: ack.status, ref, ms: this.now() - started,
          ...(ack.detail !== undefined ? { detail: ack.detail } : {}),
          ...(ack.screen !== undefined ? { screen: ack.screen } : {}),
          ...(ack.ms !== undefined ? { appMs: ack.ms } : {}),
        };
        first ??= outcome;
        if (ack.status === "done") finish(outcome);
        else if (pending.size === 0) finish(first);
      });
      for (const peer of enabled) {
        try { if (peer.send(frame)) pending.add(peer); } catch { this.peers.delete(peer); }
      }
      if (pending.size === 0) finish({ status: "no_phone", detail: "No connected phone accepted the command." });
    });
  }
}

const STATUS_CODE: Record<UiControlOutcome["status"], number> = {
  done: 200, skipped: 200, refused: 200, timeout: 504, no_phone: 503, disabled: 403, busy: 429,
};

/** Loopback-only, execution-token authenticated, like /notice and /secret/sudo. */
export function createUiControlHttpHandler(options: { token: string; hub: UiControlHub; onEvent?: (event: string, fields: Record<string, unknown>) => void }) {
  return async (request: Request, peer: string | null): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== "/ui-control") return null;
    if ((peer !== "127.0.0.1" && peer !== "::1" && peer !== "::ffff:127.0.0.1") || request.headers.has("origin") ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return new Response("forbidden", { status: 403 });
    if (!options.token.trim() || !secretMatches(bearerToken(request), options.token)) return new Response("unauthorized", { status: 401 });
    if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
    let body: unknown;
    try { body = JSON.parse(await request.text()); } catch { return new Response("invalid JSON", { status: 400 }); }
    const parsed = parseUiControl(body);
    if (!parsed.ok) return Response.json({ status: "invalid", detail: parsed.error }, { status: 400 });
    const outcome = await options.hub.dispatch(parsed.command);
    options.onEvent?.("ui_control", { kind: parsed.command.type, status: outcome.status, ms: outcome.ms ?? -1 });
    return Response.json(outcome, { status: STATUS_CODE[outcome.status], headers: { "Cache-Control": "no-store" } });
  };
}
