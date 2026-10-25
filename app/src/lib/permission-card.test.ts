import { describe, expect, test } from "bun:test";
import {
  canChoosePermissionOption,
  dispatchPermissionChoice,
  formatPermissionDeadline,
  groupPermissionOptions,
  permissionStatus,
  type PermissionCardOption,
  type PermissionCardPhase,
} from "./permission-card";

const offered: PermissionCardOption[] = [
  { optionId: "allow/once:42", name: "Allow this time", kind: "allow_once" },
  { optionId: "allow/always", name: "Always allow this action", kind: "allow_always" },
  { optionId: "reject/once:42", name: "Reject this time", kind: "reject_once" },
  { optionId: "reject/always", name: "Always reject this action", kind: "reject_always" },
];

describe("offered ACP option mapping", () => {
  test("groups both allow kinds and both reject kinds without modifying IDs or names", () => {
    const groups = groupPermissionOptions(offered);
    expect(groups.valid).toBe(true);
    expect(groups.approve.map(o => o.optionId)).toEqual(["allow/once:42", "allow/always"]);
    expect(groups.deny.map(o => o.optionId)).toEqual(["reject/once:42", "reject/always"]);
    expect(groups.approve[0]?.name).toBe("Allow this time");
    expect(groups.deny[1]?.name).toBe("Always reject this action");
    expect(groups.unsupported).toEqual([]);
  });

  test("unsupported kinds stay visible to the caller but cannot produce an action", () => {
    const unknown: PermissionCardOption = { optionId: "future/option", name: "Escalate", kind: "escalate" };
    const groups = groupPermissionOptions([unknown, offered[0]!]);
    expect(groups.valid).toBe(true);
    expect(groups.approve.map(o => o.optionId)).toEqual(["allow/once:42"]);
    expect(groups.unsupported).toEqual([unknown]);
    expect(canChoosePermissionOption([unknown, offered[0]!], "pending", 5000, 1000, unknown.optionId)).toBe(false);
    expect(canChoosePermissionOption([unknown, offered[0]!], "pending", 5000, 1000, "allow/once:42")).toBe(true);
  });

  test("unsupported-only and no-options lists cannot approve or fabricate a reject option", () => {
    const unknown: PermissionCardOption = { optionId: "u", name: "Unknown", kind: "allow" };
    expect(groupPermissionOptions([unknown]).approve).toEqual([]);
    expect(groupPermissionOptions([unknown]).deny).toEqual([]);
    expect(groupPermissionOptions([])).toEqual({ approve: [], deny: [], unsupported: [], valid: true });
    expect(canChoosePermissionOption([], "pending", 5000, 1000, "allow_once")).toBe(false);
    expect(canChoosePermissionOption([unknown], "pending", 5000, 1000, "u")).toBe(false);
  });

  test("malformed identifiers, names, and duplicates invalidate the complete offer", () => {
    const bad: PermissionCardOption[] = [
      { optionId: "", name: "Allow", kind: "allow_once" },
      { optionId: "  ", name: "Allow", kind: "allow_once" },
      { optionId: "a", name: " ", kind: "allow_once" },
    ];
    for (const option of bad) {
      const groups = groupPermissionOptions([offered[0]!, option]);
      expect(groups.valid).toBe(false);
      expect(groups.approve).toEqual([]);
      expect(canChoosePermissionOption([offered[0]!, option], "pending", 5000, 1000, "allow/once:42")).toBe(false);
    }
    const duplicated: PermissionCardOption[] = [offered[0]!, { ...offered[0]!, name: "Reject", kind: "reject_once" }];
    expect(groupPermissionOptions(duplicated).valid).toBe(false);
    expect(canChoosePermissionOption(duplicated, "pending", 5000, 1000, "allow/once:42")).toBe(false);
  });
});

describe("decision callback safety", () => {
  test("dispatch preserves exact chosen optionId for both approval and rejection", () => {
    const sent: string[] = [];
    const send = (optionId: string) => { sent.push(optionId); };
    expect(dispatchPermissionChoice(offered, "pending", 2000, 1000, "allow/once:42", send)).toBe(true);
    expect(dispatchPermissionChoice(offered, "pending", 2000, 1000, "reject/always", send)).toBe(true);
    expect(sent).toEqual(["allow/once:42", "reject/always"]);
  });

  test("labels, ACP kinds, indices and nonoffered IDs cannot masquerade as option IDs", () => {
    const sent: string[] = [];
    for (const attempted of ["Allow this time", "allow_once", "allow/once", "0", "REJECT/ALWAYS", ""]) {
      expect(dispatchPermissionChoice(offered, "pending", 2000, 1000, attempted, id => { sent.push(id); })).toBe(false);
    }
    expect(sent).toEqual([]);
  });

  test("expired or invalid deadline blocks both approve and deny including at the exact boundary", () => {
    const sent: string[] = [];
    for (const deadline of [1000, 999, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(dispatchPermissionChoice(offered, "pending", deadline, 1000, "allow/once:42", id => { sent.push(id); })).toBe(false);
      expect(dispatchPermissionChoice(offered, "pending", deadline, 1000, "reject/once:42", id => { sent.push(id); })).toBe(false);
    }
    expect(canChoosePermissionOption(offered, "pending", 2000, Number.NaN, "allow/once:42")).toBe(false);
    expect(sent).toEqual([]);
  });

  test("deciding, settled, timed out and locally expired phases block all choices", () => {
    const disabled: PermissionCardPhase[] = ["deciding", "allowed", "denied", "timeout", "expired"];
    const sent: string[] = [];
    for (const phase of disabled) {
      expect(dispatchPermissionChoice(offered, phase, 2000, 1000, "allow/once:42", id => { sent.push(id); })).toBe(false);
      expect(dispatchPermissionChoice(offered, phase, 2000, 1000, "reject/once:42", id => { sent.push(id); })).toBe(false);
    }
    expect(sent).toEqual([]);
  });

  test("unknown-only and duplicate offers cannot trigger callbacks", () => {
    const unknown = [{ optionId: "unsupported", name: "Allow?", kind: "allow_future" }];
    const duplicate = [offered[0]!, offered[0]!];
    const sent: string[] = [];
    expect(dispatchPermissionChoice(unknown, "pending", 2000, 1000, "unsupported", id => { sent.push(id); })).toBe(false);
    expect(dispatchPermissionChoice(duplicate, "pending", 2000, 1000, "allow/once:42", id => { sent.push(id); })).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe("deadline and truthful result vocabulary", () => {
  test("formats relative countdown with a ceiling at subsecond boundaries", () => {
    expect(formatPermissionDeadline(61_000, 0)).toBe("Expires in 1:01");
    expect(formatPermissionDeadline(60_000, 0)).toBe("Expires in 1:00");
    expect(formatPermissionDeadline(60_001, 0)).toBe("Expires in 1:01");
    expect(formatPermissionDeadline(1, 0)).toBe("Expires in 0:01");
    expect(formatPermissionDeadline(60_000, 60_000)).toBe("Decision window expired");
    expect(formatPermissionDeadline(Number.NaN, 0)).toBe("Deadline unavailable");
    expect(formatPermissionDeadline(1000, Number.POSITIVE_INFINITY)).toBe("Deadline unavailable");
  });

  test("never reports local expiry or a pending click as host approval", () => {
    expect(permissionStatus("pending", 2000, 1000)).toBe("Waiting for your decision");
    expect(permissionStatus("pending", 2000, 2000)).toBe("Decision expired · awaiting host denial");
    expect(permissionStatus("expired", 2000, 1000)).toBe("Decision expired · awaiting host denial");
    expect(permissionStatus("deciding", 2000, 1000)).toBe("Decision sent · awaiting host confirmation");
  });

  test("only settled host phases report allowed, denied, or Denied: timed out", () => {
    expect(permissionStatus("allowed", 2000, 1000)).toBe("Allowed · confirmed by host");
    expect(permissionStatus("denied", 2000, 1000)).toBe("Denied · confirmed by host");
    expect(permissionStatus("timeout", 2000, 1000)).toBe("Denied: timed out");
    expect(permissionStatus("pending", Number.NaN, 1000)).not.toContain("Allowed");
  });
});
