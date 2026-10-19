import { expect, test } from "bun:test";
import { join } from "node:path";
import { AcpClient } from "./client";

function fixture(mode = "ok", timeoutMs = 2500) {
  const text: string[] = [];
  const statuses: string[] = [];
  const sessions: string[] = [];
  const client = new AcpClient({
    command: [process.execPath, join(import.meta.dir, "fixtures/agent.ts"), mode],
    cwd: import.meta.dir,
    timeoutMs,
    sink: { delta: value => text.push(value), status: value => statuses.push(value), session: value => sessions.push(value), error() {} },
  });
  return { client, text, statuses, sessions };
}

test("real stdio negotiates, creates session, maps chunks and closes owned process", async () => {
  const f = fixture();
  try {
    expect(await f.client.turn({ text: "hi", cwd: import.meta.dir })).toBe("end_turn");
    expect(f.text).toEqual(["DASH_ACP_OK"]);
    expect(f.sessions).toEqual(["fixture-session"]);
    expect(f.statuses).toContain("fixture tool");
  } finally { await f.client.close(); }
  expect(f.client.exited).toBe(true);
});

test.each(["permission", "fs"])("denies %s requests over the same stdio transport", async mode => {
  const f = fixture(mode);
  try {
    await f.client.turn({ text: "hi", cwd: import.meta.dir });
    expect(f.text).toEqual(["DENIED"]);
  } finally { await f.client.close(); }
});

test("resume keeps native session identity and suppresses historical replay", async () => {
  const f = fixture();
  try {
    await f.client.turn({ text: "hi", cwd: import.meta.dir, sessionId: "fixture-session" });
    expect(f.text).toEqual(["DASH_ACP_OK"]);
    expect(f.sessions).toEqual(["fixture-session"]);
  } finally { await f.client.close(); }
});

test.each(["auth", "exit", "malformed", "no-load"])("%s fails terminally without another interface or leaking stderr", async mode => {
  const f = fixture(mode);
  try {
    const result = f.client.turn({ text: "hi", cwd: import.meta.dir, ...(mode === "no-load" ? { sessionId: "fixture-session" } : {}) });
    await expect(result).rejects.toThrow(/ACP/);
  } finally { await f.client.close(); }
});

test("timeout kills the owned process and rejects outstanding work", async () => {
  const f = fixture("hang", 250);
  try { await expect(f.client.turn({ text: "hi", cwd: import.meta.dir })).rejects.toThrow(/timed out/); }
  finally { await f.client.close(); }
  expect(f.client.exited).toBe(true);
});

test("cancel notifies the session and terminates the process", async () => {
  const f = fixture("hang");
  const running = f.client.turn({ text: "hi", cwd: import.meta.dir }).then(() => "unexpected success", error => String(error));
  while (f.sessions.length === 0) await Bun.sleep(5);
  await f.client.cancel();
  expect(await running).toContain("cancelled");
  await f.client.close();
  expect(f.client.exited).toBe(true);
});

test("close kills the owned process group even after the direct agent exits", async () => {
  const f = fixture("orphan");
  let child: number | undefined;
  try {
    await f.client.turn({ text: "hi", cwd: import.meta.dir });
    child = Number(f.statuses.find(value => value.startsWith("child:"))?.slice(6));
    expect(Number.isSafeInteger(child)).toBe(true);
    while (!f.client.exited) await Bun.sleep(5);
    await f.client.close();
    for (let i = 0; i < 30; i++) {
      try { process.kill(child, 0); } catch { return; }
      await Bun.sleep(10);
    }
    throw new Error("ACP descendant still running after close");
  } finally {
    if (child) { try { process.kill(child, "SIGKILL"); } catch {} }
    await f.client.close();
  }
});
