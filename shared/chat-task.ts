/** A compact, extractive work label, not a generated claim about what the agent did. */
export const TASK_SOURCE_CHARS = 512;
const FOLLOW_UP = /^(?:yes|no|ok(?:ay)?|thanks(?: you)?|thank you|sounds good|continue|go ahead|do it|try again|proceed|go on|keep going)[.!?\s]*$/i;

export function taskFromPrompt(raw: string): string | undefined {
  const line = raw.slice(0, TASK_SOURCE_CHARS).split(/\r?\n/).map(part => part.trim())
    .find(part => part && !/^(?:```|~~~)/.test(part) && !FOLLOW_UP.test(part));
  if (!line) return undefined;
  const clause = line.replace(/^(?:[-*]\s+|#{1,6}\s+|please\s+)/i, "").trim();
  if (!clause || FOLLOW_UP.test(clause)) return undefined;
  const end = /[.!?](?=\s)/.exec(clause);
  const text = end ? clause.slice(0, end.index) : clause;
  return text.length <= 88 ? text : text.slice(0, 87).replace(/\s+\S*$/, "").trimEnd() + "…";
}
