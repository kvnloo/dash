import { TextTracker, type Harness, type HarnessEvent } from "./types";

const SESSION_LINE = /^session_id:\s*(\S+)\s*$/;
const NOISE = /^(Warning:|⚠)/;

/** Hermes Agent: `hermes chat -q -Q` prints the final answer, then `session_id: …`. */
export const hermes: Harness = {
  id: "hermes",
  name: "Hermes",
  bin: "hermes",
  command({ prompt, sessionId, cwd }) {
    const args = ["hermes", "chat", "-Q", "--yolo", "--in", cwd];
    if (sessionId) args.push("--resume", sessionId);
    args.push("-q", prompt);
    return args;
  },
  parser(emit: (event: HarnessEvent) => void) {
    const text = new TextTracker(emit);
    const lines: string[] = [];
    // The session line is printed on stderr in quiet mode; accept it from either stream.
    const session = (line: string): boolean => {
      const match = SESSION_LINE.exec(line);
      if (match?.[1]) emit({ kind: "session", sessionId: match[1] });
      return match !== null;
    };
    return {
      stdout(line) {
        if (session(line) || NOISE.test(line)) return;
        lines.push(line);
      },
      stderr(line) {
        session(line);
      },
      end() {
        text.block(lines.join("\n").trim());
      },
    };
  },
};
