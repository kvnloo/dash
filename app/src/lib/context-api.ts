import { parseContext, parsePlan, record } from "../../../shared/context";
import { executionToken } from "./bridge-auth";
import type { Settings } from "../model";

const USAGE_UNAVAILABLE = "usage unavailable on this bridge";

export async function fetchContextView(settings: Settings, harness: string, profile: string, session: string, signal?: AbortSignal, usage = false) {
  const url = `http://${settings.address}/chat/${usage ? "usage" : "context"}?profile=${encodeURIComponent(profile)}&session=${encodeURIComponent(session)}&harness=${encodeURIComponent(harness)}`;
  const request: RequestInit = { headers: { Authorization: `Bearer ${await executionToken(settings)}` }, signal };
  let response = await fetch(url, request);
  // Older bridges expose context but not usage: preserve real context data and mark quotas unavailable.
  const missingUsage = usage && (response.status === 404 || response.status === 501);
  if (missingUsage) {
    response = await fetch(url.replace("/chat/usage?", "/chat/context?"), request);
    if (response.status === 404 || response.status === 501) throw new Error(USAGE_UNAVAILABLE);
  }
  if (!response.ok) throw new Error(response.status === 401 ? "Context access denied. Reconnect this computer." : response.status === 404 ? "Context reading unavailable on this bridge/session." : "Could not read context. Retry when connected.");
  let value: unknown;
  try { value = await response.json(); }
  catch (cause) {
    if (missingUsage) throw new Error(USAGE_UNAVAILABLE);
    throw cause;
  }
  if (!record(value)) throw new Error(missingUsage ? USAGE_UNAVAILABLE : "Invalid context reading.");
  const context = parseContext(value.context);
  if (missingUsage && !context) throw new Error(USAGE_UNAVAILABLE);
  return {
    context: missingUsage && context ? { ...context, notes: [...context.notes, USAGE_UNAVAILABLE] } : context,
    plans: missingUsage || !Array.isArray(value.plans) ? [] : value.plans.flatMap((item: unknown) => { const plan = parsePlan(item); return plan ? [plan] : []; }),
    compactionSupported: value.compactionSupported === true,
  };
}
