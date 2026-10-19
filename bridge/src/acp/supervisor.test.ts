import { expect, test } from "bun:test";
import { acpCommand, AcpSupervisor } from "./supervisor";
import { join } from "node:path";

test("native and maintained adapters have fixed stdio commands, unavailable means unavailable", () => {
  const which = (bin: string) => `/installed/${bin}`;
  expect(acpCommand("omp", which)).toEqual(["/installed/omp", "acp"]);
  expect(acpCommand("hermes", which)).toEqual(["/installed/hermes", "acp"]);
  expect(acpCommand("grok", which)).toEqual(["/installed/grok", "agent", "--no-leader", "stdio"]);
  expect(acpCommand("pi", which)).toBeNull();
  expect(acpCommand("codex", () => null)).toBeNull();
  expect(acpCommand("claude", which)?.[0]).toContain("claude-agent-acp");
});

test("supervisor bounds concurrency, propagates cancellation, releases admission", async () => {
  const supervisor = new AcpSupervisor();
  const sink = { session() {}, delta() {}, error() {}, status() {} };
  const handle = supervisor.start({
    id: "one", command: [process.execPath, join(import.meta.dir, "fixtures/agent.ts"), "hang"],
    input: { text: "hi", cwd: import.meta.dir }, sink,
  });
  const result = handle.done.then(() => "unexpected", error => String(error));
  expect(() => supervisor.start({ id: "two", command: ["false"], input: { text: "hi", cwd: import.meta.dir }, sink })).toThrow(/busy/);
  await handle.cancel();
  expect(await result).toContain("cancelled");
  const next = supervisor.start({ id: "two", command: [process.execPath, join(import.meta.dir, "fixtures/agent.ts")], input: { text: "hi", cwd: import.meta.dir }, sink });
  expect(await next.done).toBe("end_turn");
});
