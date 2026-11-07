declare global {
  interface Window {
    __dashReloads?: number;
  }
}

/** Observable web-army reload, without navigating away or resetting its bridge. */
export function reloadApp(): void {
  if (typeof window !== "undefined") window.__dashReloads = (window.__dashReloads ?? 0) + 1;
}
