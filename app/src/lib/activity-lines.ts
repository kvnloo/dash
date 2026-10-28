/**
 * The bridge's status lines for a turn ("Thinking", "Running terminal", ...), one per update, are
 * mostly repeats. Tally them by text in first-seen order: "Thinking ×4", "Running terminal ×3".
 */
export function collapseActivity(lines: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const text = line.trim();
    if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts].map(([text, count]) => count > 1 ? `${text} ×${count}` : text);
}
