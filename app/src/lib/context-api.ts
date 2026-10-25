import { parseContext, parsePlan, record } from "../../../shared/context";
import { executionToken } from "./bridge-auth";
import type { Settings } from "../model";
export async function fetchContextView(settings: Settings, harness: string, profile: string, session: string, signal?: AbortSignal, usage = false) {
  const url = `http://${settings.address}/chat/${usage ? "usage" : "context"}?profile=${encodeURIComponent(profile)}&session=${encodeURIComponent(session)}&harness=${encodeURIComponent(harness)}`;
  let response = await fetch(url, { headers: { Authorization: `Bearer ${await executionToken(settings)}` }, signal });
  if (usage && response.status === 404) {
    response = await fetch(url.replace("/chat/usage?", "/chat/context?"), { headers: { Authorization: `Bearer ${await executionToken(settings)}` }, signal });
  }
  if (!response.ok) throw new Error(response.status === 401 ? "Context access denied. Reconnect this computer." : response.status === 404 ? "Context reading unavailable on this bridge/session." : "Could not read context. Retry when connected.");
  const value: unknown = await response.json();
  if (!record(value)) throw new Error("Invalid context reading.");
  return { context: parseContext(value.context), plans: Array.isArray(value.plans) ? value.plans.flatMap(p => { const plan = parsePlan(p); return plan ? [plan] : []; }) : [], compactionSupported: value.compactionSupported === true };
}
