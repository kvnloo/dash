import type { HarnessInfo } from "../../../shared/protocol";
import { claude } from "./claude";
import { codex } from "./codex";
import { grok } from "./grok";
import { hermes } from "./hermes";
import { omp } from "./omp";
import type { Harness } from "./types";

const ALL: readonly Harness[] = [omp, claude, codex, grok, hermes];

export function findHarness(id: string): Harness | undefined {
  return ALL.find((h) => h.id === id);
}

export function listHarnesses(): HarnessInfo[] {
  return ALL.map((h) => ({ id: h.id, name: h.name, available: Bun.which(h.bin) !== null }));
}
