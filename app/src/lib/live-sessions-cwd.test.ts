import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentInfo, HostInfo } from "../../../shared/protocol";
import { AcpClient } from "../../../bridge/src/acp/client";
import type { Conversation } from "../model";
import { mergeLiveConversations } from "./live-sessions";

const primary: AgentInfo = {
  id: "omp:tern-700001", name: "OMP 1", kind: "omp", status: "running",
  sessionId: "shared-native-session", cwd: "/workspace/primary",
};
const secondary: AgentInfo = {
  id: "omp:tern-700002", name: "OMP 2", kind: "omp", status: "running",
  sessionId: "shared-native-session", cwd: "/workspace/secondary",
};

function roster(agents: AgentInfo[]): HostInfo {
  return { id: "mbp", name: "mbp", hostname: "mbp", self: true, online: true, agents };
}

const agentScript = `
const { createInterface } = require("node:readline");
const { appendFileSync } = require("node:fs");
createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  if (request.method === "session/load") {
    const { sessionId, cwd } = request.params;
    appendFileSync(process.env.DASH_ACP_CWD_LOG,
      JSON.stringify({ method: request.method, sessionId, cwd }) + "\\n");
  }
  const result = request.method === "initialize"
    ? { protocolVersion: 1, agentCapabilities: { loadSession: true } }
    : request.method === "session/prompt" ? { stopReason: "end_turn" } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
});
`;

async function loadSession(chat: Conversation, logPath: string): Promise<void> {
  if (!chat.cwd || !chat.sessionId) throw new Error("Restored pane has no cwd or session");
  const client = new AcpClient({
    command: [process.execPath, "-e", agentScript], cwd: import.meta.dir,
    env: { DASH_ACP_CWD_LOG: logPath },
    sink: { delta() {}, status() {}, session() {}, error() {} },
  });
  try {
    expect(await client.turn({ text: "continue", cwd: chat.cwd, sessionId: chat.sessionId })).toBe("end_turn");
  } finally {
    await client.close();
  }
}

test("restored OMP panes sharing a session retain each physical pane cwd through ACP loads", async () => {
  // Roster ordering may differ from the physical pane order.
  const restored = mergeLiveConversations([], [roster([secondary, primary])], 100);
  expect(restored).toHaveLength(1);
  expect(restored[0]).toMatchObject({
    id: "live:omp:shared-native-session", profileId: primary.id, cwd: primary.cwd,
  });

  const owned: Conversation = {
    ...restored[0]!,
    messages: [{ id: "user-1", role: "user", text: "before pane closes", at: 101 }],
  };
  const refreshed = mergeLiveConversations([owned], [roster([secondary, primary])], 102);
  expect(refreshed).toHaveLength(1);
  expect(refreshed[0]).toMatchObject({ profileId: primary.id, cwd: primary.cwd });

  const surviving = mergeLiveConversations(refreshed, [roster([secondary])], 103);
  expect(surviving).toHaveLength(1);
  expect(surviving[0]).toMatchObject({
    id: owned.id, profileId: secondary.id, cwd: secondary.cwd, stale: false,
    messages: owned.messages,
  });

  const dir = await mkdtemp(join(tmpdir(), "dash-omp-pane-cwd-"));
  try {
    const log = join(dir, "session-load.jsonl");
    await loadSession(refreshed[0]!, log);
    await loadSession(surviving[0]!, log);
    expect((await readFile(log, "utf8")).trim().split("\\n")).toEqual([
      JSON.stringify({ method: "session/load", sessionId: primary.sessionId, cwd: primary.cwd }),
      JSON.stringify({ method: "session/load", sessionId: secondary.sessionId, cwd: secondary.cwd }),
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
