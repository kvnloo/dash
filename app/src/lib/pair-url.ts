export function parseDashConnectUrl(raw: string): { address: string; code: string } | null {
  try {
    const normalized = raw.includes("://") ? raw : `dash://${raw}`;
    const url = new URL(normalized.replace(/^dash:/, "http:"));
    const address = url.searchParams.get("address")?.trim();
    const code = url.searchParams.get("code")?.trim().toUpperCase();
    if (!address || !code || code.length !== 6) return null;
    return { address, code };
  } catch {
    return null;
  }
}
