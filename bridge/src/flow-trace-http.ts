/** Dev-only, authenticated collector. No input-path uploads or background polling. */
export function flowTraceHttp(enabled: boolean) {
  let latest = '{"calibration":null,"marks":[]}';
  return async (request: Request, authorized: boolean): Promise<Response | null> => {
    if (new URL(request.url).pathname !== "/debug/trace") return null;
    if (!enabled) return new Response("not found", { status: 404 });
    if (!authorized) return new Response("unauthorized", { status: 401 });
    if (request.method === "GET") return new Response(latest, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    const raw = await request.text();
    if (raw.length > 524288) return new Response("too large", { status: 413 });
    try {
      const value: unknown = JSON.parse(raw);
      if (!validDump(value)) return new Response("invalid trace", { status: 400 });
      latest = raw;
      return new Response(null, { status: 204 });
    } catch { return new Response("invalid trace", { status: 400 }); }
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finite(value: unknown): boolean { return typeof value === "number" && Number.isFinite(value); }
function validDump(value: unknown): boolean {
  if (!object(value) || !Array.isArray(value.marks) || value.marks.length > 2048) return false;
  const calibration = value.calibration;
  if (calibration !== null && (!object(calibration) || !finite(calibration.offsetMs) || !finite(calibration.uncertaintyMs))) return false;
  return value.marks.every((mark: unknown) => object(mark) && typeof mark.stage === "string" && mark.stage.length <= 64 &&
    typeof mark.trace_id === "string" && mark.trace_id.length <= 128 && finite(mark.at) && finite(mark.generation));
}
