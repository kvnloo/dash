import { expect, test } from "bun:test";
import { createTree, syncDataLoaderFeature } from "@headless-tree/core";
import type { HostInfo } from "../../../shared/protocol";
import { botsTree, hostLabel } from "./bots-tree";
import { childNodes, treeIndex, type TreeNode } from "./tree";
import { toolTree, TOOL_TREE_FIXTURE } from "./tool-tree";

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
  const root = toolTree(TOOL_TREE_FIXTURE)[0];
  const groups = await children(root);
  expect(groups.map(n => n.kind)).toEqual(["thinking", "tools"]);
  const call = (await children(groups[1]))[0];
  expect(call?.meta).toBe("0.1s");
  const leaves = await children(call);
  expect(leaves[0]?.detail).toBe(TOOL_TREE_FIXTURE.tools?.[0]?.args);
  expect(leaves[1]?.detail).toBe(TOOL_TREE_FIXTURE.tools?.[0]?.output);
  expect(toolTree({ id: "other" })[0]?.id).not.toBe(root?.id);
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
