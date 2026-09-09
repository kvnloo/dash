import { anthropicStreamParser } from "./anthropicStream";
import type { Harness } from "./types";

export const grok: Harness = {
  id: "grok",
  name: "Grok",
  bin: "grok",
  command({ prompt, sessionId, cwd }) {
    const args = [
      "grok",
      "-p",
      prompt,
      "--output-format",
      "streaming-messages-json",
      "--include-partial-messages",
      "--always-approve",
      "--cwd",
      cwd,
    ];
    if (sessionId) args.push("--resume", sessionId);
    return args;
  },
  parser: anthropicStreamParser,
};
