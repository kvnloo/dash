/* Dash agent trace, round 3.
 * Input: the frozen public-safe cohort (#trace-data) and the cached interpretation (#insights).
 * Measured facts render plainly; interpretation carries a READ tag. Nothing here is invented. */
(function () {
  "use strict";
  const D = JSON.parse(document.getElementById("trace-data").textContent);
  const I = JSON.parse(document.getElementById("insights").textContent);
  const VIEW = document.body.dataset.view;
  const app = document.getElementById("app");
  const H = 3600e3, M = 60e3;
  const ms = (s) => new Date(s).getTime();
  const NOW = ms(D.generated);
  const pad = (n) => String(n).padStart(2, "0");
  const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const dur = (sec) => { sec = Math.max(0, Math.round(sec)); if (sec < 60) return `${sec}s`; const m = Math.floor(sec / 60); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`; };
  const int = (n) => Math.round(n).toLocaleString("en-US");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
  const isPhone = () => window.innerWidth <= 760;

  // ---------------------------------------------------------------- model
  const tasks = D.tasks.map((t) => ({
    ...t, s: ms(t.start), e: t.status === "running" ? NOW : ms(t.end),
    ev: t.events.map(([ts, tool, , , ok]) => ({ t: ms(t.start) + ts * 1000, tool: D.tool_names[tool], ok })),
    stallS: t.stalls.reduce((a, s) => a + s.e - s.s, 0),
  }));
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const resumedBy = {};
  tasks.forEach((t) => { if (t.resume_of) resumedBy[t.resume_of] = t; });
  const runs = D.runs.map((r) => { const ts = r.tasks.map((id) => byId[id]); return { ...r, ts, s: Math.min(...ts.map((t) => t.s)), e: Math.max(...ts.map((t) => t.e)) }; });
  const owner = D.owner_turns.filter((o) => o.kind === "owner").map((o) => ({ ...o, at: ms(o.t) }));
  const letter = (t) => t.id.slice(-1);
  const recency = (t) => {
    if (t.status === "running") return "live";
    if (t.e >= NOW - 3 * H) return "recent";
    if (t.e >= NOW - 12 * H) return "earlier";
    if (t.status === "interrupted" && !resumedBy[t.id]) return "earlier";
    return "stale";
  };
  // interrupted workers that stopped within 10 minutes of each other are one cut moment
  const CUTS = (() => {
    const out = [];
    for (const t of tasks.filter((x) => x.status === "interrupted").sort((a, b) => a.e - b.e)) {
      const last = out[out.length - 1];
      if (last && t.e - last.t <= 10 * M) { last.ts.push(t); last.t = t.e; } else out.push({ t: t.e, ts: [t] });
    }
    return out;
  })();
  const ASK_WORD = { device: "device test", "review-pr": "PR review", approve: "approval", credential: "credential", verify: "verify", blocked: "blocked" };
  const totals = (ts) => ({
    n: ts.length, done: ts.filter((t) => t.status === "completed").length, cut: ts.filter((t) => t.status === "interrupted").length,
    live: ts.filter((t) => t.status === "running").length, asks: ts.filter((t) => t.needs_owner.length).length,
    calls: ts.reduce((a, t) => a + t.tool_calls, 0), errors: ts.reduce((a, t) => a + t.errors, 0), stall: ts.reduce((a, t) => a + t.stallS, 0),
    unresumed: ts.filter((t) => t.status === "interrupted" && !resumedBy[t.id]).length,
  });

  // ---------------------------------------------------------------- responses (local first, optional endpoint; R2 contract)
  const SHA = I.source_sha256 || "nosha";
  const KEY = `dash.trace.feedback.v1.${SHA}`, EKEY = "dash.trace.feedback.endpoint.v1";
  let records = [], endpoint = "";
  try {
    records = JSON.parse(localStorage.getItem(KEY) || "[]"); if (!Array.isArray(records)) records = [];
    const q = new URLSearchParams(location.search).get("feedback_endpoint");
    if (q) { const u = new URL(q); if (/^https?:$/.test(u.protocol) && !u.username && !u.password) localStorage.setItem(EKEY, q); }
    endpoint = localStorage.getItem(EKEY) || "";
  } catch { /* storage unavailable: responses live for this page only */ }
  const OUT = I.outcomes;
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(records)); } catch { /* keep in memory */ } paintResponses(); };
  const stateOf = (id) => { for (let i = records.length - 1; i >= 0; i--) { const r = records[i]; if (r.target === id && r.kind !== "ask") return r.kind === "clear" ? null : r.kind; } return null; };
  const lastAsk = (id) => { for (let i = records.length - 1; i >= 0; i--) if (records[i].target === id && records[i].kind === "ask") return records[i]; return null; };
  function addRecord(a, kind, text) {
    const r = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`, at: new Date().toISOString(),
      view: VIEW, target: a.id, kind, text: text || "", context: { title: a.title, outcome: OUT[a.outcome], why: a.why },
      interpretation_sha256: I.interpretation_sha256, delivery: endpoint ? "pending" : "local",
    };
    records.push(r); persist(); deliver(r);
  }
  async function deliver(r) {
    if (!endpoint) return;
    try {
      const res = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ schema: "dash.trace.feedback/v1", id: r.id, at: r.at, dataset_sha256: SHA, interpretation_sha256: r.interpretation_sha256, view: r.view, target: r.target, kind: r.kind, text: r.text, context: r.context, execution: "proposal_only" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json(); if (body.id !== r.id) throw new Error("ack mismatch");
      r.delivery = "sent";
    } catch { r.delivery = "failed"; }
    persist();
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify({ schema: "dash.trace.feedback.export/v1", exported: new Date().toISOString(), dataset_sha256: SHA, records }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `dash-trace-responses-${VIEW}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function paintResponses() {
    document.querySelectorAll(".responses").forEach((el) => {
      const n = records.length, pending = records.filter((r) => r.delivery !== "sent").length;
      el.innerHTML = `<span>${n ? `${n} response${n > 1 ? "s" : ""} saved in this browser${endpoint ? `, ${pending} not delivered` : ""}` : "Responses stay in this browser until you export them"}</span>${n ? '<button type="button" data-export>Export JSON</button>' : ""}`;
      const b = el.querySelector("[data-export]"); if (b) b.onclick = exportJson;
    });
  }
  function chip(a) {
    const el = document.createElement("div"); el.className = "chip"; el.dataset.action = a.id;
    let asking = false;
    const paint = () => {
      const st = stateOf(a.id), ask = lastAsk(a.id);
      el.classList.toggle("not-now", st === "not_now");
      el.innerHTML = `<div class="o">${esc(OUT[a.outcome])}</div><div class="t">${esc(a.title)}</div><div class="w">${esc(a.why)}</div>
        <div class="ctl"><button type="button" data-k="do" aria-pressed="${st === "do"}">Do</button><button type="button" data-k="not_now" aria-pressed="${st === "not_now"}">Not now</button><button type="button" data-k="ask" aria-pressed="${asking}" aria-label="Ask about this">?</button></div>
        ${asking ? '<form class="ask"><input name="q" aria-label="Question or context for this action" placeholder="Ask, or add context" autocomplete="off"><button type="submit">Send</button></form>' : ""}
        ${ask && !asking ? `<div class="said"><b>you</b>${esc(ask.text)}</div>` : ""}`;
      el.querySelectorAll(".ctl button").forEach((b) => (b.onclick = () => {
        const k = b.dataset.k;
        if (k === "ask") { asking = !asking; paint(); if (asking) el.querySelector("input").focus(); return; }
        addRecord(a, stateOf(a.id) === k ? "clear" : k); paint();
      }));
      const f = el.querySelector("form");
      if (f) f.onsubmit = (e) => { e.preventDefault(); const v = f.q.value.trim(); if (!v) return; addRecord(a, "ask", v); asking = false; paint(); };
    };
    paint(); return el;
  }
  function readStrip(read, actions) {
    const sec = document.createElement("section"); sec.className = "read";
    sec.innerHTML = `<p><span class="tag" title="Interpretation written from the measured numbers on this page. Not a measurement.">READ</span>${esc(read)}</p>`;
    if (actions && actions.length) { const c = document.createElement("div"); c.className = "chips"; actions.forEach((a) => c.append(chip(a))); sec.append(c); }
    const r = document.createElement("div"); r.className = "responses"; sec.append(r);
    return sec;
  }

  // ---------------------------------------------------------------- static fragments
  const html = (s) => { const t = document.createElement("template"); t.innerHTML = s.trim(); return t.content; };
  const header = (crumb, title, desc) => html(`<header><div class="crumb"><a href="index.html">dash / agent trace</a>&nbsp;&nbsp;${esc(crumb)}</div><h1>${esc(title)}</h1><p class="desc">${desc}</p></header>`);
  const strip = (cells) => html(`<div class="strip" style="--n:${cells.length}">${cells.map((c) => `<div class="cell ${c.c || ""}"><div class="k">${esc(c.k)}</div><div class="v">${c.v}</div>${c.s ? `<div class="s">${c.s}</div>` : ""}</div>`).join("")}</div>`);
  const sec = (title, hint, right) => html(`<div class="sec"><div><h2>${esc(title)}</h2>${hint ? `<div class="hint">${hint}</div>` : ""}</div>${right || ""}</div>`);
  const foot = (extra) => html(`<p class="foot"><b>Data</b> frozen cohort ${esc(D.window[0].slice(0, 10))}, generated ${esc(D.generated)}. ${esc(D.privacy)} <b>Labels</b> ${esc(D.heuristics.labels || "")} <b>Heuristics</b> stall: ${esc(D.heuristics.stall)}; asks: keyword classes over a worker's final summary. ${extra || ""}<br>__BUILD__</p>`);

  // ---------------------------------------------------------------- SVG pieces
  const DEFS = '<defs><pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.6" height="4" class="hatch"/></pattern></defs>';
  const diamond = (cx, cy, r = 4) => `<path class="f-you" d="M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z"/>`;
  const txt = (x, y, s, c = "t-3", anchor = "start") => `<text class="ann ${c}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(s)}</text>`;

  function taskSvg(t, X, y, h, o = {}) {
    const x0 = X(t.s), x1 = Math.max(X(t.e), x0 + 2), w = x1 - x0;
    let s = `<rect class="b-body${t.status === "running" ? " is-live" : ""}" x="${x0}" y="${y}" width="${w}" height="${h}" rx="1.5"/>`;
    // tool-call density: 4 px buckets, height = calls per minute (6/min = full)
    const BW = 4, nb = Math.max(1, Math.floor(w / BW)), bucket = (t.e - t.s) / nb, perMin = bucket / M;
    const cnt = new Array(nb).fill(0), err = new Array(Math.ceil(nb / 2)).fill(0);
    for (const e of t.ev) {
      const i = Math.min(nb - 1, Math.floor((e.t - t.s) / bucket)); if (i < 0) continue;
      cnt[i]++; if (e.ok === 0) err[i >> 1]++;
    }
    if (h >= 6) for (let i = 0; i < nb; i++) if (cnt[i]) {
      const bh = Math.max(1.5, Math.min(1, cnt[i] / perMin / 6) * (h - 3));
      s += `<rect class="f-tick" x="${x0 + i * BW + 1}" y="${y + h - 1.5 - bh}" width="2.4" height="${bh}"/>`;
    }
    for (const st of t.stalls) { const a = X(t.s + st.s * 1000), b = X(t.s + st.e * 1000); if (b - a >= 1) s += `<rect x="${a}" y="${y}" width="${b - a}" height="${h}" fill="url(#hatch)"/>`; }
    // failures: one 3 px mark per 8 px, above the bar, so neighbours never touch
    if (o.errors !== false) err.forEach((n, i) => { if (n) s += `<rect class="f-fail" x="${x0 + i * 8 + 2}" y="${y - 4.5}" width="3" height="3"/>`; });
    if (t.status === "interrupted") s += `<rect class="f-fail" x="${x1 - 1}" y="${y - 3}" width="2.2" height="${h + 6}"/>`;
    else if (t.status === "running") s += `<rect class="f-live" x="${x1 - 2}" y="${y - 3}" width="2.2" height="${h + 6}"/><circle class="f-live livedot" cx="${x1 + 6}" cy="${y + h / 2}" r="3"/>`;
    else if (t.needs_owner.length) s += diamond(x1 + 7, y + h / 2);
    return o.dim ? `<g opacity="0.42">${s}</g>` : s;
  }
  function packLanes(ts) {
    const lanes = [];
    for (const t of [...ts].sort((a, b) => a.s - b.s)) {
      let i = lanes.findIndex((end) => end <= t.s);
      if (i < 0) { i = lanes.length; lanes.push(0); }
      lanes[i] = t.e + 4 * M; t._lane = i;
    }
    return Math.max(1, lanes.length);
  }

  const stepFor = (k) => [15 * M, 30 * M, H, 2 * H, 4 * H].find((s) => s * k >= 64) || 4 * H;

  // ---------------------------------------------------------------- timeline component
  // Rows share one time scale. The label column is fixed (<= 30% on a phone); the plot scrolls
  // horizontally and pinches/ctrl-wheels to zoom. Opens scrolled to "now".
  function Timeline(host, o) {
    let zoom = 1;
    const wrap = document.createElement("div"); wrap.className = "tl";
    const labs = document.createElement("div"); labs.className = "labs";
    const sc = document.createElement("div"); sc.className = "scroll";
    wrap.append(labs, sc); host.append(wrap);
    let k = 0;
    function render(keep) {
      const avail = Math.max(120, sc.clientWidth);
      const span = o.t1 - o.t0, fit = (avail - o.padR) / span;
      const center = keep && k ? (sc.scrollLeft + sc.clientWidth / 2) / k + o.t0 : null;
      k = Math.max(fit, (isPhone() ? o.minPxHPhone : 0) / H) * zoom;
      const W = Math.ceil(span * k + o.padR), X = (t) => (t - o.t0) * k;
      let y = 0, body = "", lh = "";
      for (const r of o.rows) {
        r.y = y;
        lh += `<div class="lab ${r.cls || ""}${o.sel && r.id === o.sel ? " sel" : ""}" style="height:${r.h}px"${r.id ? ` data-id="${r.id}"` : ""}>${r.label || ""}</div>`;
        body += `<g transform="translate(0 ${y})">${r.draw ? r.draw(X, r.h, k, W) : ""}</g><line class="l-row" x1="0" x2="${W}" y1="${y + r.h - 0.5}" y2="${y + r.h - 0.5}"/>`;
        y += r.h;
      }
      const step = stepFor(k);
      let grid = "";
      for (let t = Math.ceil(o.t0 / step) * step; t <= o.t1; t += step) grid += `<line class="l-grid" x1="${X(t)}" x2="${X(t)}" y1="0" y2="${y}"/>`;
      grid += `<line class="l-now" x1="${X(NOW)}" x2="${X(NOW)}" y1="0" y2="${y}"/>`;
      labs.innerHTML = lh;
      sc.innerHTML = `<svg width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" role="img" aria-label="${esc(o.aria)}">${DEFS}${grid}${o.overlay ? o.overlay(X, y, o.rows) : ""}${body}</svg>`;
      labs.querySelectorAll(".lab[data-id]").forEach((el) => (el.onclick = () => o.onSelect && o.onSelect(el.dataset.id)));
      if (center != null) sc.scrollLeft = X(center) - sc.clientWidth / 2;
      else sc.scrollLeft = o.startAt ? X(o.startAt) : W;
      if (o.zoomEl) o.zoomEl.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.z) === zoom)));
      api.X = X; api.k = k;
    }
    const api = { render, setRows(rows, sel, t0, t1) { o.rows = rows; o.sel = sel; if (t0 != null) { o.t0 = t0; o.t1 = t1; o.overlay = o.overlayFor ? o.overlayFor(t0, t1) : o.overlay; } render(true); }, setZoom(z) { zoom = Math.min(8, Math.max(1, z)); render(true); }, get zoom() { return zoom; } };
    if (o.zoomEl) {
      o.zoomEl.innerHTML = [1, 2, 4].map((z) => `<button type="button" data-z="${z}">${z === 1 ? "fit" : z + "×"}</button>`).join("");
      o.zoomEl.querySelectorAll("button").forEach((b) => (b.onclick = () => api.setZoom(Number(b.dataset.z))));
    }
    let d0 = 0, z0 = 1, raf = 0;
    const dist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    sc.addEventListener("touchstart", (e) => { if (e.touches.length === 2) { d0 = dist(e); z0 = zoom; } }, { passive: true });
    sc.addEventListener("touchmove", (e) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      const z = z0 * dist(e) / d0; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => api.setZoom(z));
    }, { passive: false });
    sc.addEventListener("touchend", () => { d0 = 0; });
    sc.addEventListener("wheel", (e) => { if (!e.ctrlKey) return; e.preventDefault(); api.setZoom(zoom * (e.deltaY < 0 ? 1.25 : 0.8)); }, { passive: false });
    let rt = 0; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => render(true), 120); });
    render(false);
    return api;
  }
  const axisRow = (label = "") => ({
    h: 28, cls: "head", label,
    draw: (X, h, k) => {
      const step = stepFor(k);
      let s = "";
      for (let t = Math.floor(NOW / H) * H - 30 * H; t <= NOW + 2 * H; t += step) { const x = X(t); if (x > 2) s += `<text class="ax" x="${x + 4}" y="${h - 9}">${clock(t)}</text>`; }
      s += `<text class="ax t-live" x="${X(NOW) + 4}" y="${h - 20}">now ${clock(NOW)}</text>`;
      return s;
    },
  });
  const cutsRow = (from, to) => ({
    h: 36, cls: "head", label: "cut moments",
    draw: (X, h) => {
      let s = "", lastEnd = -1e9;
      for (const c of CUTS.filter((x) => x.t >= from && x.t <= to)) {
        const x = X(c.t), nudge = x + 5 < lastEnd + 6 ? lastEnd + 6 - (x + 5) : 0;
        s += `<rect class="f-fail" x="${x - 1}" y="5" width="2.2" height="${h - 9}"/>${txt(x + 5 + nudge, 15, `${c.ts.length} cut`, "t-fail")}${txt(x + 5 + nudge, 29, clock(c.t), "t-3")}`;
        lastEnd = x + 5 + nudge + 38;
      }
      return s;
    },
  });
  const cutLines = (from, to, y0) => (X, y) => CUTS.filter((c) => c.t >= from && c.t <= to).map((c) => `<line class="l-cut" x1="${X(c.t)}" x2="${X(c.t)}" y1="${y0}" y2="${y}"/>`).join("");

  // ---------------------------------------------------------------- A: trace
  function viewA() {
    const all = totals(tasks);
    const live = tasks.filter((t) => t.status === "running");
    app.append(header("A · trace", "What happened, and what is still open",
      `${clock(Math.min(...tasks.map((t) => t.s)))} to ${clock(NOW)} · <b>${runs.length}</b> dispatches, <b>${tasks.length}</b> workers from ${D.orchestrators.length} orchestrator sessions. Rows are project and goal; live and recent work sits on top, older work is dimmed, finished work older than 12 h drops away.`));
    app.append(strip([
      { k: "live", v: all.live, s: "workers running now", c: "live" },
      { k: "asks", v: all.asks, s: "finished workers want you", c: "you" },
      { k: "cut", v: all.cut, s: `${all.unresumed} never resumed`, c: "fail" },
      { k: "stalled", v: dur(all.stall), s: `across ${tasks.filter((t) => t.stallS).length} workers` },
      { k: "tool calls", v: int(all.calls), s: `${int(all.errors)} failed · ${f1(all.errors / all.calls * 100)}%` },
      { k: "your messages", v: owner.length, s: `in ${D.orchestrators.length} sessions` },
    ]));
    const va = I.views.a; app.append(readStrip(va.read, va.actions));
    const zoomEl = document.createElement("div"); zoomEl.className = "seg"; zoomEl.setAttribute("aria-label", "zoom");
    const head = sec("Timeline", "one row per project and goal · bars are workers · grey columns are tool calls per minute"); head.querySelector(".sec").append(zoomEl); app.append(head);
    const host = document.createElement("div"); app.append(host);
    app.append(html(`<div class="legend"><span><i style="background:var(--bar);border:1px solid var(--bar-edge)"></i>worker</span><span><i style="background:var(--tick)"></i>calls/min</span><span><i style="background:var(--live)"></i>live</span><span><i style="background:var(--you)"></i>asks you</span><span><i style="background:var(--fail)"></i>failed call · cut</span><span><i style="background:url(#)" class="lg-hatch"></i>stalled &gt; 150 s</span></div>`));
    let showStale = false, sel = null;
    const detail = document.createElement("div"); app.append(detail);

    function build() {
      const vis = tasks.filter((t) => showStale || recency(t) !== "stale");
      const byLabel = new Map();
      vis.forEach((t) => { if (!byLabel.has(t.label)) byLabel.set(t.label, []); byLabel.get(t.label).push(t); });
      const rank = { live: 0, recent: 1, earlier: 2, stale: 3 };
      const rows = [...byLabel.entries()].map(([label, ts]) => ({ label, ts, cls: ts.map(recency).sort((a, b) => rank[a] - rank[b])[0], last: Math.max(...ts.map((t) => t.e)) }));
      rows.sort((a, b) => rank[a.cls] - rank[b.cls] || b.last - a.last);
      if (!sel) sel = rows[0].label;
      const t0 = Math.floor(Math.min(...vis.map((t) => t.s)) / H) * H, t1 = NOW + 20 * M;
      const out = [axisRow(), cutsRow(t0, t1), activeRow(t0, t1), youRow(t0, t1)];
      const names = { live: "Live", recent: "Last 3 hours", earlier: "Earlier today", stale: "Older, finished" };
      let g = null;
      for (const r of rows) {
        if (r.cls !== g) { g = r.cls; const n = rows.filter((x) => x.cls === g).length; out.push({ h: 30, cls: `group ${g === "live" ? "live" : g === "recent" ? "" : "dim"}`, label: `${names[g]} · ${n}` }); }
        out.push(labelRow(r));
      }
      const hidden = tasks.filter((t) => recency(t) === "stale").length;
      return { rows: out, t0, t1, hidden };
    }
    function labelRow(r) {
      const L = packLanes(r.ts), dim = r.cls === "earlier" || r.cls === "stale";
      const h = L === 1 ? 50 : 18 + L * 13, bh = L === 1 ? 16 : 8;
      const tt = totals(r.ts), [p, g] = r.label.split(" · ");
      const meta = [`${tt.n} worker${tt.n > 1 ? "s" : ""}`, tt.cut ? `<span class="c-fail">${tt.cut} cut</span>` : "", tt.asks ? `<span class="c-you">${tt.asks} ask${tt.asks > 1 ? "s" : ""}</span>` : ""].filter(Boolean).join(" · ");
      return {
        h, id: r.label, cls: dim ? "dim" : "", label: `<div class="p">${esc(p)}</div><div class="g">${esc(g || "")}</div><div class="m">${meta}</div>`,
        draw: (X) => {
          const y0 = L === 1 ? (h - bh) / 2 : 11;
          let s = "";
          for (const t of r.ts) s += taskSvg(t, X, y0 + t._lane * 13, bh, { dim: dim && t.status !== "running" });
          for (const t of r.ts) if (t.resume_of && byId[t.resume_of] && byId[t.resume_of].label === r.label) {
            const a = byId[t.resume_of];
            s += `<path class="l-conn" d="M${X(a.e)} ${y0 + a._lane * 13 + bh / 2} L${X(t.s)} ${y0 + t._lane * 13 + bh / 2}"/>`;
          }
          // one inline note per row, only where something matters
          const last = r.ts.reduce((a, b) => (b.e > a.e ? b : a));
          const xe = X(last.e) + 16, ym = y0 + last._lane * 13 + bh / 2 + 4;
          const lv = r.ts.find((t) => t.status === "running");
          const cutOpen = r.ts.filter((t) => t.status === "interrupted" && !resumedBy[t.id]).sort((a, b) => b.e - a.e)[0];
          const res = r.ts.find((t) => t.resume_of);
          const longStall = r.ts.reduce((a, b) => (b.stallS > (a ? a.stallS : 0) ? b : a), null);
          if (lv) s += txt(X(NOW) + 16, y0 + lv._lane * 13 + bh / 2 + 4, `live ${dur((NOW - lv.s) / 1000)}`, "t-live");
          else if (cutOpen && cutOpen === last) s += txt(xe - 6, ym, `cut ${clock(cutOpen.e)} · not resumed`, "t-fail");
          else if (res) s += txt(X(res.s) + 6, y0 + res._lane * 13 - 4, "resumed", "t-2");
          else if (last.needs_owner.length) s += txt(xe + 2, ym, `asks ${last.needs_owner.map((k) => ASK_WORD[k]).join(", ")}`, "t-you");
          else if (longStall && longStall.stallS >= 600) s += txt(X(longStall.e) + 8, y0 + longStall._lane * 13 + bh / 2 + 4, `stalled ${dur(longStall.stallS)}`, "t-2");
          return s;
        },
      };
    }
    function activeRow(t0, t1) {
      const step = 5 * M, pts = [];
      let max = 0;
      for (let t = t0; t <= Math.min(t1, NOW); t += step) { const n = tasks.filter((x) => x.s <= t && x.e > t).length; pts.push([t, n]); max = Math.max(max, n); }
      return {
        h: 52, cls: "head", label: `<div class="m">active workers</div><div class="m">peak ${max}</div>`,
        draw: (X, h) => {
          const Y = (n) => h - 6 - (n / max) * (h - 14);
          const d = pts.map(([t, n], i) => `${i ? "L" : "M"}${X(t)} ${Y(n)}`).join("");
          const lastX = X(pts[pts.length - 1][0]);
          return `<path class="f-area" d="${d}L${lastX} ${h - 6}L${X(pts[0][0])} ${h - 6}Z"/><path class="l-area" d="${d}"/>${txt(lastX + 6, Y(pts[pts.length - 1][1]) + 4, String(pts[pts.length - 1][1]), "t-live")}`;
        },
      };
    }
    function youRow(t0, t1) {
      return {
        h: 26, cls: "head", label: `<div class="m">your messages · ${owner.length}</div>`,
        draw: (X, h) => {
          const b = {}; owner.forEach((o) => { if (o.at >= t0 && o.at <= t1) { const i = Math.floor(X(o.at) / 4); b[i] = (b[i] || 0) + 1; } });
          return Object.entries(b).map(([i, n]) => `<rect class="f-tick" x="${i * 4}" y="${h - 6 - Math.min(14, 4 + n * 3)}" width="2.4" height="${Math.min(14, 4 + n * 3)}"/>`).join("");
        },
      };
    }
    let built = build();
    const tl = Timeline(host, {
      rows: built.rows, t0: built.t0, t1: built.t1, padR: 150, minPxHPhone: 96, zoomEl, sel, aria: "Timeline of workers by project and goal",
      overlay: cutLines(built.t0, built.t1, 64), overlayFor: (a, b) => cutLines(a, b, 64), onSelect: (id) => { sel = id; tl.setRows(built.rows, sel); paintDetail(); },
    });
    const more = document.createElement("div"); more.className = "responses";
    const paintMore = () => {
      more.innerHTML = `<span>${showStale ? "Showing older finished work" : `${built.hidden} finished workers older than 12 h are hidden`}</span><button type="button">${showStale ? "Hide them" : "Show them"}</button>`;
      more.querySelector("button").onclick = () => {
        showStale = !showStale; built = build();
        tl.setRows(built.rows, sel, built.t0, built.t1); paintMore();
      };
    };
    host.after(more); paintMore();
    function paintDetail() {
      const ts = tasks.filter((t) => t.label === sel).sort((a, b) => b.s - a.s), tt = totals(ts);
      const tools = {}; ts.forEach((t) => t.ev.forEach((e) => { tools[e.tool] = (tools[e.tool] || 0) + 1; }));
      const top = Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${int(v)}`).join(" · ");
      detail.innerHTML = "";
      detail.append(sec(sel, `${tt.n} workers · ${int(tt.calls)} calls · ${tt.errors} failed · stalled ${dur(tt.stall)} · ${top}`));
      detail.append(html(`<div class="tablewrap"><table class="t"><thead><tr><th>worker</th><th>start</th><th class="r">ran</th><th class="r">calls</th><th class="r">failed</th><th class="r">stalled</th><th>ended</th><th>asks</th></tr></thead><tbody>${ts.map((t) => `<tr><td class="c-2">${esc(t.run.replace("run-", "#"))}${letter(t)}</td><td>${clock(t.s)}</td><td class="r">${dur((t.e - t.s) / 1000)}</td><td class="r">${int(t.tool_calls)}</td><td class="r${t.errors >= 10 ? " c-fail" : ""}">${t.errors}</td><td class="r">${t.stallS ? dur(t.stallS) : "<span class=c-3>0</span>"}</td><td class="${t.status === "running" ? "c-live" : t.status === "interrupted" ? "c-fail" : "c-2"}">${t.status === "running" ? "live" : t.status === "interrupted" ? (resumedBy[t.id] ? `cut ${clock(t.e)}, resumed` : `cut ${clock(t.e)}`) : `done ${clock(t.e)}`}</td><td class="c-you">${t.needs_owner.map((k) => ASK_WORD[k]).join(", ")}</td></tr>`).join("")}</tbody></table></div>`));
    }
    paintDetail();
    app.append(foot("Tap a row label to inspect it. Pinch or ctrl-scroll the plot to zoom."));
  }

  // ---------------------------------------------------------------- B: lanes
  function viewB() {
    const batches = runs.filter((r) => r.ts.length > 1 || r.ts.some((t) => t.status === "running")).sort((a, b) => b.s - a.s);
    let cur = batches.find((r) => r.id === "run-44") || batches[0];
    app.append(header("B · lanes", "Who did what, and who never came back",
      "One dispatch at a time: the orchestrator on top, each worker below with its supervision band. A grey elbow returns when a worker reports back; a cut worker ends in red with no return."));
    const picker = document.createElement("div"); picker.className = "picker"; picker.setAttribute("role", "group"); picker.setAttribute("aria-label", "dispatch");
    app.append(picker);
    const top = document.createElement("div"); app.append(top);
    const zoomEl = document.createElement("div"); zoomEl.className = "seg";
    const head = sec("Lanes", "bar: worker · thin band under it: running, verifying, draft PR, stalled"); head.querySelector(".sec").append(zoomEl); app.append(head);
    const host = document.createElement("div"); app.append(host);
    app.append(html(`<div class="legend"><span><i style="background:#3d3e42"></i>running</span><span><i style="background:var(--tick)"></i>verifying</span><span><i style="background:var(--ink)"></i>draft PR</span><span><i class="lg-hatch"></i>stalled</span><span><i style="background:var(--you)"></i>asks you</span><span><i style="background:var(--fail)"></i>failed call · cut</span><span><i style="background:var(--live)"></i>live</span></div>`));
    const lost = document.createElement("div"); app.append(lost);
    let tl = null;
    const labelOf = (r) => { const c = {}; r.ts.forEach((t) => (c[t.label] = (c[t.label] || 0) + 1)); const ks = Object.keys(c); return ks.length === 1 ? ks[0] : `${r.label} +${ks.length - 1}`; };
    function paintPicker() {
      picker.innerHTML = batches.map((r) => { const tt = totals(r.ts); return `<button type="button" class="pick" data-id="${r.id}" aria-pressed="${r === cur}"><div class="p">${esc(labelOf(r))}</div><div class="m">${clock(r.s)} · ${tt.n} worker${tt.n > 1 ? "s" : ""}${tt.cut ? ` · <span class="c-fail">${tt.cut} cut</span>` : ""}${tt.live ? ' · <span class="c-live">live</span>' : ""}${tt.asks ? ` · <span class="c-you">${tt.asks} ask</span>` : ""}</div></button>`; }).join("");
      picker.querySelectorAll(".pick").forEach((b) => (b.onclick = () => { cur = batches.find((r) => r.id === b.dataset.id); paint(); }));
    }
    function bandSegs(t) {
      const total = (t.e - t.s) / 1000, marks = [];
      t.bands.forEach((b) => { if (b.phase === "verify") marks.push({ c: "f-tick", s: b.s, e: b.e }); if (b.phase === "pr") marks.push({ c: "f-ink", s: b.s, e: b.e }); });
      return { total, marks };
    }
    function rowsFor(r) {
      const ts = [...r.ts].sort((a, b) => a.s - b.s || a.id.localeCompare(b.id));
      const t0 = r.s - 3 * M, t1 = r.e + 3 * M;
      const orchMsgs = owner.filter((o) => o.orch === r.orchestrator && o.at >= t0 && o.at <= t1);
      const rows = [axisRow(), {
        h: 54, cls: "", label: `<div class="p">Hermes</div><div class="g">orchestrator</div><div class="m">${orchMsgs.length} of your messages</div>`,
        draw: (X, h) => `<rect class="b-body" x="${X(r.s)}" y="${h / 2 - 3}" width="${Math.max(2, X(r.e) - X(r.s))}" height="6" rx="1"/>${orchMsgs.map((o) => `<rect class="f-ink" x="${X(o.at) - 1}" y="${h / 2 - 9}" width="2" height="18"/>`).join("")}${txt(X(r.s) + 4, 12, `dispatched ${clock(r.s)}`, "t-2")}`,
      }];
      for (const t of ts) {
        const [p, g] = t.label.split(" · ");
        rows.push({
          h: 54, id: t.id, label: `<div class="p">${esc(p)} <span class="mono c-2" style="font-weight:500">${letter(t)}</span></div><div class="g">${esc(g || "")}</div><div class="m">${dur((t.e - t.s) / 1000)} · ${int(t.tool_calls)} calls</div>`,
          draw: (X) => {
            let s = taskSvg(t, X, 14, 16);
            const { marks } = bandSegs(t), x0 = X(t.s), x1 = X(t.e);
            s += `<rect class="f-run" x="${x0}" y="35" width="${Math.max(1, x1 - x0)}" height="5"/>`;
            marks.forEach((m) => { const a = X(t.s + m.s * 1000), b = X(t.s + m.e * 1000); s += `<rect class="${m.c}" x="${a}" y="35" width="${Math.max(1, b - a)}" height="5"/>`; });
            t.stalls.forEach((st) => { const a = X(t.s + st.s * 1000), b = X(t.s + st.e * 1000); s += `<rect x="${a}" y="35" width="${Math.max(1, b - a)}" height="5" fill="url(#hatch)"/>`; });
            const xe = x1 + 16;
            if (t.status === "interrupted") s += txt(x1 + 8, 27, resumedBy[t.id] ? `cut ${clock(t.e)} · resumed` : `cut ${clock(t.e)}`, "t-fail");
            else if (t.status === "running") s += txt(x1 + 14, 27, `live ${dur((NOW - t.s) / 1000)}`, "t-live");
            else if (t.needs_owner.length) s += txt(xe, 27, `asks ${t.needs_owner.map((k) => ASK_WORD[k]).join(", ")}`, "t-you");
            else s += txt(x1 + 8, 27, `done ${clock(t.e)}`, "t-3");
            if (t.stallS >= 600) { const big = t.stalls.reduce((a, b) => (b.e - b.s > a.e - a.s ? b : a)); s += txt(X(t.s + big.s * 1000), 51, `stalled ${dur(t.stallS)} total`, "t-2"); }
            return s;
          },
        });
      }
      return { rows, t0, t1, ts };
    }
    function elbows(r, ts) {
      return (X, y, rows) => {
        const orch = rows[1], oy = orch.y + orch.h / 2 + 3;
        let s = "";
        for (const row of rows.slice(2)) {
          const t = byId[row.id], wy = row.y + 14 + 8;
          s += `<path class="l-conn" d="M${X(r.s)} ${oy} V${wy} H${X(t.s)}"/>`;
          if (t.status === "completed") s += `<path class="l-ret" d="M${X(t.e)} ${wy} V${oy}"/><circle class="f-ink" cx="${X(t.e)}" cy="${oy}" r="2.5"/>`;
        }
        return s;
      };
    }
    function paint() {
      paintPicker();
      const tt = totals(cur.ts), b = I.views.b.batches[cur.id];
      top.innerHTML = "";
      top.append(strip([
        { k: "workers", v: tt.n, s: `dispatched ${clock(cur.s)}` },
        { k: "finished", v: tt.done, s: tt.live ? `${tt.live} live` : `last ${clock(cur.e)}`, c: tt.live ? "live" : "" },
        { k: "cut", v: tt.cut, s: tt.cut ? `${tt.unresumed} not resumed` : "none", c: tt.cut ? "fail" : "" },
        { k: "asks", v: tt.asks, s: "want you", c: tt.asks ? "you" : "" },
        { k: "calls", v: int(tt.calls), s: `${tt.errors} failed · ${f1(tt.errors / Math.max(1, tt.calls) * 100)}%` },
        { k: "stalled", v: dur(tt.stall), s: "sum over workers" },
      ]));
      if (b) top.append(readStrip(b.read, b.actions));
      else top.append(html(`<section class="read"><p class="c-2">${tt.n} worker${tt.n > 1 ? "s" : ""}, ${tt.done} finished, ${tt.cut} cut, ${tt.asks} asking for you. No read written for this dispatch yet.</p><div class="responses"></div></section>`));
      paintResponses();
      const { rows, t0, t1, ts } = rowsFor(cur);
      host.innerHTML = "";
      tl = Timeline(host, { rows, t0, t1, padR: 190, minPxHPhone: 260, zoomEl, aria: `Lanes for dispatch ${cur.id}`, overlay: elbows(cur, ts), startAt: t0 });
    }
    function paintLost() {
      lost.append(sec("Who never came back", `${CUTS.reduce((a, c) => a + c.ts.length, 0)} workers were cut at ${CUTS.length} moments today`));
      lost.append(html(`<div class="asks two">${CUTS.slice().reverse().map((c) => {
        const res = c.ts.filter((t) => resumedBy[t.id]);
        const names = {}; c.ts.forEach((t) => (names[t.label] = (names[t.label] || 0) + 1));
        return `<div class="ask-row fail"><div class="n">${c.ts.length}</div><div><div class="k mono">${clock(c.t)} <span class="c-3">cut together</span></div><div class="l">${Object.entries(names).map(([k, v]) => `${esc(k)}${v > 1 ? ` ×${v}` : ""}`).join(", ")}</div><div class="l mono ${res.length ? "c-2" : "c-fail"}">${res.length ? `${res.length} resumed at ${clock(resumedBy[res[0].id].s)}, ${c.ts.length - res.length} not` : "none resumed"}</div></div></div>`;
      }).join("")}</div>`));
    }
    paint(); paintLost();
    app.append(foot("Elbows are drawn from dispatch and final-report times only; there are no causal parent spans. Resume links are matched by goal words."));
  }

  // ---------------------------------------------------------------- C: stats
  function viewC() {
    const all = totals(tasks);
    const priced = tasks.filter((t) => t.cost_usd != null), cost = priced.reduce((a, t) => a + t.cost_usd, 0);
    const tok = tasks.reduce((a, t) => a + (t.tokens ? t.tokens.input + t.tokens.output + t.tokens.cache_read + t.tokens.cache_write : 0), 0);
    app.append(header("C · stats", "Is the system healthy, and is the burn on pace",
      `Totals for <b>${tasks.length}</b> workers, ${clock(Math.min(...tasks.map((t) => t.s)))} to ${clock(NOW)}, plus quota lanes from burn-pace at ${esc(D.lanes_at.slice(11, 16))} UTC.`));
    app.append(strip([
      { k: "claude used", v: `${D.lanes.claude.weekly_used_pct}%`, s: `${D.lanes.claude.pace_ratio}× pace`, c: "fail" },
      { k: "codex used", v: `${D.lanes.codex.weekly_used_pct}%`, s: `${D.lanes.codex.pace_ratio}× pace` },
      { k: "tokens", v: tok >= 1e9 ? `${(tok / 1e9).toFixed(2)}B` : `${(tok / 1e6).toFixed(0)}M`, s: "incl. cache reads" },
      { k: "cost", v: `$${int(cost)}`, s: `${tasks.length - priced.length} workers unpriced` },
      { k: "failed calls", v: `${f1(all.errors / all.calls * 100)}%`, s: `${all.errors} of ${int(all.calls)}` },
      { k: "cut", v: all.cut, s: `${all.unresumed} never resumed`, c: "fail" },
    ]));
    const vc = I.views.c; app.append(readStrip(vc.read, vc.actions));
    // burn lanes
    app.append(sec("Quota lanes", "bar: used now · hatched: projected at reset at the current rate · tick: 100%"));
    const lanes = Object.entries(D.lanes).map(([name, l]) => {
      const proj = l.weekly_used_pct + l.observed_pct_per_h * l.hours_to_reset, over = proj > 100;
      const scale = (v) => Math.min(v, 120) / 120 * 100;
      return `<div class="lane"><div class="lh"><span class="bl">${esc(name)}</span><span class="bv">${l.weekly_used_pct}% used · ${l.hours_to_reset} h to reset · <span class="${over ? "c-fail" : ""}">projected ${Math.round(proj)}%</span></span></div><div class="track"><i style="left:0;width:${scale(l.weekly_used_pct)}%;background:${over ? "var(--fail)" : "var(--ink3)"}"></i><i class="lg-hatch" style="left:${scale(l.weekly_used_pct)}%;width:${scale(proj) - scale(l.weekly_used_pct)}%;opacity:.8"></i><i style="left:${scale(100)}%;width:1px;top:-4px;bottom:-4px;background:var(--ink2)"></i><span class="pct">100%</span></div></div>`;
    }).join("");
    app.append(html(`<div class="bars">${lanes}</div>`));
    // activity by hour
    app.append(sec("Activity by hour", "above the line: tool calls per hour, current hour in blue · below: failed calls per hour, own scale · dashed: cut moments"));
    const h0 = Math.floor(Math.min(...tasks.map((t) => t.s)) / H) * H, nH = Math.ceil((NOW - h0) / H);
    const calls = new Array(nH).fill(0), errs = new Array(nH).fill(0);
    tasks.forEach((t) => t.ev.forEach((e) => { const i = Math.floor((e.t - h0) / H); if (i >= 0 && i < nH) { calls[i]++; if (e.ok === 0) errs[i]++; } }));
    const hostH = document.createElement("div"); app.append(hostH);
    const drawHours = () => {
      const W = hostH.clientWidth || 360, HH = 190, base = 128, bw = W / nH, mx = Math.max(...calls), mxe = Math.max(...errs);
      let s = `<line class="l-row" x1="0" x2="${W}" y1="${base + 0.5}" y2="${base + 0.5}"/>`;
      for (let i = 0; i < nH; i++) {
        const bh = calls[i] / mx * (base - 26), x = i * bw, cw = Math.max(2, bw - 3);
        s += `<rect class="${i === nH - 1 ? "f-live" : "f-col"}" x="${x + 1.5}" y="${base - bh}" width="${cw}" height="${bh}"/>`;
        if (errs[i]) s += `<rect class="f-fail" x="${x + 1.5}" y="${base + 3}" width="${cw}" height="${Math.max(2, errs[i] / mxe * 30)}"/>`;
        if (i % (bw < 22 ? 3 : 2) === 0) s += `<text class="ax" x="${x + 2}" y="${HH - 6}">${clock(h0 + i * H)}</text>`;
      }
      CUTS.forEach((c) => { const x = (c.t - h0) / H * bw; s += `<line class="l-cut" x1="${x}" x2="${x}" y1="18" y2="${base}"/>${txt(x + 3, 14, `${c.ts.length} cut`, "t-fail")}`; });
      s += `<text class="ax" x="${W}" y="${base - 4 - (base - 26)}" text-anchor="end">${int(mx)} calls/h</text><text class="ax t-fail" x="${W}" y="${base + 44}" text-anchor="end">${mxe} failed/h</text>`;
      hostH.innerHTML = `<svg width="${W}" height="${HH}" role="img" aria-label="Tool calls and failed calls per hour">${s}</svg>`;
    };
    drawHours(); window.addEventListener("resize", drawHours);
    // projects table
    const cols = document.createElement("div"); cols.className = "cols w"; app.append(cols);
    const left = document.createElement("div"), right = document.createElement("div"); cols.append(left, right);
    left.append(sec("By project", "worker time, with the share lost to cut workers in red"));
    const proj = {};
    tasks.forEach((t) => { const p = (proj[t.project] ||= { n: 0, wall: 0, cutWall: 0, cut: 0, asks: 0, err: 0, calls: 0, live: 0 }); p.n++; p.wall += (t.e - t.s) / 1000; p.calls += t.tool_calls; p.err += t.errors; if (t.status === "interrupted") { p.cut++; p.cutWall += (t.e - t.s) / 1000; } if (t.needs_owner.length) p.asks++; if (t.status === "running") p.live++; });
    const pr = Object.entries(proj).sort((a, b) => b[1].wall - a[1].wall), mxw = pr[0][1].wall;
    left.append(html(`<div class="tablewrap"><table class="t"><thead><tr><th>project</th><th class="r">workers</th><th style="width:30%">worker time</th><th class="r">hours</th><th class="r">cut</th><th class="r">asks</th><th class="r">failed</th></tr></thead><tbody>${pr.map(([k, p]) => `<tr><td class="sans">${esc(k)}${p.live ? ' <span class="c-live mono" style="font-size:11px">live</span>' : ""}</td><td class="r">${p.n}</td><td><svg width="100%" height="10" preserveAspectRatio="none" viewBox="0 0 100 10"><rect class="f-col" x="0" y="1" width="${p.wall / mxw * 100}" height="8"/><rect class="f-fail" x="${(p.wall - p.cutWall) / mxw * 100}" y="1" width="${p.cutWall / mxw * 100}" height="8"/></svg></td><td class="r">${f1(p.wall / 3600)}</td><td class="r ${p.cut ? "c-fail" : "c-3"}">${p.cut}</td><td class="r ${p.asks ? "c-you" : "c-3"}">${p.asks}</td><td class="r">${f1(p.err / p.calls * 100)}%</td></tr>`).join("")}</tbody></table></div>`));
    right.append(sec("Failed calls by tool", "grey: calls · red: failed share"));
    const tc = {}; tasks.forEach((t) => t.ev.forEach((e) => { const x = (tc[e.tool] ||= { n: 0, f: 0 }); x.n++; if (e.ok === 0) x.f++; }));
    const tr = Object.entries(tc).sort((a, b) => b[1].f - a[1].f || b[1].n - a[1].n).slice(0, 8), mxn = Math.max(...tr.map(([, x]) => x.n));
    right.append(html(`<div class="bars">${tr.map(([k, x]) => `<div class="brow" style="--bl:120px;--br:96px"><div class="bl mono" style="font-size:12px">${esc(k)}</div><div class="track"><i style="left:0;width:${x.n / mxn * 100}%;background:var(--bar-edge)"></i><i style="left:0;width:${Math.max(x.f ? 0.6 : 0, x.f / mxn * 100)}%;background:var(--fail)"></i></div><div class="bv">${x.f} / ${int(x.n)}</div></div>`).join("")}</div>`));
    right.append(sec("omp, 7-day sample", "separate harness, read-only copy of stats.db"));
    right.append(html(`<div class="tablewrap"><table class="t"><thead><tr><th>model</th><th class="r">requests</th><th class="r">tokens</th><th class="r">cost</th></tr></thead><tbody>${D.omp.models.map((m) => `<tr><td>${esc(m.model)}</td><td class="r">${m.requests}</td><td class="r">${int(m.tokens)}</td><td class="r">$${m.cost.toFixed(2)}</td></tr>`).join("")}</tbody></table></div>`));
    app.append(foot("Projected burn = used + observed rate × hours to reset. Cost is Hermes' estimate; unpriced workers count as zero."));
  }

  // ---------------------------------------------------------------- D: pocket
  function viewD() {
    const live = tasks.filter((t) => t.status === "running").sort((a, b) => a.s - b.s);
    const recentAsks = tasks.filter((t) => t.status !== "running" && t.e >= NOW - 3 * H && t.needs_owner.length);
    app.append(header("D · pocket", "Do I need to do anything right now",
      `As of ${clock(NOW)}. The last 3 hours in full, earlier today as a summary; anything older is gone.`));
    app.append(strip([
      { k: "live", v: live.length, s: "running now", c: "live" },
      { k: "asks, 3 h", v: recentAsks.length, s: "finished, want you", c: "you" },
      { k: "cut today", v: CUTS.reduce((a, c) => a + c.ts.length, 0), s: `${totals(tasks).unresumed} not resumed`, c: "fail" },
    ]));
    const cols = document.createElement("div"); cols.className = "cols"; app.append(cols);
    const left = document.createElement("div"), right = document.createElement("div"); cols.append(left, right);
    const vd = I.views.d; left.append(readStrip(vd.read, vd.actions));
    left.append(sec("Live now", `${live.length} workers`));
    left.append(html(`<div>${live.map((t) => { const [p, g] = t.label.split(" · "); return `<div class="live-row"><div class="p">${esc(p)} <span>${esc(g || "")}</span></div><div class="m"><b>${dur((NOW - t.s) / 1000)}</b> · ${int(t.tool_calls)} calls${t.errors ? ` · ${t.errors} failed` : ""}</div></div>`; }).join("")}</div>`));
    left.append(sec("What they asked for", "finished in the last 3 hours"));
    const kinds = {}; recentAsks.forEach((t) => t.needs_owner.forEach((k) => (kinds[k] ||= []).push(t)));
    left.append(html(`<div class="asks">${Object.entries(kinds).sort((a, b) => b[1].length - a[1].length).map(([k, ts]) => { const c = {}; ts.forEach((t) => (c[t.label] = (c[t.label] || 0) + 1)); return `<div class="ask-row${k === "blocked" ? " fail" : ""}"><div class="n">${ts.length}</div><div><div class="k">${esc(ASK_WORD[k])}${ts.length > 1 && k !== "blocked" ? "s" : ""}</div><div class="l">${Object.entries(c).map(([l, n]) => `${esc(l)}${n > 1 ? ` ×${n}` : ""}`).join(", ")}</div></div></div>`; }).join("")}</div>`));
    // vertical time axis
    right.append(sec("Time, newest first", "each line is a worker ending or starting"));
    const vt = document.createElement("div"); vt.className = "vt"; right.append(vt);
    let out = "";
    const hTop = Math.floor(NOW / H) * H;
    for (let h = hTop; h >= hTop - 12 * H; h -= H) {
      const ev = [];
      tasks.forEach((t) => {
        if (t.status === "running" && t.s >= h && t.s < h + H) ev.push({ at: t.s, t, k: "start" });
        if (t.status !== "running" && t.e >= h && t.e < h + H) ev.push({ at: t.e, t, k: "end" });
      });
      if (!ev.length) continue;
      ev.sort((a, b) => b.at - a.at);
      const recent = h + H > NOW - 3 * H;
      if (recent) {
        out += `<div class="vh"><div class="hr">${clock(h)}</div><div class="items">${ev.map(({ at, t, k }) => {
          const [p, g] = t.label.split(" · ");
          const mk = k === "start" ? "var(--live)" : t.status === "interrupted" ? "var(--fail)" : t.needs_owner.length ? "var(--you)" : "var(--ink4)";
          const st = k === "start" ? '<span class="c-live">started</span>' : t.status === "interrupted" ? '<span class="c-fail">cut</span>' : t.needs_owner.length ? `<span class="c-you">${esc(ASK_WORD[t.needs_owner[0]])}</span>` : "done";
          return `<div class="vi"><i class="mk" style="background:${mk}"></i><div class="tx">${esc(p)} <span>${esc(g || "")}</span></div><div class="st">${st}</div><div class="tm">${clock(at)}</div></div>`;
        }).join("")}</div></div>`;
      } else {
        const done = ev.filter((e) => e.t.status === "completed").length, cut = ev.filter((e) => e.t.status === "interrupted").length;
        const bins = new Array(6).fill(0); ev.forEach((e) => bins[Math.min(5, Math.floor((e.at - h) / (10 * M)))]++);
        const projs = [...new Set(ev.map((e) => e.t.project))].slice(0, 3).join(", ");
        out += `<div class="vh dim"><div class="hr">${clock(h)}</div><div class="items"><div class="vi sum"><div class="dens" aria-hidden="true">${bins.map((n) => `<i style="height:${n ? 5 + n * 4 : 2}px${n ? "" : ";opacity:.4"}"></i>`).join("")}</div><div class="tx">${done} done${cut ? ` · <span class="c-fail">${cut} cut</span>` : ""}</div><div class="st">${esc(projs)}</div><div class="tm"></div></div></div></div>`;
      }
    }
    vt.innerHTML = out + '<p class="foot" style="margin-top:12px">Earlier than 12 hours ago is not shown here.</p>';
    app.append(foot(""));
  }

  ({ a: viewA, b: viewB, c: viewC, d: viewD })[VIEW]();
  paintResponses();
})();
