import { anthropicStreamParser } from "./anthropicStream";
import type { Harness } from "./types";

export const claude: Harness = {
  id: "claude",
  name: "Claude Code",
  bin: "claude",
  command({ prompt, sessionId }) {
    // cwd is applied by the spawner; claude has no --cwd flag.
    const args = [
      "claude",
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      "bypassPermissions",
    ];
    if (sessionId) args.push("--resume", sessionId);
    return args;
  },
  parser: anthropicStreamParser,
};
