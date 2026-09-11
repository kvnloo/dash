import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HARNESSES, type Sink } from "./harnesses";

function collectSink() {
  const sessions: string[] = [];
  const deltas: string[] = [];
  const statuses: string[] = [];
  const errors: string[] = [];
  const sink: Sink = {
    session: (id) => sessions.push(id),
    delta: (text) => deltas.push(text),
    status: (text) => statuses.push(text),
    error: (message) => errors.push(message),
  };
  return { sink, sessions, deltas, statuses, errors };
}

function byId(id: string) {
  return HARNESSES.find((h) => h.id === id);
}

describe("AODL catalog executors", () => {
  test("hello.harnesses lists catalog executors and never o8 or firstmate", () => {
    expect(HARNESSES.map((h) => h.id)).toEqual([
      "omp",
      "codex",
      "grok",
      "claude",
      "hermes",
      "pi",
      "fx",
    ]);
    expect(HARNESSES.some((h) => h.id === "o8")).toBe(false);
    expect(HARNESSES.some((h) => h.id === "firstmate")).toBe(false);
  });

  test("live dash-pair imports HARNESSES from the adapter module", () => {
    const src = readFileSync(join(import.meta.dir, "../index.ts"), "utf8");
    expect(src).toContain('from "./src/harnesses"');
    expect(src).toMatch(/\bHARNESSES\b/);
    expect(src).not.toMatch(/const omp: Harness/);
  });
});

describe("pi", () => {
  test("argv is documented --mode json, not omp's --auto-approve fork flags", () => {
    const pi = byId("pi");
    expect(pi?.bin).toBe("pi");
    expect(pi?.name).toBe("Pi");
    expect(pi?.argv({ text: "list files", cwd: "/tmp/dash" })).toEqual([
      "--mode",
      "json",
      "--approve",
      "--",
      "list files",
    ]);
    expect(pi?.argv({ text: "hi", cwd: "/work", sessionId: "abc" })).toEqual([
      "--mode",
      "json",
      "--approve",
      "--session",
      "abc",
      "--",
      "hi",
    ]);
  });

  test("parser streams Pi/OMP session + text_delta events", () => {
    const pi = byId("pi");
    expect(pi).toBeDefined();
    const { sink, sessions, deltas, statuses } = collectSink();
    const parser = pi!.parser(sink);
    parser.line(JSON.stringify({ type: "session", version: 3, id: "sess-1" }));
    parser.line(
      JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello" },
      }),
    );
    parser.line(JSON.stringify({ type: "tool_execution_start", toolName: "bash", args: { command: "ls" } }));
    parser.line(JSON.stringify({ type: "tool_execution_end" }));
    parser.end();
    expect(sessions).toEqual(["sess-1"]);
    expect(deltas).toEqual(["Hello"]);
    expect(statuses).toEqual(["$ ls", ""]);
  });
});

describe("fx", () => {
  test("argv is fx ask --json --full-access with resume-id", () => {
    const fx = byId("fx");
    expect(fx?.bin).toBe("fx");
    expect(fx?.name).toBe("fx");
    expect(fx?.argv({ text: "explain this repo", cwd: "/tmp/dash" })).toEqual([
      "ask",
      "--json",
      "--full-access",
      "--",
      "explain this repo",
    ]);
    expect(fx?.argv({ text: "continue", cwd: "/tmp/dash", sessionId: "AbCdEfGhIjKl" })).toEqual([
      "ask",
      "--json",
      "--full-access",
      "--resume-id",
      "AbCdEfGhIjKl",
      "--",
      "continue",
    ]);
  });

  test("parser reads session_id and accumulated output from one JSON object", () => {
    const fx = byId("fx");
    expect(fx).toBeDefined();
    const { sink, sessions, deltas, errors } = collectSink();
    const parser = fx!.parser(sink);
    parser.line(
      JSON.stringify({
        session_id: "AbCdEfGhIjKl",
        output: "Checking sources.",
        final_output: "Checking sources.",
      }),
    );
    parser.end();
    expect(sessions).toEqual(["AbCdEfGhIjKl"]);
    expect(deltas).toEqual(["Checking sources."]);
    expect(errors).toEqual([]);
  });

  test("parser prefers output over empty final_output and accepts pretty-printed JSON", () => {
    const fx = byId("fx");
    expect(fx).toBeDefined();
    const { sink, sessions, deltas } = collectSink();
    const parser = fx!.parser(sink);
    for (const line of `{
  "session_id": "pretty-id",
  "output": "partial answer",
  "final_output": ""
}`.split("\n")) {
      parser.line(line);
    }
    parser.end();
    expect(sessions).toEqual(["pretty-id"]);
    expect(deltas).toEqual(["partial answer"]);
  });
});

describe("malformed harness JSON", () => {
  test("OMP parser surfaces a structured error instead of dropping the line", () => {
    const omp = byId("omp");
    expect(omp).toBeDefined();
    const { sink, errors, deltas } = collectSink();
    const parser = omp!.parser(sink);
    parser.line("{not-json");
    parser.line(JSON.stringify({ type: "session", id: "keep-going" }));
    parser.end();
    expect(errors).toEqual(["Harness emitted malformed JSON."]);
    expect(deltas).toEqual([]);
  });
});
