import { expect, test } from "bun:test";
import { createSuggestionsHttpHandler } from "./suggestions-http";

const endpoint = "http://localhost/suggestions";

test("injected identity authorization serves inventory with no legacy token", async () => {
  const credential = "paired.identity.credential";
  const seenHeaders: string[] = [];
  const commandCalls: string[] = [];
  const fileCalls: string[] = [];
  const handler = createSuggestionsHttpHandler({
    token: "",
    cwd: process.cwd(),
    authorize: async request => {
      const authorization = request.headers.get("authorization") ?? "";
      seenHeaders.push(authorization);
      return authorization === `Bearer ${credential}`;
    },
    commands: async (harness, cwd) => {
      commandCalls.push(`${harness}:${cwd}`);
      return [{ name: "help", description: "Available command" }];
    },
    files: async cwd => {
      fileCalls.push(cwd);
      return ["app/App.tsx"];
    },
  });

  const response = await handler(new Request(`${endpoint}?harness=hermes`, {
    headers: { authorization: `Bearer ${credential}` },
  }));

  expect(response?.status).toBe(200);
  expect(await response?.json()).toEqual({
    commands: [{ name: "help", description: "Available command" }],
    files: ["app/App.tsx"],
  });
  expect(seenHeaders).toEqual([`Bearer ${credential}`]);
  expect(fileCalls).toHaveLength(1);
  expect(commandCalls).toEqual([`hermes:${fileCalls[0]}`]);
});

test("an injected denial overrides even a matching legacy token, before validation or file access", async () => {
  const calls: string[] = [];
  const handler = createSuggestionsHttpHandler({
    token: "legacy-secret",
    cwd: "not-an-absolute-working-directory",
    authorize: async () => { calls.push("authorize"); return false; },
    commands: async () => { calls.push("commands"); return []; },
    files: async () => { calls.push("files"); return []; },
  });

  for (const suffix of ["?harness=INVALID", "?cwd=relative/not-a-workspace"]) {
    const response = await handler(new Request(`${endpoint}${suffix}`, {
      headers: { authorization: "Bearer legacy-secret" },
    }));
    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({ error: "unauthorized" });
  }
  expect(calls).toEqual(["authorize", "authorize"]);
});

test("a throwing identity authorizer fails closed without resolving cwd or reading sources", async () => {
  const calls: string[] = [];
  const handler = createSuggestionsHttpHandler({
    token: "",
    cwd: "relative/not-a-workspace",
    authorize: async () => {
      calls.push("authorize");
      throw new Error("identity verification unavailable");
    },
    commands: async () => { calls.push("commands"); return []; },
    files: async () => { calls.push("files"); return []; },
  });

  const response = await handler(new Request(`${endpoint}?cwd=relative/not-a-workspace`, {
    headers: { authorization: "Bearer paired.identity.credential" },
  }));
  expect(response?.status).toBe(401);
  expect(await response?.json()).toEqual({ error: "unauthorized" });
  expect(calls).toEqual(["authorize"]);
});

test("legacy-only mode never authenticates an empty bearer against an empty token", async () => {
  const calls: string[] = [];
  const handler = createSuggestionsHttpHandler({
    token: "",
    cwd: "relative/not-a-workspace",
    commands: async () => { calls.push("commands"); return []; },
    files: async () => { calls.push("files"); return []; },
  });

  const requests = [
    new Request(endpoint),
    new Request(endpoint, { headers: { authorization: "Bearer " } }),
    new Request(endpoint, { headers: { authorization: "Bearer nonempty" } }),
  ];
  for (const request of requests) {
    const response = await handler(request);
    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({ error: "unauthorized" });
  }
  expect(calls).toEqual([]);
});

test("unrelated paths, methods, and harness validation retain their original behavior", async () => {
  const calls: string[] = [];
  const handler = createSuggestionsHttpHandler({
    token: "",
    cwd: process.cwd(),
    authorize: async () => { calls.push("authorize"); return true; },
    commands: async () => { calls.push("commands"); return []; },
    files: async () => { calls.push("files"); return []; },
  });

  expect(await handler(new Request("http://localhost/health"))).toBeNull();
  expect((await handler(new Request(endpoint, { method: "POST" })))?.status).toBe(405);
  expect((await handler(new Request(`${endpoint}?harness=INVALID`)))?.status).toBe(400);
  expect(calls).toEqual(["authorize", "authorize"]);
});
