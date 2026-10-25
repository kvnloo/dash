/** Standalone, fail-closed view model for ACP permission choices. No store or transport dependency. */
export type PermissionCardOption = Readonly<{
  optionId: string;
  name: string;
  kind: string;
}>;

export type PermissionCardPhase = "pending" | "deciding" | "allowed" | "denied" | "timeout" | "expired";

export type PermissionOptionGroups = Readonly<{
  approve: readonly PermissionCardOption[];
  deny: readonly PermissionCardOption[];
  unsupported: readonly PermissionCardOption[];
  valid: boolean;
}>;

/**
 * Preserve the host's exact identifiers and ordering. Unknown ACP kinds are never
 * actionable. Invalid or duplicated identifiers invalidate the entire offer,
 * rather than risking a choice with ambiguous meaning.
 */
export function groupPermissionOptions(options: readonly PermissionCardOption[]): PermissionOptionGroups {
  const approve: PermissionCardOption[] = [];
  const deny: PermissionCardOption[] = [];
  const unsupported: PermissionCardOption[] = [];
  const seen = new Set<string>();

  for (const option of options) {
    if (
      !option ||
      typeof option.optionId !== "string" ||
      typeof option.name !== "string" ||
      typeof option.kind !== "string" ||
      option.optionId.trim().length === 0 ||
      option.name.trim().length === 0 ||
      seen.has(option.optionId)
    ) {
      return { approve: [], deny: [], unsupported: [], valid: false };
    }
    seen.add(option.optionId);
    switch (option.kind) {
      case "allow_once":
      case "allow_always":
        approve.push(option);
        break;
      case "reject_once":
      case "reject_always":
        deny.push(option);
        break;
      default:
        unsupported.push(option);
    }
  }

  return { approve, deny, unsupported, valid: true };
}

/** Unrecognized, absent, duplicate, or expired offers never become approval. */
export function canChoosePermissionOption(
  options: readonly PermissionCardOption[],
  phase: PermissionCardPhase,
  deadlineAt: number,
  now: number,
  optionId: string,
): boolean {
  if (phase !== "pending" || !Number.isFinite(now) || !Number.isFinite(deadlineAt) || now >= deadlineAt) {
    return false;
  }
  const groups = groupPermissionOptions(options);
  if (!groups.valid) return false;
  return groups.approve.some(option => option.optionId === optionId)
    || groups.deny.some(option => option.optionId === optionId);
}

/**
 * Use the same eligibility gate from the component's press handler and in tests.
 * Never derive an ID from a displayed label, positional index, or ACP kind.
 */
export function dispatchPermissionChoice(
  options: readonly PermissionCardOption[],
  phase: PermissionCardPhase,
  deadlineAt: number,
  now: number,
  optionId: string,
  onChoose: (optionId: string) => void,
): boolean {
  if (!canChoosePermissionOption(options, phase, deadlineAt, now, optionId)) return false;
  onChoose(optionId);
  return true;
}

/** Relative deadline, recomputed by the view. Invalid timestamps fail closed. */
export function formatPermissionDeadline(deadlineAt: number, now: number): string {
  if (!Number.isFinite(deadlineAt) || !Number.isFinite(now)) return "Deadline unavailable";
  if (now >= deadlineAt) return "Decision window expired";
  const seconds = Math.ceil((deadlineAt - now) / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return "Expires in " + minutes + ":" + remainder;
}

/** Distinguishes local expiry from a confirmed host denial or grant. */
export function permissionStatus(phase: PermissionCardPhase, deadlineAt: number, now: number): string {
  switch (phase) {
    case "allowed":
      return "Allowed · confirmed by host";
    case "denied":
      return "Denied · confirmed by host";
    case "timeout":
      return "Denied: timed out";
    case "deciding":
      return "Decision sent · awaiting host confirmation";
    case "expired":
      return "Decision expired · awaiting host denial";
    case "pending":
      return !Number.isFinite(deadlineAt) || !Number.isFinite(now) || now >= deadlineAt
        ? "Decision expired · awaiting host denial"
        : "Waiting for your decision";
  }
}
