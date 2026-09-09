/** Laptop-side resources surfaced via `/skill`, `/plugin`, `/tool`, `/file`. */

export interface NamedResource {
  id: string;
  name: string;
  description: string;
  harness?: string;
}

export interface FileResource {
  id: string;
  path: string;
  description: string;
}

export const DEMO_SKILLS: NamedResource[] = [
  {
    id: "poteto-mode",
    name: "poteto-mode",
    description: "Routing and style guide for poteto agent sessions",
    harness: "omp",
  },
  {
    id: "scout",
    name: "scout",
    description: "Read-only codebase exploration and compressed handoff",
    harness: "omp",
  },
  {
    id: "reviewer",
    name: "reviewer",
    description: "Quality and security review specialist",
    harness: "omp",
  },
  {
    id: "security-review",
    name: "security-review",
    description: "Evidence-backed vulnerability discovery",
    harness: "omp",
  },
];

export const DEMO_PLUGINS: NamedResource[] = [
  {
    id: "linear",
    name: "Linear MCP",
    description: "Issues, diffs, and project updates from Linear",
    harness: "omp",
  },
  {
    id: "pi-agent",
    name: "pi-agent",
    description: "OMP tool bridge — edit, grep, hub, eval, browser",
    harness: "omp",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Repos, PRs, and Actions via gh wrapper",
    harness: "omp",
  },
];

export const DEMO_TOOLS: NamedResource[] = [
  { id: "read", name: "read", description: "Read files and images from the laptop workspace", harness: "omp" },
  { id: "edit", name: "edit", description: "Line-anchored patches and file writes", harness: "omp" },
  { id: "grep", name: "grep", description: "Ripgrep search across the repo", harness: "omp" },
  { id: "lsp", name: "lsp", description: "Rename, references, diagnostics via language servers", harness: "omp" },
  { id: "task", name: "task", description: "Spawn background subagents on the harness", harness: "omp" },
  { id: "hub", name: "hub", description: "Peer messaging and long-running process control", harness: "omp" },
];

export const DEMO_FILES: FileResource[] = [
  {
    id: "main-screen",
    path: "app/src/screens/MainScreen.tsx",
    description: "Global search home — bots, chats, products, resources",
  },
  {
    id: "global-search",
    path: "app/src/lib/global-search.ts",
    description: "Query parser and scoped result ranking",
  },
  {
    id: "bridge-pair",
    path: "bridge/pair.ts",
    description: "Sonic pairing and claim-key exchange",
  },
  {
    id: "protocol",
    path: "shared/protocol.ts",
    description: "WebSocket wire format between phone and bridge",
  },
  {
    id: "chat-screen",
    path: "app/src/screens/ChatScreen.tsx",
    description: "Harness chat with streaming turns",
  },
  {
    id: "readme",
    path: "README.md",
    description: "Dash setup — Tailscale, bridge, Expo",
  },
];
