import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AcpClient } from "./src/acp/client";
import { acpCommand } from "./src/acp/supervisor";

const output = process.argv[2];
if (!output) throw new Error("Usage: bun bridge/acp-runtime.ts <absolute-receipt.json>");
const word = "DASH_ACP_OK";
const results: Array<{ agent: string; verified: boolean; [key: string]: unknown }> = [];
const startedAt = new Date().toISOString();
const cwd = await mkdtemp(join(tmpdir(), "dash-acp-probe-"));
try {
  // Deliberately serial. Each connection owns and kills its process group.
  for (const agent of ["omp", "hermes", "grok", "claude", "codex", "fx"]) {
    const command = acpCommand(agent);
    if (!command) { results.push({ agent, installedAcp: false, verified: false, blocker: "Maintained ACP adapter not installed" }); continue; }
    let response = "";
    let nativeSession = false;
    let permissionDenials = 0;
    let error: string | undefined;
    let stopReason: string | undefined;
    const start = Date.now();
    const chunks: Array<{ atMs: number; text: string }> = [];
    let sessionAtMs: number | undefined;
    const client = new AcpClient({ command, cwd, timeoutMs: 120_000, sink: {
      session() { nativeSession = true; sessionAtMs = Date.now() - start; },
      delta(text) { response += text; chunks.push({ atMs: Date.now() - start, text }); },
      status(text) { if (text === "Permission denied by bridge policy") permissionDenials++; }, error() {},
    } });
    try {
      stopReason = await client.turn({ cwd, text: `Reply with exactly the single word ${word}. Do not use tools, files, commands, web access, memory, or skills. This is a transport check only.` });
    } catch (failure) { error = failure instanceof Error ? failure.message : "ACP failed"; }
    finally { await client.close(); }
    const verified = response.trim() === word && stopReason === "end_turn" && !error;
    results.push({ agent, command, installedAcp: true, verified, negotiated: client.negotiated, phase: client.phase,
      nativeSession, responseObserved: response.length > 0, expectedWordObserved: response.includes(word),
      response: verified ? word : undefined, responseBytes: Buffer.byteLength(response),
      sessionAtMs, firstDeltaMs: chunks[0]?.atMs, transcript: verified ? chunks : undefined,
      responseSha256: createHash("sha256").update(response).digest("hex"), stopReason, error, permissionDenials,
      elapsedMs: Date.now() - start, exited: client.exited, exitCode: client.exitCode, exitSignal: client.exitSignal,
    });
    process.stderr.write(`${agent}: ${verified ? "fixed word verified" : error ?? "response did not match fixed word"}\n`);
    await writeFile(output, JSON.stringify({ startedAt, updatedAt: new Date().toISOString(), concurrency: 1, nice: 10, timeoutMs: 120_000, prompt: word, results }, null, 2) + "\n");
  }
} finally { await rm(cwd, { recursive: true, force: true }); }
process.exitCode = results.every(result => result.verified) ? 0 : 1;
