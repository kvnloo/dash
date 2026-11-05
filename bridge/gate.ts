#!/usr/bin/env bun
import { projectFor } from "./src/gate/factory";
import { isGateProposal } from "../shared/gate";
import { GateStore } from "./src/gate/store";
import { GitHubRemote } from "./src/gate/github";
import { GateExecutor } from "./src/gate/executor";

const [command, arg, flag] = Bun.argv.slice(2);
const store = new GateStore(process.env.DASH_GATE_DIR);
try {
  let result: unknown;
  switch (command) {
    case "propose": {
      if (!arg) throw new Error("gate propose <proposal.json | ->");
      const input: unknown = JSON.parse(arg === "-" ? await Bun.stdin.text() : await Bun.file(arg).text());
      if (!isGateProposal(input)) throw new Error("Invalid proposal; see docs/upstream-gate.md and shared/gate.schema.json");
      projectFor(input.target.repo);
      result = await store.propose(input, await new GitHubRemote().rules(input.target.repo)); break;
    }
    case "list": result = store.list().filter(i => !arg || i.state === arg); break;
    case "show": if (!arg) throw new Error("gate show <id>"); result = await store.show(arg); break;
    case "approve": case "reject": case "edit": throw new Error("Only the owner in authenticated paired Dash may approve/reject/edit. Agents cannot approve their own proposals. Open Approvals in Dash.");
    case "post": {
      if (!arg) throw new Error("gate post <id> [--dry-run]");
      const dryRun = flag !== "--live";
      if (!dryRun && process.env.DASH_GATE_LIVE !== "1") throw new Error("Live execution not armed; DASH_GATE_LIVE=1 required in operator-owned executor");
      result = await new GateExecutor(store, new GitHubRemote()).post(arg, dryRun); break;
    }
    default: throw new Error("gate propose|list|show|approve|reject|edit|post (decisions are Dash-only; post defaults dry-run)");
  }
  console.log(JSON.stringify(result, null, 2));
} catch (e) { console.error(e instanceof Error ? e.message : "Gate failed"); process.exitCode = 1; }
