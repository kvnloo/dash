/**
 * InteractiveTile's accessible actions use the exact same commands as its
 * gesture wheel. Keep this module free of React Native so dispatch and action
 * availability can be verified without a device.
 */
export type TileCommand = {
  readonly id: string;
  readonly label: string;
  run(): void;
};

export type TileCopyState = "idle" | "copying" | "copied" | "failed";

type TileCommandInput = {
  onOpen(): void;
  onPin(): void;
  onCopy(): void;
  onDensity(): void;
  pinned: boolean;
  hasSummary: boolean;
  extras: readonly TileCommand[];
};

const RESERVED = new Set(["activate", "detail", "pin", "copy", "density"]);

export function buildTileCommands(input: TileCommandInput): TileCommand[] {
  const commands: TileCommand[] = [
    { id: "detail", label: "Detail", run: input.onOpen },
    { id: "pin", label: input.pinned ? "Unpin" : "Pin locally", run: input.onPin },
  ];
  if (input.hasSummary) commands.push({ id: "copy", label: "Copy summary", run: input.onCopy });
  commands.push({ id: "density", label: "Change density", run: input.onDensity });

  const seen = new Set(RESERVED);
  let extraCount = 0;
  for (const action of input.extras) {
    if (extraCount === 4) break;
    if (!action.id || action.id.trim() !== action.id || !action.label.trim() || seen.has(action.id)) continue;
    seen.add(action.id);
    commands.push(action);
    extraCount++;
  }
  return commands;
}

export function tileAccessibilityActions(commands: readonly TileCommand[]): { name: string; label: string }[] {
  return [
    { name: "activate", label: "Open detail" },
    ...commands.filter(action => action.id !== "detail").map(action => ({ name: action.id, label: action.label })),
  ];
}

/** A platform accessibility action always runs the same command as touch. */
export function dispatchTileAccessibilityAction(name: string, commands: readonly TileCommand[]): boolean {
  const id = name === "activate" ? "detail" : name;
  const action = commands.find(command => command.id === id);
  if (!action) return false;
  action.run();
  return true;
}

export function tileAccessibilityLabel(title: string, summary: string, pinned: boolean, copy: TileCopyState): string {
  const clean = (value: string) => value.trim().replace(/[.!?]+$/, "");
  const parts = [clean(title) || "Untitled tile", clean(summary) || "Summary unavailable"];
  if (pinned) parts.push("Pinned locally");
  if (copy === "copying") parts.push("Copying summary");
  if (copy === "copied") parts.push("Summary copied");
  if (copy === "failed") parts.push("Copy failed");
  return parts.join(". ") + ".";
}

/** Pinning is not selection, and opening a modal is not an expanded tile. */
export function tileAccessibilityState(copy: TileCopyState): { busy: boolean } {
  return { busy: copy === "copying" };
}
