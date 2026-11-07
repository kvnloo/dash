export interface CommandSuggestion { name: string; description: string }
export interface SuggestionInventory { commands: CommandSuggestion[]; files: string[]; commandError?: string; fileError?: string }

export function parseCommands(raw: unknown): CommandSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap(item => {
    if (typeof item !== "object" || item === null) return [];
    const name = Reflect.get(item, "name");
    const description = Reflect.get(item, "description");
    if (typeof name !== "string" || !/^[a-zA-Z][\w-]*$/.test(name) || typeof description !== "string" || seen.has(name)) return [];
    seen.add(name);
    return [{ name, description }];
  });
}

export function parseSuggestionInventory(raw: unknown): SuggestionInventory {
  if (typeof raw !== "object" || raw === null || !Array.isArray(Reflect.get(raw, "commands")) || !Array.isArray(Reflect.get(raw, "files"))) throw new Error("Invalid suggestion inventory from bridge.");
  const files: unknown[] = Reflect.get(raw, "files");
  const seenFiles = new Set<string>();
  const commandError = Reflect.get(raw, "commandError");
  const fileError = Reflect.get(raw, "fileError");
  return { commands: parseCommands(Reflect.get(raw, "commands")), files: files.filter((item): item is string => {
    if (typeof item !== "string" || item.trim() === "" || seenFiles.has(item)) return false;
    seenFiles.add(item);
    return true;
  }), commandError: typeof commandError === "string" ? commandError : undefined, fileError: typeof fileError === "string" ? fileError : undefined };
}
