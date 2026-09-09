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
  if (typeof window === "undefined") {
    return { enabled: false, autoNav: true };
  }
  const params = new URLSearchParams(window.location.search);
  const enabled = isDebugMode() || params.get("debug") === "1";
  const scenario = params.get("scenario")?.trim() || undefined;
  const autoNav = params.get("autonav") !== "0";
  return { enabled, scenario, autoNav };
}
