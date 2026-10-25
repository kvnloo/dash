import type { AgentInfo, HarnessInfo, HostInfo } from "../../../shared/protocol";
import type { TreeNode } from "./tree";
import { chatKind } from "./roster";

/** Routing identity is opaque. In particular, agent.id is not agent.profileId. */
export interface TargetRoute {
  readonly hostId: string;
  readonly harness: string;
  readonly profileId: string;
  readonly sessionId?: string;
  readonly cwd?: string;
}

/** Must come from authenticated, session-scoped host context; never from a default. */
export interface CurrentTarget extends TargetRoute {
  readonly modelId?: string;
  readonly providerId?: string;
}

/** Each choice is an authenticated, exact-session option, not a model catalog guess. */
export interface TargetModelChoice {
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
  readonly hostId: string;
  readonly harness: string;
  /** Exact AgentInfo.id used for routing, not the cosmetic Hermes profile name. */
  readonly profileId: string;
  readonly sessionId: string;
  /** True only when the host exposes an authorized model-change operation. */
  readonly selectable: boolean;
  readonly reason?: string;
}

export interface TargetSwitcherInventory {
  readonly hosts: readonly HostInfo[];
  /** Capabilities of the currently paired bridge only. */
  readonly harnesses: readonly HarnessInfo[];
  readonly models: readonly TargetModelChoice[];
  readonly current?: CurrentTarget;
}

export type TargetSwitchIntent =
  | { readonly kind: "target"; readonly route: TargetRoute }
  | { readonly kind: "model"; readonly route: TargetRoute; readonly modelId: string; readonly providerId: string };

export type TargetSwitchResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface TargetBadgeText {
  readonly primary: string;
  readonly secondary: string;
  readonly accessibilityLabel: string;
}

export interface TargetTree {
  readonly nodes: TreeNode[];
  readonly initialExpanded: string[];
}

const known = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

function optional(value: string | undefined): string | undefined {
  return known(value) ? value : undefined;
}

/** JSON tuple keys cannot alias when an opaque ID contains punctuation. */
export function targetTreeKey(...parts: string[]): string {
  return JSON.stringify(parts);
}

export function routeOf(host: HostInfo, harness: string, agent: AgentInfo): TargetRoute {
  const sessionId = optional(agent.sessionId);
  const cwd = optional(agent.cwd);
  return {
    hostId: host.id,
    harness,
    profileId: agent.id,
    ...(sessionId ? { sessionId } : {}),
    ...(cwd ? { cwd } : {}),
  };
}

export function sameTarget(left: TargetRoute | undefined, right: TargetRoute): boolean {
  return left !== undefined &&
    left.hostId === right.hostId &&
    left.harness === right.harness &&
    left.profileId === right.profileId &&
    left.sessionId === right.sessionId &&
    left.cwd === right.cwd;
}

/**
 * Do not treat a host listed by the roster as an authorized execution target.
 * The paired bridge supports only its own host. Re-check at the final action.
 */
export function targetSwitchProblem(inventory: TargetSwitcherInventory, intent: TargetSwitchIntent): string | undefined {
  const route = intent.route;
  if (!known(route.hostId) || !known(route.harness) || !known(route.profileId) ||
      (route.sessionId !== undefined && !known(route.sessionId)) ||
      (route.cwd !== undefined && !known(route.cwd))) {
    return "Missing exact target identity. Refresh the roster.";
  }

  const hosts = inventory.hosts.filter(host => host.id === route.hostId);
  if (hosts.length !== 1) return "Host is missing or ambiguous. Refresh the roster.";
  const host = hosts[0];
  if (!host) return "Host unavailable.";
  if (!host.self) return "Pair directly with this computer before switching hosts.";
  if (!host.online) return "This host is offline. Reconnect before switching.";

  const harnesses = inventory.harnesses.filter(harness => harness.id === route.harness);
  if (harnesses.length !== 1 || !harnesses[0]?.available) {
    return "Harness is unavailable or ambiguous on the paired host.";
  }

  const agents = host.agents.filter(agent =>
    agent.id === route.profileId &&
    chatKind(agent) === route.harness &&
    optional(agent.sessionId) === route.sessionId
  );
  if (agents.length !== 1) return "Profile or session is missing or ambiguous. Refresh the roster.";
  const agent = agents[0];
  if (!agent) return "Agent unavailable.";
  if (!known(agent.id) || (agent.sessionId !== undefined && !known(agent.sessionId))) {
    return "Malformed agent identity. Refresh the roster.";
  }
  if (optional(agent.cwd) !== route.cwd) {
    return "Session working directory changed. Reopen it from the roster.";
  }
  if (agent.status === "offline") return "This agent is offline.";
  if (agent.kind === "a2a" && !route.sessionId) {
    return "This A2A profile requires an exact live session.";
  }
  if (agent.id.startsWith("hermes:") && agent.id !== "hermes:default" &&
      !agent.id.startsWith("harness:") && !route.sessionId) {
    return "This Hermes profile requires an exact live session.";
  }

  if (intent.kind === "model") {
    if (!route.sessionId) return "Open an exact session before changing its model.";
    if (!known(intent.modelId) || !known(intent.providerId)) {
      return "Missing model or provider identity.";
    }
    const options = inventory.models.filter(model =>
      model.hostId === route.hostId &&
      model.harness === route.harness &&
      model.profileId === route.profileId &&
      model.sessionId === route.sessionId &&
      model.id === intent.modelId &&
      model.providerId === intent.providerId
    );
    if (options.length !== 1) return "Model choice is missing or ambiguous. Refresh the host models.";
    const model = options[0];
    if (!model || !known(model.id) || !known(model.providerId)) {
      return "Malformed model identity.";
    }
    if (!model.selectable) return optional(model.reason) ?? "Model switching is read-only on this host.";
  }
  return undefined;
}

/** The caller is the only authority for a switch; no local state is mutated optimistically. */
export async function requestTargetSwitch(
  inventory: TargetSwitcherInventory,
  intent: TargetSwitchIntent,
  commit: (value: TargetSwitchIntent) => TargetSwitchResult | Promise<TargetSwitchResult>,
): Promise<TargetSwitchResult> {
  const problem = targetSwitchProblem(inventory, intent);
  if (problem) return { ok: false, reason: problem };
  try {
    const result = await commit(intent);
    if (result.ok) return { ok: true };
    return { ok: false, reason: optional(result.reason) ?? "The host rejected the switch." };
  } catch {
    return { ok: false, reason: "Switch failed. Your existing session is unchanged." };
  }
}

export function targetBadgeText(inventory: TargetSwitcherInventory): TargetBadgeText {
  const current = inventory.current;
  if (!current) {
    return {
      primary: "Choose target",
      secondary: "Host · harness · profile · session · model unknown",
      accessibilityLabel: "Choose a host, harness, profile, session and model",
    };
  }
  const hostMatches = inventory.hosts.filter(host => host.id === current.hostId);
  const host = hostMatches.length === 1 ? hostMatches[0] : undefined;
  const harnessMatches = inventory.harnesses.filter(harness => harness.id === current.harness);
  const harness = harnessMatches.length === 1 ? harnessMatches[0] : undefined;
  const agents = host?.agents.filter(agent =>
    agent.id === current.profileId && chatKind(agent) === current.harness &&
    optional(agent.sessionId) === current.sessionId
  ) ?? [];
  const agent = agents.length === 1 ? agents[0] : undefined;
  const modelMatches = current.modelId && current.providerId ? inventory.models.filter(model =>
    model.hostId === current.hostId && model.harness === current.harness &&
    model.profileId === current.profileId && model.sessionId === current.sessionId &&
    model.id === current.modelId && model.providerId === current.providerId
  ) : [];
  const modelName = current.modelId
    ? (modelMatches.length === 1 ? optional(modelMatches[0]?.name) : undefined) ?? current.modelId
    : "Model unknown";
  const hostName = optional(host?.name) ?? ("Host " + current.hostId);
  const harnessName = optional(harness?.name) ?? current.harness;
  const profileName = optional(agent?.profileId) ?? current.profileId;
  const sessionName = current.sessionId ?? "New chat";
  const shortSession = sessionName.length > 24 ? sessionName.slice(0, 10) + "…" + sessionName.slice(-8) : sessionName;
  return {
    primary: harnessName + " · " + modelName,
    secondary: hostName + " / " + profileName + " / " + shortSession,
    accessibilityLabel: [
      "Switch target",
      "host " + hostName,
      "harness " + harnessName,
      "profile " + profileName,
      "session " + sessionName,
      "model " + modelName,
    ].join(", "),
  };
}

function noItems(id: string, label: string, detail?: string): TreeNode[] {
  return [{ id, kind: "note", label, detail }];
}

function choiceMatchesRoute(choice: TargetModelChoice, route: TargetRoute): boolean {
  return !!route.sessionId &&
    choice.hostId === route.hostId && choice.harness === route.harness &&
    choice.profileId === route.profileId && choice.sessionId === route.sessionId;
}

/** A host → harness → profile → session → model tree built only from reported identities. */
export function targetSwitcherTree(
  inventory: TargetSwitcherInventory,
  choose: (intent: TargetSwitchIntent) => void,
): TargetTree {
  const initialExpanded: string[] = [];
  const nodes: TreeNode[] = inventory.hosts.map((host, hostIndex): TreeNode => {
    const hostKey = targetTreeKey("host", host.id, String(hostIndex));
    const onHost = inventory.current?.hostId === host.id;
    if (onHost) initialExpanded.push(hostKey);
    const byHarness = new Map<string, AgentInfo[]>();
    for (const agent of host.agents) {
      if (!known(agent.id) || !known(agent.kind)) continue;
      const kind = chatKind(agent);
      const rows = byHarness.get(kind);
      if (rows) rows.push(agent);
      else byHarness.set(kind, [agent]);
    }
    if (host.self) {
      for (const harness of inventory.harnesses) {
        if (!byHarness.has(harness.id)) byHarness.set(harness.id, []);
      }
    }

    const harnessNodes: TreeNode[] = [...byHarness.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([harnessId, agents]): TreeNode => {
        const harnessKey = targetTreeKey("harness", host.id, String(hostIndex), harnessId);
        if (onHost && inventory.current?.harness === harnessId) initialExpanded.push(harnessKey);
        const harnessMatches = inventory.harnesses.filter(harness => harness.id === harnessId);
        const harnessName = harnessMatches.length === 1 ? harnessMatches[0]?.name ?? harnessId : harnessId;
        const byProfile = new Map<string, AgentInfo[]>();
        for (const agent of agents) {
          const profileName = optional(agent.profileId) ?? agent.id;
          const rows = byProfile.get(profileName);
          if (rows) rows.push(agent);
          else byProfile.set(profileName, [agent]);
        }

        const profileNodes: TreeNode[] = [...byProfile.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([profileName, sessions]): TreeNode => {
            const profileKey = targetTreeKey("profile", host.id, String(hostIndex), harnessId, profileName);
            if (onHost && inventory.current?.harness === harnessId &&
                sessions.some(agent => agent.id === inventory.current?.profileId)) {
              initialExpanded.push(profileKey);
            }

            const sessionNodes: TreeNode[] = sessions.map((agent, sessionIndex): TreeNode => {
              const route = routeOf(host, harnessId, agent);
              const routeIntent: TargetSwitchIntent = { kind: "target", route };
              const problem = targetSwitchProblem(inventory, routeIntent);
              const active = sameTarget(inventory.current, route);
              const sessionKey = targetTreeKey(
                "session", host.id, String(hostIndex), harnessId, profileName,
                agent.id, route.sessionId ?? "", route.cwd ?? "", String(sessionIndex),
              );
              if (active) initialExpanded.push(sessionKey);

              const modelNodes: TreeNode[] = inventory.models.filter(model => choiceMatchesRoute(model, route))
                .map((model, modelIndex): TreeNode => {
                  const intent: TargetSwitchIntent = {
                    kind: "model", route, modelId: model.id, providerId: model.providerId,
                  };
                  const modelProblem = targetSwitchProblem(inventory, intent);
                  const currentModel = active && inventory.current?.modelId === model.id &&
                    inventory.current?.providerId === model.providerId;
                  return {
                    id: targetTreeKey("model", sessionKey, model.providerId, model.id, String(modelIndex)),
                    kind: "note",
                    label: "Model · " + (optional(model.name) ?? model.id),
                    meta: currentModel ? "Current" : modelProblem ? "Read-only" : "Switch",
                    detail: modelProblem ?? ("Provider " + model.providerId + " · " + model.id),
                    onPress: modelProblem || currentModel ? undefined : () => choose(intent),
                  };
                });

              const childNodes: TreeNode[] = modelNodes.length ? modelNodes : noItems(
                targetTreeKey("models-unavailable", sessionKey),
                route.sessionId ? "No session-scoped model choices" : "Open a session to view models",
                "An authenticated host model inventory is required.",
              );
              return {
                id: sessionKey,
                kind: problem ? "note" : "session",
                label: route.sessionId ? agent.name : "New chat · " + agent.name,
                detail: problem ?? (route.sessionId ?? "Open a new session"),
                meta: active ? "Current" : problem ? "Unavailable" : "Open",
                status: agent.status,
                onPress: problem || active ? undefined : () => choose(routeIntent),
                children: childNodes,
              };
            });
            return {
              id: profileKey,
              kind: "note",
              label: "Profile · " + profileName,
              children: sessionNodes.length ? sessionNodes : noItems(
                targetTreeKey("no-sessions", profileKey),
                "No sessions reported",
              ),
            };
          });

        return {
          id: harnessKey,
          kind: "harness",
          label: harnessName,
          detail: harnessMatches.length !== 1 || !harnessMatches[0]?.available
            ? "Not available on this paired bridge"
            : undefined,
          children: profileNodes.length ? profileNodes : noItems(
            targetTreeKey("no-profiles", harnessKey), "No profiles reported",
          ),
        };
      });

    return {
      id: hostKey,
      kind: "host",
      label: optional(host.name) ?? host.id,
      status: host.online ? "available" : "offline",
      detail: !host.self ? "Remote host · pair directly to switch" : host.online ? "Paired host" : "Offline",
      children: harnessNodes.length ? harnessNodes : noItems(
        targetTreeKey("no-harnesses", hostKey), "No harnesses reported",
      ),
    };
  });

  if (nodes.length === 0) {
    nodes.push({
      id: targetTreeKey("empty"),
      kind: "note",
      label: "No hosts reported",
      detail: "Pair with a computer, then refresh the roster.",
    });
  }
  return { nodes, initialExpanded };
}
