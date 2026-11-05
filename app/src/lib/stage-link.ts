/**
 * artifact-stage links (kvnloo/artifact-stage): an ephemeral review served by
 * the host, e.g. `http://100.113.138.100:41873/#t=<review token>`.
 *
 * The token in the fragment is a per-review token. It dies with that review's
 * server and is never the Dash bootstrap credential. Accepted hosts are
 * loopback, the tailnet (100.64.0.0/10) or https. `dash://stage?url=…` wraps
 * one for deep links.
 */
const STAGE_RE = /\bhttps?:\/\/[\w.-]+(?::\d{2,5})?\/(?:\?[^\s#)]*)?#t=[a-f0-9]{16,64}\b/g;

function tailnetOrLocal(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1") return true;
  const m = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

export function isStageUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!/^#t=[a-f0-9]{16,64}$/.test(u.hash)) return false;
  return u.protocol === "https:" || (u.protocol === "http:" && tailnetOrLocal(u.hostname));
}

/** Stage URLs in a message, in order, without duplicates. */
export function stageLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(STAGE_RE)) if (isStageUrl(m[0]) && !out.includes(m[0])) out.push(m[0]);
  return out;
}

/** `dash://stage?url=<encoded>` → the stage URL, if valid. */
export function parseStageDeepLink(raw: string): string | null {
  const m = /^(?:dash|exp\+dash):\/\/stage\?(.*)$/.exec(raw) ?? /\/--\/stage\?(.*)$/.exec(raw);
  if (!m) return null;
  const url = new URLSearchParams(m[1]).get("url");
  return url && isStageUrl(url) ? url : null;
}

/** Tell the stage it runs inside Dash: decisions are recorded with channel "dash". */
export function forDash(url: string): string {
  const u = new URL(url);
  u.searchParams.set("channel", "dash");
  return u.toString();
}

export function stageLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || (u.protocol === "https:" ? 443 : 80)}`;
  } catch {
    return "stage";
  }
}
