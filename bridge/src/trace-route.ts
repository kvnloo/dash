import { collectTrace, traceRoots } from "./trace-collect";
import { createTraceHttpHandler } from "./trace-http";

/**
 * The whole live Trace route behind one call, so registering it in bridge/index.ts is two lines:
 *   const handleTrace = createTraceRoute({ authorize });
 *   const trace = await handleTrace(request); if (trace) return cors(trace);
 * Read-only: it never writes, shells out or starts anything.
 */
export function createTraceRoute(options: { authorize(request: Request): Promise<boolean>; collect?: () => Promise<unknown>; roots?: string[] }) {
  return createTraceHttpHandler({ authorize: options.authorize, collect: options.collect ?? (() => collectTrace()), roots: options.roots ?? traceRoots() });
}
