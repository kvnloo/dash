/** Only recognize explicit leading reasoning tags, never tags inside code or prose. */
export function splitThinking(source: string): { text: string; thinking: string } {
  const match = /^\s*<(think|thinking)>([\s\S]*?)(?:<\/\1>([\s\S]*)|$)/.exec(source);
  return match ? { text: (match[3] ?? "").trimStart(), thinking: match[2] ?? "" } : { text: source, thinking: "" };
}
/** Keep actual bridge status text, not a synthesized tool result. */
export function appendActivity(previous: readonly string[] = [], text: string): string[] {
  if (!text.trim() || previous.at(-1) === text) return [...previous];
  return [...previous.slice(-31), text];
}
