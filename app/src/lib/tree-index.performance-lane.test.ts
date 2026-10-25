import { describe, expect, test } from "bun:test";
import { childNodes, treeIndex, type TreeNode } from "./tree";

/**
 * Optional standalone timing recipe, NOT RUN by ChatGPT.
 * From the repository root, run the following with Bun and record the Bun version,
 * machine, measured mean and memory before/after. No timing result is a test gate.
 *
 * bun -e '
 *   import { treeIndex, type TreeNode } from "./app/src/lib/tree.ts";
 *   const roots: TreeNode[] = Array.from({ length: 4096 }, (_, i) => ({
 *     id: "host:" + i, label: "Host " + i, kind: "host",
 *   }));
 *   for (let i = 0; i < 100; i++) treeIndex(roots);
 *   const before = process.memoryUsage().heapUsed;
 *   const start = performance.now();
 *   for (let i = 0; i < 1000; i++) treeIndex(roots);
 *   console.log("mean_ms", (performance.now() - start) / 1000);
 *   console.log("heap_delta_bytes", process.memoryUsage().heapUsed - before);
 * '
 *
 * Input: 4096 visible root nodes; 100 warmups; 1000 measured iterations.
 * Environment: NOT RUN. Mean milliseconds: NOT RUN. Heap delta: NOT RUN.
 * The tests below assert observable lookup/loader operations, never elapsed time.
 */
function node(id: string, children?: TreeNode["children"]): TreeNode {
  return { id, label: "Node " + id, kind: "host", ...(children === undefined ? {} : { children }) };
}

describe("treeIndex: visible-branch performance contract", () => {
  test("empty input creates one synthetic root and no hidden entries", () => {
    const roots: TreeNode[] = [];
    const result = treeIndex(roots);

    expect(result.root).toEqual({
      id: "dash-tree-root",
      label: "Tree",
      kind: "note",
      children: roots,
    });
    expect(result.root.children).toBe(roots);
    expect([...result.index.entries()]).toEqual([[result.root.id, result.root]]);
    expect(result.index.get("absent")).toBeUndefined();
  });

  test("small nested fixture preserves identities without indexing unopened levels", async () => {
    const grandchild = node("turn:0");
    const grandchildren = [grandchild];
    const child = node("session:0", grandchildren);
    const children = [child];
    const first = node("host:0", children);
    const second = node("host:1");
    const roots = [first, second];

    Object.freeze(grandchild);
    Object.freeze(grandchildren);
    Object.freeze(child);
    Object.freeze(children);
    Object.freeze(first);
    Object.freeze(second);
    Object.freeze(roots);

    const { root, index } = treeIndex(roots);
    expect(root.children).toBe(roots);
    expect([...index.keys()]).toEqual(["dash-tree-root", "host:0", "host:1"]);
    expect(index.get("host:0")).toBe(first);
    expect(index.get("host:1")).toBe(second);
    expect(index.get("session:0")).toBeUndefined();
    expect(index.get("turn:0")).toBeUndefined();

    expect(await childNodes(first)).toBe(children);
    expect(await childNodes(child)).toBe(grandchildren);
    expect(await childNodes(grandchild)).toEqual([]);
    expect([...index.keys()]).toEqual(["dash-tree-root", "host:0", "host:1"]);
    expect(roots).toEqual([first, second]);
  });

  test("duplicate visible ids use the last node; empty ids are not silently renamed", () => {
    const first = node("duplicate");
    const empty = node("");
    const last = node("duplicate");
    const roots = [first, empty, last];
    const { root, index } = treeIndex(roots);

    // TreeNode requires an id and the source documents globally unique ids.
    // These invalid inputs still have deterministic Map semantics, not a fallback id.
    expect(root.children).toBe(roots);
    expect([...index.keys()]).toEqual(["dash-tree-root", "duplicate", ""]);
    expect(index.size).toBe(3);
    expect(index.get("duplicate")).toBe(last);
    expect(index.get("")).toBe(empty);
    expect(index.get("not-present")).toBeUndefined();
    expect(roots[0]).toBe(first);
  });

  test("indexing never reads unrelated children or invokes UI handlers", () => {
    let childrenReads = 0;
    let actions = 0;
    const guarded: TreeNode = {
      id: "host:guard",
      label: "Do not expand",
      kind: "host",
      get children() {
        childrenReads++;
        throw new Error("treeIndex must not traverse unopened children");
      },
      onPress: () => { actions++; },
      onLongPress: () => { actions++; },
    };

    const { index } = treeIndex([guarded]);
    expect(index.get(guarded.id)).toBe(guarded);
    expect(childrenReads).toBe(0);
    expect(actions).toBe(0);
  });

  test("large tree remains a one-level index; only a requested lazy branch runs", async () => {
    const width = 4096;
    const branching = 3;
    const loaderCalls = new Map<number, number>();
    let nestedLoaderCalls = 0;
    let actionCalls = 0;
    const roots: TreeNode[] = Array.from({ length: width }, (_, i) => ({
      id: "host:" + i,
      label: "Host " + i,
      kind: "host",
      onPress: () => { actionCalls++; },
      onLongPress: () => { actionCalls++; },
      children: () => {
        loaderCalls.set(i, (loaderCalls.get(i) ?? 0) + 1);
        return Array.from({ length: branching }, (_, j): TreeNode => ({
          id: "host:" + i + ":session:" + j,
          label: "Session " + j,
          kind: "session",
          children: () => {
            nestedLoaderCalls++;
            return [{
              id: "host:" + i + ":session:" + j + ":turn:0",
              label: "Turn 0",
              kind: "turn",
            }];
          },
        }));
      },
    }));
    const originalRoots = roots.slice();
    const { root, index } = treeIndex(roots);

    // The implementation inserts exactly one synthetic root plus the exposed
    // top-level nodes; it never recursively expands any of 4096 lazy branches.
    expect(root.children).toBe(roots);
    expect(index.size).toBe(width + 1);
    expect([...index.keys()]).toEqual(["dash-tree-root", ...roots.map(item => item.id)]);
    expect([...index.values()]).toEqual([root, ...originalRoots]);
    expect(loaderCalls.size).toBe(0);
    expect(nestedLoaderCalls).toBe(0);
    expect(actionCalls).toBe(0);

    const selected = index.get("host:2048");
    if (!selected) throw new Error("Expected selected visible host in tree index");
    const expanded = await childNodes(selected);
    expect(expanded.map(item => item.id)).toEqual([
      "host:2048:session:0",
      "host:2048:session:1",
      "host:2048:session:2",
    ]);
    expect(loaderCalls.size).toBe(1);
    expect(loaderCalls.get(2048)).toBe(1);
    expect(nestedLoaderCalls).toBe(0);
    expect(actionCalls).toBe(0);
    expect(index.size).toBe(width + 1);

    // Headless Tree's caller registers visible children, not treeIndex or childNodes.
    for (const item of expanded) index.set(item.id, item);
    expect(index.size).toBe(width + 1 + branching);
    expect(index.get("host:2048:session:1")).toBe(expanded[1]);
    const visibleChild = expanded[0];
    if (!visibleChild) throw new Error("Expected first expanded session");
    const leaves = await childNodes(visibleChild);
    expect(leaves.map(item => item.id)).toEqual(["host:2048:session:0:turn:0"]);
    expect(nestedLoaderCalls).toBe(1);
    expect(loaderCalls.size).toBe(1);
    expect(index.has(leaves[0]?.id ?? "")).toBe(false);
    expect(actionCalls).toBe(0);
    expect(roots).toEqual(originalRoots);
  });
});

describe("childNodes: explicit, bounded lazy requests", () => {
  test("sync and async children each invoke only their own loader once", async () => {
    const synchronousChildren = [node("sync:child")];
    const asynchronousChildren = [node("async:child")];
    let syncCalls = 0;
    let asyncCalls = 0;
    let unrelatedCalls = 0;
    const sync = node("sync", () => {
      syncCalls++;
      return synchronousChildren;
    });
    const asyncNode = node("async", async () => {
      asyncCalls++;
      return asynchronousChildren;
    });
    const unrelated = node("unrelated", () => {
      unrelatedCalls++;
      throw new Error("Unrelated lazy branch was requested");
    });
    const { index } = treeIndex([sync, unrelated, asyncNode]);

    expect(syncCalls).toBe(0);
    expect(asyncCalls).toBe(0);
    expect(unrelatedCalls).toBe(0);
    expect(childNodes(sync)).toBe(synchronousChildren);
    expect(syncCalls).toBe(1);
    const pending = childNodes(asyncNode);
    expect(pending).toBeInstanceOf(Promise);
    expect(await pending).toBe(asynchronousChildren);
    expect(asyncCalls).toBe(1);
    expect(unrelatedCalls).toBe(0);
    expect(index.size).toBe(4);
    expect(index.get("sync:child")).toBeUndefined();
    expect(index.get("async:child")).toBeUndefined();
  });

  test("eager and absent children do not run loaders, mutate nodes, or schedule timers", () => {
    let unrelatedCalls = 0;
    const children = [node("eager:child")];
    const eager = node("eager", children);
    const empty = node("empty");
    const unrelated = node("unrelated", () => {
      unrelatedCalls++;
      return [];
    });
    Object.freeze(children);
    Object.freeze(eager);
    Object.freeze(empty);
    Object.freeze(unrelated);

    expect(childNodes(eager)).toBe(children);
    expect(childNodes(empty)).toEqual([]);
    expect(childNodes(empty)).toEqual([]);
    expect(unrelatedCalls).toBe(0);
    expect(eager.children).toBe(children);
    expect(empty.children).toBeUndefined();
    // Neither helper creates a timer; no fake clocks, global spies, or cleanup needed.
  });
});
