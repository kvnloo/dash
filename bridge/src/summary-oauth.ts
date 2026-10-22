import { fileURLToPath } from "node:url";
import { record } from "../../shared/model-roles";
import { isSummaryFailure, type SummaryFailure } from "../../shared/thinking-summary";

export class SummaryTransportError extends Error {
  constructor(readonly code: SummaryFailure) { super(code); }
}
interface SummaryChild {
  stdin: { write(text: string): unknown; end(): unknown };
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): unknown;
}
type Spawn = (argv: string[]) => SummaryChild;
const spawn: Spawn = argv => Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "ignore" });

/** Fixed native helper, stdin data only. No shell, CLI agent, tools or fallback. */
export function createOAuthSummaryTransport(start: Spawn = spawn) {
  return async (model: string, prompt: string, signal: AbortSignal): Promise<string> => {
    if (signal.aborted) throw new SummaryTransportError("aborted");
    let child: SummaryChild;
    try { child = start(["python3", fileURLToPath(new URL("./summary-oauth.py", import.meta.url))]); }
    catch { throw new SummaryTransportError("transport_unavailable"); }
    let cancel: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      cancel = () => { child.kill(); reject(new SummaryTransportError("aborted")); };
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
    });
    try {
      child.stdin.write(JSON.stringify({ model, prompt })); child.stdin.end();
      const read = async () => {
        const reader = child.stdout.getReader();
        const decoder = new TextDecoder();
        let output = "";
        try {
          while (true) {
            const item = await reader.read();
            if (item.done) break;
            output += decoder.decode(item.value, { stream: true });
            if (output.length > 16000) throw new SummaryTransportError("invalid_response");
          }
        } finally { reader.releaseLock(); }
        if (await child.exited !== 0) throw new SummaryTransportError("transport_unavailable");
        let data: unknown;
        try { data = JSON.parse(output); } catch { throw new SummaryTransportError("invalid_response"); }
        if (!record(data)) throw new SummaryTransportError("invalid_response");
        if (data.ok !== true) throw new SummaryTransportError(isSummaryFailure(data.code) ? data.code : "provider_unavailable");
        if (data.model !== model) throw new SummaryTransportError("model_mismatch");
        if (typeof data.text !== "string" || !data.text.trim()) throw new SummaryTransportError("invalid_response");
        return data.text;
      };
      return await Promise.race([read(), aborted]);
    } catch (error) {
      if (error instanceof SummaryTransportError) throw error;
      throw new SummaryTransportError("transport_unavailable");
    } finally {
      if (cancel) signal.removeEventListener("abort", cancel);
      child.kill();
    }
  };
}
export const completeOAuthSummary = createOAuthSummaryTransport();
