import type { HistoryMessage } from "../../shared/protocol";

/** Auth before read, one native snapshot/second/identity, bounded shared cache. */
export function activityHttp(read: (profile: string, session: string) => HistoryMessage[], now = Date.now) {
  const cache = new Map<string, { at: number; body: string; etag: string }>();
  return (request: Request, authorized: boolean): Response | undefined => {
    const url = new URL(request.url);
    if (url.pathname !== "/hermes/activity") return;
    if (!authorized) return new Response("unauthorized", { status: 401 });
    if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
    const profile = url.searchParams.get("profile"); const session = url.searchParams.get("session");
    if (!profile || !session || profile.length > 1024 || session.length > 256) return new Response("invalid identity", { status: 400 });
    const key = `${profile}\0${session}`;
    let entry = cache.get(key);
    if (!entry || now() - entry.at >= 1000) {
      const body = JSON.stringify(read(profile, session));
      entry = { at: now(), body, etag: `"${Bun.hash(body).toString(16)}"` };
      cache.delete(key); cache.set(key, entry);
      if (cache.size > 32) { const first = cache.keys().next().value; if (first) cache.delete(first); }
    }
    const headers = { "Cache-Control": "no-store", ETag: entry.etag, "Content-Type": "application/json" };
    return request.headers.get("If-None-Match") === entry.etag ? new Response(null, { status: 304, headers }) : new Response(entry.body, { headers });
  };
}
