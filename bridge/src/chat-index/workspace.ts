import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

const cache = new Map<string, { root?: string; until: number }>();

/** Resolve only an explicitly local cwd; a synced path belongs to its recording host. */
export function repositoryRoot(cwd: string | null | undefined): string | undefined {
  if (!cwd || !isAbsolute(cwd)) return undefined;
  const now = Date.now();
  const cached = cache.get(cwd);
  if (cached && cached.until > now) return cached.root;
  let root: string | undefined;
  try {
    let path = realpathSync(cwd);
    for (let depth = 0; depth < 32; depth++) {
      // Worktrees and submodules use a .git file instead of a directory.
      if (existsSync(join(path, ".git"))) { root = path; break; }
      const parent = dirname(path);
      if (parent === path) break;
      path = parent;
    }
  } catch { /* inaccessible or removed directory */ }
  if (cache.size >= 512) cache.clear();
  cache.set(cwd, { root, until: now + 30_000 });
  return root;
}
