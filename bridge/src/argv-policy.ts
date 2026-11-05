export type ApprovalEnv = Record<string, string | undefined>;

const BYPASS_FLAGS: Record<string, readonly string[]> = {
  omp: ["--auto-approve", "--allow-home"],
  codex: ["--dangerously-bypass-approvals-and-sandbox"],
  grok: ["--always-approve"],
  claude: ["--permission-mode", "bypassPermissions"],
  hermes: ["--yolo"],
  pi: ["--approve"],
  fx: ["--full-access"],
};

export function approvalBypassEnabled(agent: string, env: ApprovalEnv = process.env): boolean {
  return env[`DASH_${agent.toUpperCase()}_APPROVAL_POLICY`] === "bypass";
}

export function approvalArgs(agent: string, env: ApprovalEnv = process.env): string[] {
  if (!approvalBypassEnabled(agent, env)) {
    if (agent === "claude") return ["--permission-mode", "default"];
    if (agent === "codex") return ["--sandbox", "read-only"];
    return [];
  }
  return [...(BYPASS_FLAGS[agent] ?? [])];
}
