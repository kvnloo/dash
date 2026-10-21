import { expect, test } from "bun:test";
import { selectWorkers } from "./hermes-workers";

const now = 1_800_000_000_000;
const s = (n: number) => Math.floor((now - n) / 1000);
const base = { source: "oneshot", cwd: null, parent_session_id: null, ended_at: null, last_activity_description: null };

test("delegate children and launched headless runs are workers; ended, stale and unrelated are not", () => {
  const files: Record<string, string> = { "/runs/a/PARENT_SESSION": "P\n", "/runs/b/PARENT_SESSION": "OTHER" };
  const rows = [
    { ...base, id: "child", title: "Fix tool rows", parent_session_id: "P", started_at: s(60_000), last_activity_at: s(5_000), last_activity_description: "executing tool: terminal" },
    { ...base, id: "run-a", title: "Density dial", cwd: "/runs/a", started_at: s(600_000), last_activity_at: s(1_000), last_activity_description: "Running patch" },
    { ...base, id: "run-b", title: "Other parent", cwd: "/runs/b", started_at: s(10_000), last_activity_at: s(1_000) },
    { ...base, id: "ended", title: "Done", parent_session_id: "P", started_at: s(10_000), last_activity_at: s(1_000), ended_at: s(500) },
    { ...base, id: "stale", title: "Old", parent_session_id: "P", started_at: s(900_000), last_activity_at: s(400_000) },
    { ...base, id: "P", title: "Parent itself", started_at: s(1_000), last_activity_at: s(1_000) },
  ];
  const workers = selectWorkers(rows, new Set(["P"]), now, path => files[path]);
  expect(workers.map(w => w.id)).toEqual(["run-a", "child"]);
  expect(workers[0]).toMatchObject({ title: "Density dial", phase: "tool", tool: "patch" });
  expect(workers[1]).toMatchObject({ phase: "tool", tool: "terminal" });
});

test("a live worker with no fresh activity label reads as thinking", () => {
  const rows = [{ ...base, id: "c", title: "t", parent_session_id: "P", started_at: s(200_000), last_activity_at: s(120_000), last_activity_description: "executing tool: terminal" }];
  expect(selectWorkers(rows, new Set(["P"]), now, () => undefined)[0]).toMatchObject({ phase: "thinking" });
});
