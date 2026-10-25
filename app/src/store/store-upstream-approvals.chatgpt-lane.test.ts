import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { GateItem } from "../../../shared/gate";
import { actionable, applyGateMessage, approvals, bulkEligible, itemTitle } from "./approvals";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

function makeItem(
  id: string,
  state: GateItem["state"] = "pending",
  policy: GateItem["policy"] = {
    bulk_ok: true,
    requires_human_text: false,
    reason: "Synthetic test proposal only",
    rules: [],
  },
): GateItem {
  return {
    id,
    kind: "issue_comment",
    target: { repo: "fixture/rehearsal", number: 42 },
    body: "Synthetic fixture text; do not post",
    evidence: [{ label: "fixture", url_or_path: "local:test" }],
    origin: { agent: "fixture", session: "local", created_at: "2026-10-25T00:00:00Z" },
    policy,
    state,
    trail: [],
  };
}

function resetApprovals(): void {
  approvals.set({
    items: [],
    dryRun: true,
    ownerDecisions: false,
    loaded: false,
    error: null,
    status: {},
  });
}

// approvals is a singleton, so every test returns it to the initial state.
// No native imports, module mocks, timers, network, or live GitHub writes.
beforeEach(resetApprovals);
afterEach(resetApprovals);

describe("upstream GateItem snapshot boundaries", () => {
  test("a snapshot replaces items and clears prior per-id statuses and global error", () => {
    const first = makeItem(FIRST_ID);
    const replacement = makeItem(SECOND_ID, "edited");
    expect(approvals.get()).toEqual({
      items: [], dryRun: true, ownerDecisions: false, loaded: false, error: null, status: {},
    });

    applyGateMessage({ type: "gate_snapshot", items: [first], dry_run: true });
    applyGateMessage({ type: "gate_status", id: FIRST_ID, message: "Awaiting review" });
    applyGateMessage({ type: "gate_error", message: "Earlier request failed" });

    applyGateMessage({
      type: "gate_snapshot",
      items: [replacement],
      dry_run: false,
      owner_decisions: true,
    });
    expect(approvals.get()).toEqual({
      items: [replacement],
      dryRun: false,
      ownerDecisions: true,
      loaded: true,
      error: null,
      status: {},
    });
    expect(approvals.get().items).not.toContain(first);
  });

  test("an empty snapshot clears the list, status and error; omitted owner_decisions is false", () => {
    applyGateMessage({
      type: "gate_snapshot",
      items: [makeItem(FIRST_ID)],
      dry_run: false,
      owner_decisions: true,
    });
    applyGateMessage({ type: "gate_status", id: FIRST_ID, message: "Reviewing" });
    applyGateMessage({ type: "gate_error", message: "Previous error" });

    applyGateMessage({ type: "gate_snapshot", items: [], dry_run: true });
    expect(approvals.get()).toEqual({
      items: [],
      dryRun: true,
      ownerDecisions: false,
      loaded: true,
      error: null,
      status: {},
    });
  });

  test("a later snapshot, not a status update, changes an item's approval state", () => {
    const first = makeItem(FIRST_ID);
    applyGateMessage({ type: "gate_snapshot", items: [first], dry_run: false });
    applyGateMessage({ type: "gate_status", id: FIRST_ID, message: "Posted" });

    expect(approvals.get().items[0]).toBe(first);
    expect(approvals.get().items[0]?.state).toBe("pending");
    expect(approvals.get().items[0]?.receipt).toBeUndefined();

    const posted = makeItem(FIRST_ID, "posted");
    applyGateMessage({ type: "gate_snapshot", items: [posted], dry_run: false });
    expect(approvals.get().items).toEqual([posted]);
    expect(approvals.get().status).toEqual({});
  });
});

describe("per-item status and global error separation", () => {
  test("two independent status ids survive a later error without mutating items", () => {
    const first = makeItem(FIRST_ID);
    const second = makeItem(SECOND_ID, "edited");
    applyGateMessage({ type: "gate_snapshot", items: [first, second], dry_run: true });
    const initialItems = approvals.get().items;

    applyGateMessage({ type: "gate_status", id: FIRST_ID, message: "First queued" });
    applyGateMessage({ type: "gate_status", id: SECOND_ID, message: "Second approved for review" });
    expect(approvals.get().status).toEqual({
      [FIRST_ID]: "First queued",
      [SECOND_ID]: "Second approved for review",
    });

    applyGateMessage({ type: "gate_error", message: "Temporary bridge failure" });
    expect(approvals.get().error).toBe("Temporary bridge failure");
    expect(approvals.get().status).toEqual({
      [FIRST_ID]: "First queued",
      [SECOND_ID]: "Second approved for review",
    });
    expect(approvals.get().items).toBe(initialItems);
    expect(approvals.get().items.map((item) => item.state)).toEqual(["pending", "edited"]);
    expect(approvals.get().items.every((item) => item.receipt === undefined)).toBe(true);
  });

  test("a later status updates only its id and clears a global error", () => {
    const first = makeItem(FIRST_ID);
    const second = makeItem(SECOND_ID);
    applyGateMessage({ type: "gate_snapshot", items: [first, second], dry_run: false });
    applyGateMessage({ type: "gate_status", id: FIRST_ID, message: "Waiting" });
    applyGateMessage({ type: "gate_status", id: SECOND_ID, message: "Unchanged" });
    applyGateMessage({ type: "gate_error", message: "Failed to refresh" });

    applyGateMessage({ type: "gate_status", id: FIRST_ID, message: "Retrying" });
    expect(approvals.get().status).toEqual({
      [FIRST_ID]: "Retrying",
      [SECOND_ID]: "Unchanged",
    });
    expect(approvals.get().error).toBeNull();
    expect(approvals.get().items).toEqual([first, second]);
    expect(approvals.get().loaded).toBe(true);
  });

  test("repeated gate errors replace only error, preserving ids and mode", () => {
    const first = makeItem(FIRST_ID, "approved");
    applyGateMessage({
      type: "gate_snapshot",
      items: [first],
      dry_run: true,
      owner_decisions: true,
    });
    applyGateMessage({ type: "gate_status", id: FIRST_ID, message: "Processing" });
    applyGateMessage({ type: "gate_error", message: "First failure" });
    applyGateMessage({ type: "gate_error", message: "Second failure" });
    expect(approvals.get()).toEqual({
      items: [first],
      dryRun: true,
      ownerDecisions: true,
      loaded: true,
      error: "Second failure",
      status: { [FIRST_ID]: "Processing" },
    });
  });
});

describe("actionability and bulk selection do not imply approval", () => {
  const states: GateItem["state"][] = [
    "pending", "edited", "approved", "rejected", "posted", "failed", "stale",
  ];

  test("only pending and edited items are actionable", () => {
    for (const state of states) {
      expect(actionable(makeItem(FIRST_ID, state))).toBe(
        state === "pending" || state === "edited",
      );
    }
  });

  test("bulk eligibility enforces both policy flags for every item state", () => {
    for (const state of states) {
      for (const bulkOk of [false, true]) {
        for (const requiresHumanText of [false, true]) {
          const proposal = makeItem(FIRST_ID, state, {
            bulk_ok: bulkOk,
            requires_human_text: requiresHumanText,
            reason: "Synthetic policy",
            rules: [],
          });
          expect(bulkEligible(proposal)).toBe(
            (state === "pending" || state === "edited") && bulkOk && !requiresHumanText,
          );
        }
      }
    }
  });

  test("dry-run and owner-decision flags never mutate an item's approval or receipt", () => {
    const pending = makeItem(FIRST_ID);
    const humanText = makeItem(SECOND_ID, "edited", {
      bulk_ok: true,
      requires_human_text: true,
      reason: "Owner must compose text",
      rules: [],
    });
    for (const dryRun of [true, false]) {
      for (const ownerDecisions of [true, false]) {
        applyGateMessage({
          type: "gate_snapshot",
          items: [pending, humanText],
          dry_run: dryRun,
          owner_decisions: ownerDecisions,
        });
        const state = approvals.get();
        expect(state.dryRun).toBe(dryRun);
        expect(state.ownerDecisions).toBe(ownerDecisions);
        expect(state.items).toEqual([pending, humanText]);
        expect(state.items.map((item) => item.state)).toEqual(["pending", "edited"]);
        expect(state.items.every((item) => item.receipt === undefined)).toBe(true);
        expect(bulkEligible(state.items[0]!)).toBe(true);
        expect(bulkEligible(state.items[1]!)).toBe(false);
      }
    }
  });
});

describe("GateItem titles", () => {
  test("each action kind has a fallback for missing, empty or whitespace-only titles", () => {
    const fallbacks: { kind: GateItem["kind"]; title: string }[] = [
      { kind: "issue_comment", title: "Comment on issue" },
      { kind: "pr_comment", title: "Comment on pull request" },
      { kind: "pr_review_reply", title: "Reply to a review comment" },
      { kind: "pr_open", title: "Open pull request" },
      { kind: "pr_ready_for_review", title: "Mark ready for review" },
      { kind: "push_branch", title: "Push branch" },
    ];
    for (const { kind, title } of fallbacks) {
      expect(itemTitle({ kind, target: { repo: "fixture/rehearsal" } })).toBe(title);
      expect(itemTitle({ kind, target: { repo: "fixture/rehearsal", title: "" } })).toBe(title);
      expect(itemTitle({ kind, target: { repo: "fixture/rehearsal", title: " \n\t " } })).toBe(title);
    }
  });

  test("a meaningful target title is trimmed and takes priority over the action fallback", () => {
    expect(itemTitle({
      kind: "pr_open",
      target: { repo: "fixture/rehearsal", title: "  Fix the fixture  " },
    })).toBe("Fix the fixture");
    expect(itemTitle({
      kind: "push_branch",
      target: { repo: "fixture/rehearsal", title: " Release " },
    })).toBe("Release");
  });
});

test("a detached subscriber sees no more singleton updates", () => {
  const seen: string[] = [];
  const unsubscribe = approvals.subscribe(() => {
    seen.push(approvals.get().error ?? "updated");
  });
  try {
    applyGateMessage({ type: "gate_snapshot", items: [makeItem(FIRST_ID)], dry_run: true });
    applyGateMessage({ type: "gate_error", message: "Bridge unavailable" });
    expect(seen).toEqual(["updated", "Bridge unavailable"]);
  } finally {
    unsubscribe();
  }
  applyGateMessage({ type: "gate_error", message: "Later failure" });
  expect(seen).toEqual(["updated", "Bridge unavailable"]);
});
