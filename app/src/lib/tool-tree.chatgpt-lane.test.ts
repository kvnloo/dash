import { describe, expect, test } from "bun:test";
import { childNodes, type TreeNode } from "./tree";
import { toolTree, type ToolTreeReply } from "./tool-tree";

type Tool = NonNullable<ToolTreeReply["tools"]>[number];

function makeTool(id: string, fields: Partial<Tool> = {}): Tool {
  return {
    id,
    name: "read_file",
    summary: "synthetic fixture",
    args: "{\"path\":\"fixtures/example.txt\"}",
    output: "synthetic result",
    status: "ok",
    durationMs: 1250,
    truncated: false,
    ...fields,
  };
}

async function expand(node: TreeNode | undefined): Promise<TreeNode[]> {
  return node ? await childNodes(node) : [];
}

async function callOrGroupNodes(
  reply: ToolTreeReply,
  inspect?: (callId: string) => void,
): Promise<TreeNode[]> {
  const root = toolTree(reply, inspect)[0];
  const sections = await expand(root);
  return expand(sections.find(node => node.kind === "tools"));
}

describe("toolTree lazy boundaries and call identity (DASH2-185)", () => {
  test("absent and null optional metadata do not create tool or reasoning rows", async () => {
    const absent: ToolTreeReply = {};
    const empty: ToolTreeReply = { id: "empty", tools: [], activity: [], reasoning: "" };
    const nullFields: ToolTreeReply = { id: "null-fields" };
    Reflect.set(nullFields, "tools", null);
    Reflect.set(nullFields, "reasoning", null);
    Reflect.set(nullFields, "activity", null);

    for (const reply of [absent, empty, nullFields]) {
      const root = toolTree(reply, () => { throw new Error("No inspectable call exists"); })[0];
      expect(root?.kind).toBe("turn");
      expect(root?.meta).toBe("0 calls");
      expect(await expand(root)).toEqual([]);
    }
    expect(toolTree(absent)[0]?.id).toBe("reply:turn");
    expect(toolTree(empty)[0]?.id).toBe("empty:turn");
  });

  test("reasoning takes precedence over activity; missing reasoning uses the ordered activity", async () => {
    const explicit = toolTree({
      id: "explicit",
      reasoning: "model reasoning",
      activity: ["not the visible fallback"],
    })[0];
    const explicitBranches = await expand(explicit);
    expect(explicitBranches.map(node => node.kind)).toEqual(["thinking"]);
    expect((await expand(explicitBranches[0]))[0]?.detail).toBe("model reasoning");

    const fallback = toolTree({ id: "activity", activity: ["first", "second"] })[0];
    const fallbackBranches = await expand(fallback);
    expect((await expand(fallbackBranches[0]))[0]?.detail).toBe("first\nsecond");

    const suppressed = toolTree({ id: "empty-explicit", reasoning: "", activity: ["ignored"] })[0];
    expect(await expand(suppressed)).toEqual([]);
  });

  test("preserves exact turn and distinct call IDs through grouped lazy inspect actions", async () => {
    const turnId = "turn:session/a#13";
    const callIds = ["read:one/A?x=1", "read:two:B/β#2"];
    const inspected: string[] = [];
    const root = toolTree({
      id: "different-message-id",
      turnId,
      tools: [
        makeTool(callIds[0], { args: "{\"path\":\"fixtures/one\"}" }),
        makeTool(callIds[1], { args: "{\"path\":\"fixtures/two\"}" }),
      ],
    }, callId => { inspected.push(callId); })[0];

    expect(root?.id).toBe(turnId + ":turn");
    const sections = await expand(root);
    expect(sections.map(node => node.kind)).toEqual(["tools"]);
    const groups = await expand(sections[0]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe(turnId + ":group:" + callIds[0]);
    expect(groups[0]?.kind).toBe("tools");
    const calls = await expand(groups[0]);
    expect(calls).toHaveLength(2);

    for (let index = 0; index < callIds.length; index++) {
      const call = calls[index];
      const callId = callIds[index];
      expect(call?.id).toBe(turnId + ":call:" + callId);
      expect(call?.kind).toBe("call");
      const leaves = await expand(call);
      expect(leaves.map(leaf => leaf.id)).toEqual([
        turnId + ":args:" + callId,
        turnId + ":output:" + callId,
        turnId + ":inspect:" + callId,
      ]);
      for (const leaf of leaves) leaf.onPress?.();
    }
    expect(inspected).toEqual([
      callIds[0], callIds[0], callIds[0],
      callIds[1], callIds[1], callIds[1],
    ]);
  });

  test("does not read or flatten large output until its tool subtree is expanded", async () => {
    const longOutput = "SYNTHETIC-HEAD\n" + "Z".repeat(80_000) + "\nSYNTHETIC-TAIL";
    const tool = makeTool("lazy-output", { truncated: true });
    let outputReads = 0;
    Object.defineProperty(tool, "output", {
      enumerable: true,
      configurable: true,
      get: () => {
        outputReads++;
        return longOutput;
      },
    });

    const root = toolTree({ id: "lazy-turn", tools: [tool] })[0];
    expect(typeof root?.children).toBe("function");
    expect(outputReads).toBe(0);
    expect(JSON.stringify(root)).not.toContain("SYNTHETIC-HEAD");
    const sections = await expand(root);
    expect(sections).toHaveLength(1);
    expect(typeof sections[0]?.children).toBe("function");
    expect(outputReads).toBe(0);

    const calls = await expand(sections[0]);
    expect(calls).toHaveLength(1);
    expect(outputReads).toBeGreaterThan(0);
    const leaves = await expand(calls[0]);
    expect(leaves.map(node => node.kind)).toEqual(["args", "output", "note"]);
    expect(leaves[0]?.detail?.length).toBeLessThanOrEqual(400);
    expect(leaves[1]?.detail?.length).toBe(300);
    expect(leaves[1]?.detail?.endsWith("SYNTHETIC-TAIL")).toBe(true);
    expect(leaves[1]?.detail).not.toContain("SYNTHETIC-HEAD");
    expect(leaves[1]?.label).toContain("truncated");
    expect(leaves[2]?.detail).toBeUndefined();
  });

  test("unknown tool names and non-JSON arguments still keep exact call identity", async () => {
    const id = "unrecognized/tool#7";
    const inspected: string[] = [];
    const calls = await callOrGroupNodes({
      turnId: "t-unknown",
      tools: [makeTool(id, { name: "unknown_vendor_tool", args: "{invalid", output: "synthetic text", durationMs: 0 })],
    }, callId => { inspected.push(callId); });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe("t-unknown:call:" + id);
    expect(calls[0]?.status).toBe("available");
    const leaves = await expand(calls[0]);
    expect(leaves[0]?.detail).toBe("{invalid");
    expect(leaves[1]?.detail).toBe("synthetic text");
    leaves[2]?.onPress?.();
    expect(inspected).toEqual([id]);
  });

  test("redacts synthetic authorization text without changing the inspect target", async () => {
    const id = "redact:id";
    const inspected: string[] = [];
    const calls = await callOrGroupNodes({
      id: "redact-turn",
      tools: [makeTool(id, {
        name: "unknown_vendor_tool",
        output: "Bearer synthetic-example-value",
        args: "{\"authorization\":\"Bearer synthetic-example-value\"}",
      })],
    }, callId => { inspected.push(callId); });
    const leaves = await expand(calls[0]);
    expect(leaves[0]?.detail).toContain("[REDACTED]");
    expect(leaves[0]?.detail).not.toContain("synthetic-example-value");
    expect(leaves[1]?.detail).toBe("Bearer [REDACTED]");
    leaves[0]?.onPress?.();
    leaves[1]?.onPress?.();
    expect(inspected).toEqual([id, id]);
  });

  test("REGRESSION: malformed tools collections must not invent calls or throw", async () => {
    for (const invalid of [null, "not-an-array", { length: 1 }, 23, [null], ["not-a-tool"]]) {
      const reply: ToolTreeReply = { id: "invalid-tools" };
      Reflect.set(reply, "tools", invalid);
      expect(() => toolTree(reply)).not.toThrow();
      const root = toolTree(reply)[0];
      expect(root?.meta).toBe("0 calls");
      expect(await expand(root)).toEqual([]);
    }
  });

  test("REGRESSION: malformed call IDs and statuses must not become inspectable state", async () => {
    const badIds: unknown[] = [null, undefined, "", "   ", 5, [], { call: "not-a-string" }];
    for (const invalidId of badIds) {
      const tool = makeTool("original-id");
      Reflect.set(tool, "id", invalidId);
      const inspected: string[] = [];
      const nodes = await callOrGroupNodes({ id: "root", tools: [tool] }, id => inspected.push(id));
      expect(nodes).toEqual([]);
      expect(inspected).toEqual([]);
    }

    const wrongStatus = makeTool("valid-id");
    Reflect.set(wrongStatus, "status", "unknown");
    expect(await callOrGroupNodes({ id: "root", tools: [wrongStatus] })).toEqual([]);
  });

  test("REGRESSION: malformed reasoning/activity and turn IDs must not synthesize identity", async () => {
    const invalidActivity: ToolTreeReply = { id: "valid-id" };
    Reflect.set(invalidActivity, "activity", "not-a-string-list");
    expect(() => toolTree(invalidActivity)).not.toThrow();
    expect(await expand(toolTree(invalidActivity)[0])).toEqual([]);

    const invalidReasoning: ToolTreeReply = { id: "reasoning" };
    Reflect.set(invalidReasoning, "reasoning", ["array-is-not-reasoning"]);
    expect(await expand(toolTree(invalidReasoning)[0])).toEqual([]);

    const invalidTurn: ToolTreeReply = { id: "actual-message-id" };
    Reflect.set(invalidTurn, "turnId", ["not-a-turn-id"]);
    expect(toolTree(invalidTurn)[0]?.id).toBe("actual-message-id:turn");
  });
});
