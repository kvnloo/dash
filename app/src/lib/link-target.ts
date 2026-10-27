import { parseAppRouteLink, type AppRoute } from "./app-route-link";

/** A tap plan, not a side effect. Hosts decide how to open the classified target. */
export type LinkTarget =
  | { kind: "web"; url: string }
  | { kind: "app-route"; route: AppRoute }
  | { kind: "mailto"; url: string }
  | { kind: "file"; path: string; line?: number; column?: number }
  | { kind: "blocked"; reason: string };

// C0 controls and DEL only; printable ASCII must remain valid in paths and URLs.
const CONTROL = /[\x00-\x1f\x7f]/;
const APP_SCHEME = /^(?:dash|exp\+dash):/i;
const APP_URL = /^(?:dash|exp\+dash):\/\/[a-z]+\/?(?:[?#].*)?$/i;
const APP_PATH = /^\/--\/[a-z]+\/?(?:[?#].*)?$/i;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const UNSAFE = new Set(["javascript", "data", "vbscript", "intent", "content"]);

function blocked(reason: string): LinkTarget {
  return { kind: "blocked", reason };
}

function fileTarget(pathWithPosition: string): LinkTarget {
  const position = /:(\d+)(?::(\d+))?$/.exec(pathWithPosition);
  const path = position ? pathWithPosition.slice(0, position.index) : pathWithPosition;
  if (!path || CONTROL.test(path)) return blocked("Invalid file path");
  // Three or more numeric position segments cannot be interpreted unambiguously.
  if (position && /:\d+$/.test(path)) return blocked("Invalid file position");
  if (!position) return { kind: "file", path };

  const line = Number(position[1]);
  const column = position[2] === undefined ? undefined : Number(position[2]);
  if (!Number.isSafeInteger(line) || line < 1 ||
      (column !== undefined && (!Number.isSafeInteger(column) || column < 1))) {
    return blocked("Invalid file position");
  }
  return column === undefined
    ? { kind: "file", path, line }
    : { kind: "file", path, line, column };
}

function isRelativeFilePath(value: string): boolean {
  // An explicit dot segment is enough, even for extensionless files.
  if (/^(?:\.{1,2}\/)/.test(value) || /\/\.{1,2}(?:\/|$)/.test(value)) return true;
  // Otherwise require both a directory and a filename with an extension.
  const withoutPosition = value.replace(/:\d+(?::\d+)?$/, "");
  return /^[^/]+\/.+\/[^/]+\.[^/.]+$/.test(withoutPosition) ||
    /^[^/]+\/[^/]+\.[^/.]+$/.test(withoutPosition);
}

/** Classifies Markdown hrefs without navigation, file I/O or React Native imports. */
export function classifyLink(href: string): LinkTarget {
  if (typeof href !== "string") return blocked("Invalid link");
  const value = href.trim();
  if (!value) return blocked("Empty link");
  if (CONTROL.test(value)) return blocked("Invalid link");

  if (/^https?:/i.test(value)) {
    if (!/^https?:\/\//i.test(value)) return blocked("Invalid web URL");
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || !url.hostname) return blocked("Invalid web URL");
      return { kind: "web", url: value };
    } catch {
      return blocked("Invalid web URL");
    }
  }

  // Reserve Expo's route marker even in malformed/prefixed links: never open
  // an attempted app route as a local file just because it starts with '/'.
  if (APP_SCHEME.test(value) || (value.startsWith("/") && value.includes("/--/"))) {
    if (!APP_URL.test(value) && !APP_PATH.test(value)) return blocked("Unknown app route");
    const route = parseAppRouteLink(value);
    return route ? { kind: "app-route", route } : blocked("Unknown app route");
  }

  if (/^mailto:/i.test(value)) return { kind: "mailto", url: value };

  if (/^file:/i.test(value)) {
    if (!/^file:\/\//i.test(value)) return blocked("Invalid file URL");
    try {
      const url = new URL(value);
      if (url.protocol !== "file:" || url.username || url.password ||
          (url.hostname && url.hostname.toLowerCase() !== "localhost") ||
          url.search || url.hash) return blocked("Invalid file URL");
      const path = decodeURIComponent(url.pathname);
      return path.startsWith("/") ? fileTarget(path) : blocked("Invalid file URL");
    } catch {
      return blocked("Invalid file URL");
    }
  }

  const scheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  if (scheme) return blocked(UNSAFE.has(scheme) ? "Unsafe link scheme" : "Unsupported link scheme");
  if (value.startsWith("//")) return blocked("Protocol-relative link");
  if (value.startsWith("/") || value.startsWith("~/") || isRelativeFilePath(value)) {
    return fileTarget(value);
  }
  return blocked("Unrecognized link");
}

export function linkAccessibilityHint(target: LinkTarget): string {
  switch (target.kind) {
    case "web": return "Opens in browser";
    case "app-route": return "Opens Dash " + target.route;
    case "mailto": return "Opens email app";
    case "file": return "Opens file preview";
    case "blocked": return "Link blocked";
  }
}
