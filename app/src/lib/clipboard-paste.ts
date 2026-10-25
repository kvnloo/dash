/** A TextInput change is not a paste event: only inspect bulk insertions, never typing/deletion. */
export function clipboardInsertion(previous: string, next: string): { contentUri: boolean; withoutUri: string } | null {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let oldEnd = previous.length, newEnd = next.length;
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
  const inserted = next.slice(start, newEnd);
  if (inserted.length < 2) return null;
  const contentUri = /^content:\/\/[^\s]+$/i.test(inserted.trim());
  return { contentUri, withoutUri: contentUri ? next.slice(0, start) + next.slice(newEnd) : next };
}

/** Expo returns a data URL; File.write(base64) must not receive its MIME prefix. */
export function clipboardPng(data: string): { base64: string; size: number } | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  const base64 = match?.[1];
  if (!base64 || base64.length % 4 !== 0) return null;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return { base64, size: base64.length / 4 * 3 - padding };
}
