import { expect, test } from "bun:test";
import { join } from "node:path";
import { AcpClient, acpRequestFailure } from "./client";

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
    expect(f.statuses).toContain("Running fixture tool");
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
    child = Number(/child:(\d+)/.exec(f.statuses.find(value => value.includes("child:")) ?? "")?.[1]);
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

test("restore-model failure carries the actual ACP phase over real stdio without arbitrary text", async () => {
  const f = fixture("restore-model");
  try {
    const result = await f.client.turn({ text: "hi", cwd: import.meta.dir, sessionId: "fixture-session" }).then(() => "unexpected success", (error: unknown) => error instanceof Error ? error.message : "unknown");
    expect(result).toBe("ACP request failed during session/load (code -32603); could not restore model anthropic/claude-opus-5-5; the host may have lost provider login");
    expect(result).not.toContain("credential secret");
  } finally { await f.client.close(); }
});
test("auth errors keep the safe generic hint and actual new-session phase", async () => {
  const f = fixture("auth");
  try {
    const result = await f.client.turn({ text: "hi", cwd: import.meta.dir }).then(() => "unexpected success", (error: unknown) => error instanceof Error ? error.message : "unknown");
    expect(result).toBe("ACP request failed during session/new (code -32000); check host authentication and agent diagnostics");
    expect(result).not.toContain("credential secret");
  } finally { await f.client.close(); }
});
test("diagnostic allowlist rejects credentials, suffixes, long ids and malformed errors", () => {
  for (const detail of ["credential secret", "Could not restore model anthropic/opus token=secret", "Could not restore model anthropic/opus\nsecret", "Could not restore model " + "a".repeat(81), "Could not restore model <script>"]) {
    const result = acpRequestFailure({ code: -32603, message: "credential secret", data: { details: detail } }, "initialize");
    expect(result).toBe("ACP request failed during initialize (code -32603); check host authentication and agent diagnostics");
    expect(result).not.toContain("secret");
  }
  for (const error of [null, "secret", {}, { code: Infinity }, { data: { details: 4 } }]) expect(acpRequestFailure(error, "session/prompt")).toBe("ACP request failed during session/prompt (code unknown); check host authentication and agent diagnostics");
  expect(acpRequestFailure({ data: { details: "Could not restore model local/model:v1.2-test" } }, "session/load")).toContain("could not restore model local/model:v1.2-test");
});
