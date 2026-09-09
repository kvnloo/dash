/** Debug override mode — bypass bridge, seed UI, programmatic control. */
export function isDebugMode(): boolean {
  return process.env.EXPO_PUBLIC_DEBUG === "1";
}

export function debugAutoNav(): boolean {
  return process.env.EXPO_PUBLIC_DEBUG_AUTONAV !== "0";
}

export function debugScenarioFromEnv(): string | undefined {
  const raw = process.env.EXPO_PUBLIC_DEBUG_SCENARIO?.trim();
  return raw || undefined;
}

export function debugShowBanner(): boolean {
  return process.env.EXPO_PUBLIC_DEBUG_BANNER === "1";
}

/** Web-only: read ?debug=1&scenario=… from the page URL. */
export function readWebDebugParams(): { enabled: boolean; scenario?: string; autoNav: boolean } {
  let search: string | undefined;
  try {
    const loc = typeof window === "undefined" ? undefined : window.location;
    search = loc && typeof loc === "object" ? String(loc.search ?? "") : undefined;
    if (search === "") search = undefined;
  } catch {
    return { enabled: false, autoNav: true };
  }
  if (typeof search !== "string") {
    return { enabled: false, autoNav: true };
  }
  const params = new URLSearchParams(search);
  const enabled = isDebugMode() || params.get("debug") === "1";
  const scenario = params.get("scenario")?.trim() || undefined;
  const autoNav = params.get("autonav") !== "0";
  return { enabled, scenario, autoNav };
}
