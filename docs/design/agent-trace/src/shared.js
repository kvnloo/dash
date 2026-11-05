/* Dash agent-trace prototypes: data model shared by all four bets.
 * Input: the public-safe export (dash.agent-trace.proto/v0) inlined as #trace-data.
 * Everything here is derived; nothing is invented. Heuristics are named in D.heuristics. */
(function () {
  const D = JSON.parse(document.getElementById("trace-data").textContent);
  const PH = D.phase_names; // explore implement verify pr delegate
  const ms = (iso) => new Date(iso).getTime();
  const day0 = ms(D.window[0]);
  const tasks = D.tasks.map((t) => {
    const s = ms(t.start), e = ms(t.end);
    const events = t.events.map(([ts, tool, ph, dur, ok]) => ({ t: ts, tool: D.tool_names[tool], ph: PH[ph], dur: dur ?? 0, ok }));
    return { ...t, s, e, events, run: t.run };
  });
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const runs = D.runs.map((r) => {
    const ts = r.tasks.map((id) => byId[id]).filter(Boolean);
    const s = Math.min(...ts.map((t) => t.s)), e = Math.max(...ts.map((t) => t.e));
    return { ...r, s, e, tasks: ts };
  });
  const owner = D.owner_turns.map((o) => ({ ...o, at: ms(o.t) }));

  // ---- formatting
  const pad = (n) => String(n).padStart(2, "0");
  function dur(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${pad(sec % 60)}s`;
    return `${Math.floor(sec / 3600)}h ${pad(Math.floor((sec % 3600) / 60))}m`;
  }
  const usd = (v) => (v == null ? "n/a" : v >= 100 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`);
  function tok(n) {
    if (n == null) return "n/a";
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
    return String(n);
  }
  const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const clockS = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const totalTok = (t) => (t.tokens ? t.tokens.input + t.tokens.output + t.tokens.cache_read + t.tokens.cache_write : 0);

  // ---- worker supervision states (z0intelligence FSM loop 2 vocabulary) + work-item phases (loop 1)
  // Dispatched -> Running (heartbeats) -> {Completed | Interrupted | Stalled} -> Resumed | Abandoned
  // Verifying / DraftPR are work-item phases read from what the worker was doing (tool+args heuristic).
  function states(t) {
    const total = (t.e - t.s) / 1000;
    const first = t.events.length ? t.events[0].t : total;
    const segs = [{ state: t.resume_of ? "Resumed" : "Dispatched", s: 0, e: Math.min(first, total) }];
    let cur = first;
    const marks = [];
    for (const st of t.stalls) marks.push({ state: "Stalled", s: st.s, e: st.e });
    for (const b of t.bands) {
      if (b.phase === "verify") marks.push({ state: "Verifying", s: b.s, e: b.e });
      if (b.phase === "pr") marks.push({ state: "DraftPR", s: b.s, e: b.e });
    }
    marks.sort((a, b) => a.s - b.s);
    for (const m of marks) {
      if (m.s < cur) { if (m.e > cur && m.state !== "Stalled") { segs.push({ state: m.state, s: cur, e: m.e }); cur = m.e; } continue; }
      if (m.s > cur) segs.push({ state: "Running", s: cur, e: m.s });
      segs.push({ state: m.state, s: m.s, e: Math.min(m.e, total) });
      cur = Math.min(m.e, total);
    }
    if (cur < total) segs.push({ state: "Running", s: cur, e: total });
    const end = t.status === "completed" ? "Completed" : t.status === "interrupted" ? "Interrupted" : t.status === "running" ? "Running" : t.status;
    return { segs: segs.filter((x) => x.e > x.s || x.state === "Dispatched"), end };
  }
  const STATE_COLOR = { Dispatched: "var(--faint)", Resumed: "var(--prov)", Running: "var(--tertiary)", Stalled: "var(--warn)", Verifying: "var(--ok)", DraftPR: "var(--gold)", Completed: "var(--ok)", Interrupted: "var(--danger)" };

  // ---- signals (omp's "frustration" idea, recast for agents: where a worker is stuck)
  function signals(t) {
    let streak = 0, maxStreak = 0;
    const retries = {};
    let loops = 0;
    for (const e of t.events) {
      if (e.ok === 0) { streak++; maxStreak = Math.max(maxStreak, streak); retries[e.tool] = (retries[e.tool] || 0) + 1; if (retries[e.tool] === 3) loops++; }
      else if (e.ok === 1) { streak = 0; retries[e.tool] = 0; }
    }
    const stallS = t.stalls.reduce((a, s) => a + (s.e - s.s), 0);
    const longest = t.stalls.reduce((a, s) => Math.max(a, s.e - s.s), 0);
    const toolS = t.events.reduce((a, e) => a + e.dur, 0);
    return { errorStreak: maxStreak, retryLoops: loops, stallS, longestStall: longest, toolS, errRate: t.events.length ? t.errors / t.events.length : 0 };
  }

  // ---- "needs Kevin" queue: one decision per item, ranked by leverage
  const NEED = {
    device: { rank: 1, text: "Check it on the phone", why: "Worker says the result is on a device and was not checked by hand" },
    approve: { rank: 2, text: "Approve or hold", why: "Outward or irreversible step waits for the owner" },
    "review-pr": { rank: 3, text: "Review the draft PR", why: "Draft PR is open; only the owner merges" },
    verify: { rank: 4, text: "Look at unverified evidence", why: "Worker reports something unverified or still failing" },
    credential: { rank: 5, text: "Sign in", why: "Needs a login, token or 2FA" },
    blocked: { rank: 6, text: "Unblock", why: "Worker reported it is blocked" },
  };
  const needs = [];
  for (const t of tasks) {
    const cats = (t.needs_owner || []).filter((c) => NEED[c]).sort((a, b) => NEED[a].rank - NEED[b].rank);
    if (cats.length) needs.push({ task: t, cat: cats[0], all: cats, ...NEED[cats[0]], at: t.e });
  }
  needs.sort((a, b) => a.rank - b.rank || b.at - a.at);

  // ---- tool aggregates
  function toolStats(list) {
    const m = {};
    for (const t of list) for (const e of t.events) {
      const r = (m[e.tool] ||= { tool: e.tool, calls: 0, errors: 0, total: 0, max: 0 });
      r.calls++; if (e.ok === 0) r.errors++; r.total += e.dur; r.max = Math.max(r.max, e.dur);
    }
    return Object.values(m).sort((a, b) => b.total - a.total);
  }

  function summary(list) {
    const s = Math.min(...list.map((t) => t.s)), e = Math.max(...list.map((t) => t.e));
    const agent = list.reduce((a, t) => a + (t.e - t.s) / 1000, 0);
    const toolS = list.reduce((a, t) => a + t.events.reduce((b, x) => b + x.dur, 0), 0);
    const stall = list.reduce((a, t) => a + t.stalls.reduce((b, x) => b + (x.e - x.s), 0), 0);
    const calls = list.reduce((a, t) => a + t.events.length, 0);
    const errors = list.reduce((a, t) => a + t.errors, 0);
    const cost = list.reduce((a, t) => a + (t.cost_usd || 0), 0);
    const tokens = list.reduce((a, t) => a + totalTok(t), 0);
    const st = { completed: 0, interrupted: 0, running: 0 };
    for (const t of list) st[t.status] = (st[t.status] || 0) + 1;
    // wall = union of task intervals (idle between runs excluded)
    const iv = list.map((t) => [t.s, t.e]).sort((a, b) => a[0] - b[0]);
    let wall = 0, cs = -1, ce = -1;
    for (const [a, b] of iv) { if (a > ce) { if (ce > cs) wall += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); }
    if (ce > cs) wall += ce - cs;
    return { s, e, span: (e - s) / 1000, wall: wall / 1000, agent, toolS, stall, calls, errors, cost, tokens, st, n: list.length };
  }

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v; else if (k === "style") n.style.cssText = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  const svg = (tag, attrs) => { const n = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v); return n; };
  const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem("dash-trace:" + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem("dash-trace:" + k, JSON.stringify(v)); } catch {} } };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  window.TR = { D, tasks, byId, runs, owner, needs, NEED, day0, dur, usd, tok, clock, clockS, totalTok, states, STATE_COLOR, signals, toolStats, summary, el, svg, store, reduced, PH };
})();
