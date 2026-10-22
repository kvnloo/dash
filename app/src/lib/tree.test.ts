import { expect, test } from "bun:test";
import { createTree, syncDataLoaderFeature } from "@headless-tree/core";
import type { HostInfo } from "../../../shared/protocol";
import { botsTree, hostLabel } from "./bots-tree";
import { childNodes, treeIndex, type TreeNode } from "./tree";
import { callSummary, toolTree, type ToolTreeReply, type ToolTreeTool } from "./tool-tree";

const TOOL_TREE_FIXTURE: ToolTreeReply = {
  id: "fixture-turn",
  tools: [{ id: "read-roster", name: "read_file", summary: "bridge/src/roster.ts", args: '{"path":"bridge/src/roster.ts"}', output: "name: node.hostName,\nid: magicDnsLabel", status: "ok", durationMs: 142, truncated: false }],
};

const host: HostInfo = { id: "0", name: "0", hostname: "groot", self: true, online: true, bots: [], agents: [
  { id: "hermes:session:clean:s1", kind: "hermes", name: "Review roster", status: "running", sessionId: "s1", profileId: "clean", cwd: "/workspace/dash", lastActivityAt: 0 },
] };
async function children(node: TreeNode | undefined) { return node ? await childNodes(node) : []; }

test("host labels use hostname but routing remains 0; counts are actual and children lazy", async () => {
  let opened = "";
  const nodes = botsTree([host], (h, a) => { opened = `${h.id}:${a.sessionId}`; }, () => {}, 120000);
  expect(hostLabel(host)).toBe("groot");
  expect(nodes[0]?.id).toBe("host:0");
  expect(nodes[0]?.meta).toBe("0 bots · 1 chats");
  expect(typeof nodes[0]?.children).toBe("function");
  const harness = (await children(nodes[0]))[0];
  expect(harness?.kind).toBe("harness");
  const session = (await children(harness))[0];
  expect(session?.label).toBe("Review roster");
  expect(session?.meta).toBe("2m");
  session?.onPress?.(); expect(opened).toBe("0:s1");
  expect((await children(session))[0]?.detail).toBe("/workspace/dash");
  expect(botsTree([{ ...host, online: false }], () => {}, () => {})[0]?.dimmed).toBe(true);
});

test("unknown bot count is not invented and bot-owned sessions appear once", async () => {
  const nodes = botsTree([{ ...host, bots: [{ id: "b", name: "clean", runtime: "hermes", status: "running", channels: [], agentId: "profile" }], agents: [...host.agents, { id: "profile", name: "clean", kind: "hermes", profileId: "clean", status: "running" }] }], () => {}, () => {});
  const bots = await children(nodes[0]);
  expect(bots).toHaveLength(1);
  expect((await children(bots[0]))[0]?.kind).toBe("session");
  expect(botsTree([{ ...host, bots: undefined }], () => {}, () => {})[0]?.meta).toBe("1 chats");
});

test("sessionless harness targets are not dropped and old Hermes profile IDs still own chats", async () => {
  const nodes = botsTree([{ ...host, bots: [{ id: "b", name: "clean", runtime: "hermes", status: "running", channels: [], agentId: "hermes:clean" }], agents: [...host.agents,
    { id: "hermes:clean", name: "clean", kind: "hermes", status: "running" },
    { id: "omp:a", name: "OMP A", kind: "omp", status: "running" },
    { id: "omp:b", name: "OMP B", kind: "omp", status: "running" },
  ] }], () => {}, () => {});
  const branches = await children(nodes[0]);
  expect(branches).toHaveLength(2);
  expect((await children(branches[0]))[0]?.label).toBe("Review roster");
  expect((await children(branches[1])).map(node => node.label)).toEqual(["OMP A", "OMP B"]);
});

test("tool adapter preserves actual arguments/output/duration and namespaces IDs", async () => {
  const call = toolTree(TOOL_TREE_FIXTURE)[0];
  expect(call?.kind).toBe("call");
  expect(call?.meta).toBe("0.1s");
  const leaves = await children(call);
  expect(JSON.parse(leaves[0]?.detail ?? "{}")).toEqual(JSON.parse(TOOL_TREE_FIXTURE.tools?.[0]?.args ?? "{}"));
  expect(leaves[1]?.detail).toBe(TOOL_TREE_FIXTURE.tools?.[0]?.output);
  expect(toolTree({ id: "other", tools: TOOL_TREE_FIXTURE.tools })[0]?.id).not.toBe(call?.id);
});

test("Headless Tree expands flattened nodes without a DOM or native modules", () => {
  let requests = 0;
  const source = treeIndex([{ id: "host", label: "Host", kind: "host", children: () => { requests++; return [{ id: "session", label: "Session", kind: "session" }]; } }]);
  const tree = createTree<TreeNode>({ rootItemId: source.root.id, getItemName: item => item.getItemData().label, isItemFolder: item => Boolean(item.getItemData().children), dataLoader: {
    getItem: id => source.index.get(id) ?? source.root,
    getChildren: id => {
      const result = childNodes(source.index.get(id) ?? source.root);
      if (result instanceof Promise) throw new Error("sync fixture");
      for (const n of result) source.index.set(n.id, n);
      return result.map(n => n.id);
    },
  }, features: [syncDataLoaderFeature] });
  tree.setMounted(true); tree.rebuildTree();
  expect(tree.getItems().map(n => n.getId())).toEqual(["host"]);
  expect(requests).toBe(0);
  tree.getItemInstance("host").expand();
  expect(tree.getItems().map(n => n.getId())).toEqual(["host", "session"]);
  expect(tree.getItemInstance("session").getItemMeta().level).toBe(1);
  tree.getItemInstance("host").collapse();
  expect(tree.getItems()).toHaveLength(1);
});
async function labels(nodes: TreeNode[]): Promise<string[]> {
  const out: string[] = [];
  for (const node of nodes) out.push(node.label, ...(await labels(await children(node))));
  return out;
}
test("ACP plain-text terminal call keeps its command in the inline tree", async () => {
  const text = (await labels(toolTree({ id: "acp", tools: [{ id: "t", name: "terminal", summary: "terminal", args: "$ bun test parser.test.ts", output: "", status: "live", durationMs: 0, truncated: false }] }))).join("\n");
  expect(text).toContain("bun test parser.test.ts");
  expect(text).not.toContain("terminal · terminal");
});

const tool = (id: string, name: string, args: unknown, extra: Partial<ToolTreeTool> = {}): ToolTreeTool => ({ id, name, summary: name, args: typeof args === "string" ? args : JSON.stringify(args), output: "", status: "ok", durationMs: 1000, truncated: false, ...extra });
const longPath = "/mnt/zer0models/workspace/zer0/products/dash/.worktrees/fixture/app/src/lib/parsers/unterminated-string-parser.ts";
test("repeated same-name calls are individual top-level rows, not a generic group", () => {
  const nodes = toolTree({ id: "r", tools: [tool("a", "read_file", { path: longPath, offset: 1, limit: 40 }), tool("b", "read_file", { path: longPath.replace("unterminated", "escape"), offset: 80, limit: 20 })] }, undefined, "Compact");
  expect(nodes.map(n => n.kind)).toEqual(["call", "call"]);
  expect(nodes[0]?.label).toBe("read_file · unterminated-string-parser.ts:1–40");
  expect(nodes[1]?.label).toBe("read_file · escape-string-parser.ts:80–99");
  expect(nodes[0]?.detail).toBe("…space/zer0/products/dash/.worktrees/fixture/app/src/lib/parsers");
});
test("failed and running terminal rows say state, exit and the failing line", () => {
  const failed = callSummary(tool("t1", "terminal", { command: "bun test app/src/lib/parsers/parser.test.ts", workdir: "/repo" }, { status: "error", output: JSON.stringify({ exit_code: 1, output: "(fail) parser rejects unterminated string [2.1ms]\nerror: expected 1 got 0\nRan 12 tests across 1 file." }) }));
  expect(failed.label).toBe("terminal · bun test app/src/lib/parsers/parser.test.ts");
  expect(failed.detail).toBe("failed · exit 1 · parser rejects unterminated string");
  const running = callSummary(tool("t2", "terminal", { command: "bun test --rerun-each 3 parser.test.ts" }, { status: "live", output: "Running parser.test.ts" }));
  expect(running.detail).toBe("running · Running parser.test.ts");
  expect(callSummary(tool("t3", "terminal", "$ bun test parser.test.ts", { status: "live" })).label).toBe("terminal · bun test parser.test.ts");
});
test("Compact shows the latest five calls and folds older ones; Full lists every call", () => {
  const tools = (n: number) => Array.from({ length: n }, (_, i) => tool(`c${i}`, "terminal", { command: `step ${i}` }, i === 0 ? { status: "error" } : {}));
  expect(toolTree({ id: "r", tools: tools(5) }, undefined, "Compact").map(n => n.kind)).toEqual(Array(5).fill("call"));
  const six = toolTree({ id: "r", tools: tools(6) }, undefined, "Compact");
  expect(six.map(n => n.label)).toEqual(["1 earlier call", ...tools(6).slice(1).map((_, i) => `terminal · step ${i + 1}`)]);
  expect(six[0]?.meta).toBe("error");
  expect(toolTree({ id: "r", tools: tools(7).map(t => ({ ...t, status: "ok" as const })) }, undefined, "Compact")[0]).toMatchObject({ label: "2 earlier calls", meta: undefined });
  expect(toolTree({ id: "r", tools: tools(7) }, undefined, "Full").map(n => n.kind)).toEqual(Array(7).fill("call"));
});
test("row meta and status: running has no duration, finished calls show seconds", () => {
  const [live, ok, failed] = toolTree({ id: "r", tools: [tool("a", "terminal", { command: "a" }, { status: "live" }), tool("b", "terminal", { command: "b" }, { durationMs: 2400 }), tool("c", "terminal", { command: "c" }, { status: "error", durationMs: 1800 })] });
  expect([live?.meta, ok?.meta, failed?.meta]).toEqual([undefined, "2.4s", "1.8s"]);
  expect([live?.status, ok?.status, failed?.status]).toEqual(["running", "available", "offline"]);
});
test("ok rows show formatter facts; ok terminal rows show exit-0 output without an exit label", () => {
  expect(callSummary(tool("w", "write_file", { path: "/repo/app/x.ts", content: "hi" })).detail).toBe("2 bytes");
  expect(callSummary(tool("s", "search_files", { pattern: "needle", path: "src" }, { output: '{"total_count":3}' })).detail).toBe("3 matches");
  expect(callSummary(tool("t", "terminal", { command: "bun test" }, { output: JSON.stringify({ exit_code: 0, output: "12 pass\nRan 12 tests" }) }))).toEqual({ label: "terminal · bun test", detail: "Ran 12 tests" });
  expect(callSummary(tool("r", "read_file", { path: "x.ts" })).detail).toBe("");
  expect(callSummary(tool("p", "patch", { input: "*** Begin Patch\n*** Update File: src/y.ts\n-a\n+b" })).label).toBe("patch · y.ts");
});
