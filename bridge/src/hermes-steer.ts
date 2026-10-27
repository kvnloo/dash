import { fileURLToPath } from "node:url";
import { sendIntoLiveSession, type LiveResult } from "./hermes-live";

export type SteerReceipt = { ok: boolean; code: string };
export type Delivery = "steered" | "queued" | "started";
export type SteerSpawn = (argv: string[], options: { env: Record<string, string | undefined> }) => {
  stdin: { write(text: string): unknown; end(): unknown };
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal?: NodeJS.Signals): void;
};
const spawnSteer: SteerSpawn = (argv, options) => Bun.spawn(argv, { ...options, stdin: "pipe", stdout: "pipe", stderr: "ignore" });

/** A failed/ambiguous steer is NEVER resubmitted. Only explicit no-turn rejections fall back. */
export function steerDisposition(receipt: SteerReceipt): "steered" | "queue" | "failed" {
  if (receipt.ok && receipt.code === "steered") return "steered";
  if (!receipt.ok && ["no_running_turn", "stale_generation", "execution_not_ready"].includes(receipt.code)) return "queue";
  return "failed";
}

export async function gatewaySteer(options: { home: string; sessionId: string; text: string; signal?: AbortSignal; spawnSteer?: SteerSpawn }): Promise<SteerReceipt> {
  const env: Record<string, string | undefined> = { ...process.env, HERMES_HOME: options.home };
  delete env.HERMES_TUI_GATEWAY_URL;
  const child = (options.spawnSteer ?? spawnSteer)(["python3", fileURLToPath(new URL("./hermes-steer.py", import.meta.url))], { env });
  const abort = () => child.kill("SIGTERM");
  const timer = setTimeout(abort, 35_000);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (options.signal?.aborted) { abort(); throw new Error("Steer cancelled; check the session before resending."); }
    child.stdin.write(JSON.stringify({ session_id: options.sessionId, text: options.text }));
    child.stdin.end();
    const [text, exit] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    if (exit !== 0 || options.signal?.aborted) throw new Error("Steer outcome unknown; check the session before resending.");
    const receipt: unknown = JSON.parse(text);
    if (typeof receipt !== "object" || receipt === null || !("ok" in receipt) || typeof receipt.ok !== "boolean" || !("code" in receipt) || typeof receipt.code !== "string") throw new Error("Invalid steer receipt; check the session before resending.");
    return { ok: receipt.ok, code: receipt.code };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export async function sendGatewayMessage(options: Parameters<typeof sendIntoLiveSession>[0] & {
  mode?: "steer" | "queue";
  delivery(mode: Delivery, text: string): void;
  steer?: typeof gatewaySteer;
  queue?: (options: Parameters<typeof sendIntoLiveSession>[0]) => Promise<LiveResult>;
}): Promise<LiveResult> {
  if (options.mode === "steer") {
    const receipt = await (options.steer ?? gatewaySteer)(options);
    const disposition = steerDisposition(receipt);
    if (disposition === "failed") throw new Error(`Steer failed (${receipt.code}). Nothing retried; check the session before resending.`);
    if (disposition === "steered") {
      options.delivery("steered", "Steered the running turn. Applied at its next tool boundary.");
      // A steer has no reply of its own. Do not copy another viewer's output into it.
      return { text: "", sessionId: options.sessionId, exitCode: 0 };
    }
    options.delivery("queued", "The turn stopped accepting steering; queued for the next turn instead.");
  } else options.delivery("queued", "Queued for the next turn.");
  let started = false;
  return (options.queue ?? sendIntoLiveSession)({ ...options, onStarted: () => {
    if (!started) { started = true; options.delivery("started", "Next turn started."); }
  } });
}
