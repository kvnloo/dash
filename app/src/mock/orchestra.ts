/** Demo orchestration graphs — products/projects linking bots and chats. */
export interface OrchestraProject {
  id: string;
  name: string;
  subtitle: string;
  agents: string[];
  chatIds: string[];
  status: "active" | "idle" | "paused";
  updatedAt: number;
}

const now = Date.now();

export const DEMO_ORCHESTRAS: OrchestraProject[] = [
  {
    id: "orch-dash",
    name: "Dash",
    subtitle: "Phone ↔ laptop agent bridge",
    agents: ["omp", "codex", "hermes"],
    chatIds: ["demo-omp", "demo-codex"],
    status: "active",
    updatedAt: now - 2 * 60_000,
  },
  {
    id: "orch-mesh",
    name: "Hermes mesh",
    subtitle: "groot · chiefstaff node 0",
    agents: ["hermes", "grok"],
    chatIds: [],
    status: "idle",
    updatedAt: now - 6 * 60 * 60_000,
  },
  {
    id: "orch-auth",
    name: "Auth refactor",
    subtitle: "login.ts · 401 path",
    agents: ["omp"],
    chatIds: ["demo-omp"],
    status: "active",
    updatedAt: now - 45 * 60_000,
  },
];
