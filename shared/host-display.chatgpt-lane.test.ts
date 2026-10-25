import { describe, expect, test } from "bun:test";
import { hostDisplayName } from "./host-display";
import { parseClientMessage, parseHosts, type HostInfo } from "./protocol";

function syntheticHost(overrides: Partial<HostInfo> = {}): HostInfo {
  return {
    id: "host:dash2-180/base",
    name: "Synthetic workstation",
    hostname: "workstation",
    online: true,
    self: false,
    agents: [],
    ...overrides,
  };
}

describe("host display label precedence and opaque route identity", () => {
  const examples = [
    {
      reason: "a DNS suffix and mixed case stay visible instead of being stripped",
      id: "host:dash2-180/dns",
      name: "Friendly machine",
      hostname: " \tGroot.TAILNET.ts.net. \n",
      expected: "Groot.TAILNET.ts.net.",
    },
    {
      reason: "a nonempty hostname wins even when it looks like a short ID",
      id: "host:dash2-180/short",
      name: "Friendly machine",
      hostname: "0",
      expected: "0",
    },
    {
      reason: "blank hostname falls back to the trimmed friendly name",
      id: "host:dash2-180/friendly",
      name: " \tWork laptop (blue) \n",
      hostname: " \t ",
      expected: "Work laptop (blue)",
    },
    {
      reason: "blank hostname and name fall back to the exact opaque routing ID",
      id: "host:dash2-180/Fallback%2FCase",
      name: "\n",
      hostname: "",
      expected: "host:dash2-180/Fallback%2FCase",
    },
    {
      reason: "display fallback never trims or case-folds a routing ID",
      id: "  Route:Case/180  ",
      name: " ",
      hostname: "\t",
      expected: "  Route:Case/180  ",
    },
    {
      reason: "a literal unknown hostname is not rewritten into an ID",
      id: "host:dash2-180/unknown-label",
      name: "Friendly machine",
      hostname: "unknown",
      expected: "unknown",
    },
    {
      reason: "the literal name null remains a string label, not a missing value",
      id: "host:dash2-180/name-null",
      name: " null ",
      hostname: "",
      expected: "null",
    },
  ];

  for (const example of examples) {
    test(example.reason, () => {
      const host = syntheticHost({
        id: example.id,
        name: example.name,
        hostname: example.hostname,
      });
      const before = { ...host, agents: [...host.agents] };
      const parsed = parseHosts([host]);
      expect(parsed).toBeDefined();
      if (!parsed) throw new Error("synthetic valid host was rejected");
      const parsedHost = parsed[0];
      if (!parsedHost) throw new Error("valid synthetic roster lost its host");
      expect(parsedHost).toBe(host);
      expect(hostDisplayName(parsedHost)).toBe(example.expected);
      expect(host).toEqual(before);
      expect(host.id).toBe(example.id);
    });
  }

  test("same-looking labels cannot merge two route identities or alter a session target", () => {
    const left = syntheticHost({
      id: "host:dash2-180/A",
      hostname: "shared.tailnet.ts.net",
      name: "Shared",
      agents: [{
        id: "agent:dash2-180/A",
        name: "omp",
        kind: "omp",
        status: "available",
        hostId: "host:dash2-180/A",
        profileId: "profile:dash2-180/A",
        sessionId: "session:dash2-180/A",
      }],
    });
    const right = syntheticHost({
      id: "host:dash2-180/B",
      hostname: "shared.tailnet.ts.net",
      name: "Shared",
      agents: [{
        id: "agent:dash2-180/B",
        name: "omp",
        kind: "omp",
        status: "running",
        hostId: "host:dash2-180/B",
        profileId: "profile:dash2-180/B",
        sessionId: "session:dash2-180/B%2Fopaque",
      }],
    });
    const roster = [left, right];
    const parsed = parseHosts(roster);
    expect(parsed).toBe(roster);
    if (!parsed) throw new Error("valid synthetic roster was rejected");

    expect(parsed.map(hostDisplayName)).toEqual([
      "shared.tailnet.ts.net",
      "shared.tailnet.ts.net",
    ]);
    expect(parsed.map(host => host.id)).toEqual([
      "host:dash2-180/A",
      "host:dash2-180/B",
    ]);
    const parsedRight = parsed[1];
    if (!parsedRight) throw new Error("valid synthetic roster lost its second host");
    const parsedRightAgent = parsedRight.agents[0];
    const rightAgent = right.agents[0];
    const leftAgent = left.agents[0];
    if (!parsedRightAgent || !rightAgent || !leftAgent) {
      throw new Error("synthetic host fixture lost its routing agent");
    }
    expect(parsedRightAgent.sessionId).toBe("session:dash2-180/B%2Fopaque");

    const request = {
      type: "chat",
      id: "turn:dash2-180/exact-route",
      harness: "omp",
      text: "synthetic request",
      hostId: right.id,
      profileId: rightAgent.profileId,
      sessionId: rightAgent.sessionId,
    };
    const routed = parseClientMessage(request);
    expect(routed?.type).toBe("chat");
    if (routed?.type !== "chat") throw new Error("valid synthetic chat was rejected");
    expect(routed.id).toBe(request.id);
    expect(routed.hostId).toBe("host:dash2-180/B");
    expect(routed.profileId).toBe("profile:dash2-180/B");
    expect(routed.sessionId).toBe("session:dash2-180/B%2Fopaque");
    expect(rightAgent.hostId).toBe(right.id);
    expect(leftAgent.sessionId).toBe("session:dash2-180/A");

    for (const field of ["hostId", "profileId", "sessionId"]) {
      for (const malformed of [null, 180, {}, []]) {
        expect(parseClientMessage({ ...request, [field]: malformed })).toBeNull();
      }
    }
    const untargeted = parseClientMessage({
      type: "chat",
      id: "turn:dash2-180/no-target",
      harness: "omp",
      text: "synthetic request without a target",
    });
    if (untargeted?.type !== "chat") throw new Error("valid untargeted chat was rejected");
    expect(untargeted.hostId).toBeUndefined();
    expect(untargeted.profileId).toBeUndefined();
    expect(untargeted.sessionId).toBeUndefined();
    expect(roster).toEqual([left, right]);
  });
});

describe("host display must only receive parsed HostInfo, not malformed input", () => {
  test("missing, null, scalar, object, and nested array rosters never synthesize hosts", () => {
    const malformedRosters: unknown[] = [
      undefined, null, false, 180, "workstation", {},
      [null], [undefined], [true], [180], ["host"], [{}], [[]],
    ];
    for (const raw of malformedRosters) {
      expect(parseHosts(raw)).toBeUndefined();
    }
    expect(parseHosts([])).toEqual([]);
  });

  test("missing or wrongly typed id, name or hostname cannot be rescued by a valid label", () => {
    const good = syntheticHost({
      id: "host:dash2-180/good",
      hostname: "valid.tailnet.ts.net",
      name: "Valid machine",
    });
    expect(parseHosts([good])).toEqual([good]);

    for (const field of ["id", "name", "hostname"]) {
      for (const invalid of [
        undefined, null, 180, true, [], ["claimed-host"], {},
        { trim: () => "pretend-valid" },
      ]) {
        const malformed: Record<string, unknown> = { ...good, [field]: invalid };
        expect(parseHosts([malformed])).toBeUndefined();
        expect(parseHosts([good, malformed])).toBeUndefined();
      }
    }
    expect(hostDisplayName(good)).toBe("valid.tailnet.ts.net");
    expect(good.id).toBe("host:dash2-180/good");
  });

  test("a missing identity is not inferred from a perfectly valid hostname", () => {
    const good = syntheticHost({ id: "host:dash2-180/reference" });
    const withoutId: Record<string, unknown> = { ...good };
    delete withoutId.id;
    expect(parseHosts([withoutId])).toBeUndefined();
    expect(parseHosts([{ ...good, id: null }])).toBeUndefined();
    expect(parseHosts([{ ...good, id: [] }])).toBeUndefined();
    expect(hostDisplayName(good)).toBe("workstation");
    expect(good.id).toBe("host:dash2-180/reference");
  });
});
