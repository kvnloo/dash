/** Bot profile cards — Hermes subagents, Grok bots, harness personas. */
export interface BotProfile {
  id: string;
  harness: string;
  name: string;
  role: string;
  description: string;
  online: boolean;
}

export const DEMO_BOT_PROFILES: BotProfile[] = [
  {
    id: "omp-main",
    harness: "omp",
    name: "OMP",
    role: "Primary agent",
    description: "Full-capability coding agent on your laptop",
    online: true,
  },
  {
    id: "omp-scout",
    harness: "omp",
    name: "Scout",
    role: "Explore subagent",
    description: "Read-only codebase search and context gathering",
    online: true,
  },
  {
    id: "codex-main",
    harness: "codex",
    name: "Codex",
    role: "OpenAI CLI",
    description: "Codex harness for structured refactors",
    online: true,
  },
  {
    id: "grok-main",
    harness: "grok",
    name: "Grok",
    role: "xAI agent",
    description: "Fast reasoning and tool use via Grok CLI",
    online: true,
  },
  {
    id: "hermes-main",
    harness: "hermes",
    name: "Hermes",
    role: "Mesh coordinator",
    description: "Profiles, peer messaging, and agent orchestration",
    online: true,
  },
  {
    id: "hermes-groot",
    harness: "hermes",
    name: "groot",
    role: "Mesh peer · node 0",
    description: "Chiefstaff mesh — Zero context and Hermes desktop",
    online: true,
  },
  {
    id: "hermes-scout",
    harness: "hermes",
    name: "Scout",
    role: "Hermes subagent",
    description: "Compressed read-only exploration for handoff",
    online: true,
  },
  {
    id: "claude-main",
    harness: "claude",
    name: "Claude Code",
    role: "Anthropic CLI",
    description: "Install claude on laptop to enable",
    online: false,
  },
];
