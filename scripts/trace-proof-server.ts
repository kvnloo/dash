/** Owned read-only proof server. Never starts/restarts the shared bridge. */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { collectTrace, traceRoots } from "../bridge/src/trace-collect";
import { createTraceHttpHandler } from "../bridge/src/trace-http";
import { bearerToken, secretMatches } from "../bridge/src/bridge-security";
const host = process.argv[2], tokenFile = process.argv[3];
if (!host || !tokenFile) throw new Error("Pass tailnet bind IP and owned private temporary token-file path");
const token = randomBytes(32).toString("hex");
writeFileSync(tokenFile, token, { mode: 0o600, flag: "wx" });
const handle = createTraceHttpHandler({ authorize: async r => secretMatches(bearerToken(r), token), collect: () => collectTrace(), roots: traceRoots() });
const server = Bun.serve({ hostname: host, port: 4889, fetch: async r => await handle(r) ?? new Response("not found", { status: 404 }) });
console.log(`Owned read-only trace proof server ${server.hostname}:${server.port}; token kept private`);
