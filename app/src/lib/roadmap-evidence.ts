export type RoadmapCheck = { id: string; label: string; status: "verified" | "failed" | "unknown"; receipt?: { label: string; url: string; revision: string }; note?: string };
export type RoadmapAsk = { id: string; title: string; ask: string; checks: readonly RoadmapCheck[]; blocker?: string };

/** Scope copied from project-artifacts/dash/roadmap/20261021/items.json; estimates discarded. */
const SCOPE: readonly (readonly [string, string, string])[] = [
  ["left-handed", "Left-handed mode", "can we add a left handed mode"],
  ["steer", "Steer instead of queue", "add a way to steer rather than just queue"],
  ["tool-details", "Descriptive tool calls", "make the tool calls more descriptive… add details"],
  ["motion", "Fast motion, no bounce", "the graph view is way too bouncy"],
  ["lab", "Lab: orb lag, sizing, tile gestures", "orbs lagging… radial wheel… double/triple tap"],
  ["easing", "Dev-server 500 / easing crash", "error in dash take a look"],
  ["turbo", "Turbo live preview", "fast reload in expo to just let me preview"],
  ["chat-cleanup", "Chat cleanup", "indicator showing up twice… cluttered"],
  ["voice-orb", "Big orb in voice mode", "mic… large version of the thinking orbs"],
  ["wrap", "Input bar wraps", "(from your screenshot)"],
  ["subagents", "Subagents in chat", "see all of the jobs… super compressed"],
  ["trace-menu", "Trace row long-press dropdown", "long press… should be related to the row"],
  ["trace-lag", "Trace open lag", "animation is very laggy as it opens"],
  ["mic", "Mic: keyboard-free STT + Telegram pill", "press and hold… pill… swipe up to live voice"],
  ["live-voice", "Live voice via z0live, Luna backend", "talk directly to u thru the app"],
  ["queued", "Merge queued messages", "merge all my queued messages into one"],
  ["completion", "Do / Not now completion (greened card)", "swipe it over… it just comes back"],
  ["orchestra", "Orchestra views that mean something", "spine constellation radial islands… no meaning"],
  ["context", "Context view", "dash doesn't have any way to show context view"],
  ["annotation", "S Pen annotation", "annotation mode so i can write and mark stuff up"],
  ["density", "Density dial + per-page filter + Zero card tuck", "information density filter… press and hold the dropdown"],
  ["bot-faces", "Bot faces per profile + omp/Tern input animation", "thinking orbs… the face of the bot"],
  ["agent-popup", "Agent popup: harness / approvals / model", "the other popup button"],
  ["trace-intent", "Trace: intent contract + validation + artifacts", "aodl intent contract & the validation"],
  ["attached", "Attached input bar + peek popup", "still shows me as attached to the session"],
  ["fanout", "ChatGPT-app fan-out (Turbo lane B)", "spawn x number of chatgpt conversations"],
  ["dogfood", "Turbo dogfood mode", "tell me exactly what feature we're testing"],
  ["video-ideas", "Ideas from the BniWael video", "pls see this video for inspo"],
  ["night-filter", "Night filter on sunrise/sunset", "just use sunrise & sunset"],
];

// Exact merge commits observed in turbo history on this resume, not inherited percent claims.
const ROLLED: Record<string, { pr: number; revision: string }> = {
  queued: { pr: 101, revision: "b6e3beeb5fa308ff25eaffeb46d9dbce5b7b978d" },
  completion: { pr: 99, revision: "c176019419e1f31f9e75672fe78be60bf4d9150d" },
  orchestra: { pr: 98, revision: "6058a835e6a47657fec5f3a40d1eca7e7f492f27" },
  context: { pr: 103, revision: "68167815c88439084b39e6b0a3b3da28d3a85456" },
  annotation: { pr: 110, revision: "324633991807839c2ebe93fcbf144bea24fcec22" },
};

export const ROADMAP_SOURCE = "2026-10-21 scope · evidence snapshot, not a live feed";
export const ROADMAP: readonly RoadmapAsk[] = SCOPE.map(([id, title, ask]) => {
  const rolled = ROLLED[id];
  return { id, title, ask, checks: [
    { id: "ancestry", label: "Preview ancestry receipt", status: rolled ? "verified" : "unknown", ...(rolled ? { receipt: { label: `PR #${rolled.pr} rollup · ${rolled.revision}`, revision: rolled.revision, url: `https://github.com/kvnloo/dash/commit/${rolled.revision}` } } : {}), note: "Ancestry is not behavior or phone verification." },
    { id: "tests", label: "Task-specific test receipt", status: "unknown" },
    { id: "render", label: "Real-data behavior/render receipt", status: "unknown" },
    { id: "review", label: "Parent acceptance review", status: "unknown" },
  ], ...(id === "density" ? { blocker: "Ownership hold: old Expo server serves density worktree on :8131. Native gestures and tuck still unverified." } : id === "bot-faces" ? { blocker: "Resumed isolated candidate. MBP gates and parent review required; not rolled out." } : {}) };
});

/** A pass without provenance never advances the bar. Counts are evidence coverage, not % done. */
export function evidenceCoverage(checks: readonly RoadmapCheck[]) {
  const verified = checks.filter(check => check.status === "verified" && check.receipt && check.receipt.url.length > 0 && check.receipt.revision.length > 0).length;
  return { verified, declared: checks.length, ratio: checks.length ? verified / checks.length : 0 };
}
