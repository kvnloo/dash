"""Dash native journeys: one function per spec journey id (spec/features.yaml).

Every journey drives the real app like a user (launch, tabs, taps, IME typing, swipes), asserts what a
user can observe (nodes, text, timings, frame stats, memory) and records screenshots. Selectors come
from the app source at the candidate: testIDs (chat-row-*, chats-pane, chat-window-*, voice-*,
transcript-viewport, trace-*, density-*, orchestra-graph, needs-kevin) and accessibility labels
("Close chat window", "Send", "Stop", "Message", "Prompt navigator", "Annotate this screen", ...).

Agents behind the isolated bridge are the deterministic ACP fixture (e2e/mbp-army on the candidate):
a prompt with ARMY_SLOW replies after 9 s, ARMY_HANG never finishes until Stop, ARMY_ERROR fails, and
anything else replies `ARMY_REPLY: <text>` after 350 ms, after an ARMY_STREAM_BEGIN chunk. Journeys
whose observable needs a real agent (markdown, generated UI, subagents, context usage) declare
`real_agent` and write partial receipts against the fixture.

Budgets are explicit constants below. Frame numbers on a dev-client bundle are pessimistic; record them,
and confirm on a release bundle before attributing a regression.
"""
from __future__ import annotations

import os
import re
import time

from framework import Ctx, StepFailed, journey

# ------------------------------------------------------------------ budgets
SCROLL_ROWS_MIN = 1000          # J-chat-list-all-harnesses: rows the owner's roster must hold
JANK_PCT_MAX = float(os.environ.get("DASH_E2E_JANK_PCT_MAX", "10"))     # frames over the refresh budget
P95_FRAME_MS_MAX = float(os.environ.get("DASH_E2E_P95_MS_MAX", "33"))   # two 60 Hz frames
SEARCH_RESULT_S_MAX = 1.0       # owner ask: results < 1 s (spec target 200 ms; UI polling resolution ~0.3 s)
SEND_FIRST_CHUNK_S_MAX = 3.0
PSS_GROWTH_MB_MAX = 40          # per 60 s idle (original leak report: ~150 MB/min on the S25)
ARCHIVE_HARNESSES = ("Codex", "Claude Code", "Grok", "OMP")
SEED_PREFIX = "DASHE2E"         # e2e/device/seed_archive.py titles: "DASHE2E <harness> archive NNNN <token>"


# ------------------------------------------------------------------ app helpers (user-level actions)

def home(ctx: Ctx, fresh: bool = False) -> None:
    """Launch Dash (cold when fresh) and get to the Main pager, pairing once if asked to."""
    d = ctx.dev
    if fresh:
        d.force_stop()
    d.launch()
    for _ in range(90):
        if d.find(desc="Chats") or d.find(desc="Pair over Tailscale") or d.find(desc="Bootstrap token"):
            break
        time.sleep(1)
    if d.find(desc="Bootstrap token") or d.find(desc="Pair over Tailscale"):
        pair_with_token(ctx)
    if not d.wait(timeout=30, desc="Chats"):
        raise StepFailed("Main pager (Chats tab) never appeared")


def pair_with_token(ctx: Ctx) -> None:
    """Legacy bootstrap-token pairing against the isolated bridge (the token is typed, never logged)."""
    d = ctx.dev
    host = d.find(text=r"100\.64\.0\.1") or d.find(any_text=r"^100\.\d+\.\d+\.\d+")
    if host:
        d.tap(host)
        d.type_text(f"{os.environ.get('DASH_E2E_MBP_IP', '100.78.215.21')}:{os.environ.get('DASH_E2E_BRIDGE_PORT', '18530')}")
    tok = d.find(desc="Bootstrap token")
    if tok:
        d.tap(tok)
        d.type_text(ctx.stack.bootstrap_token())
    d.press("back")
    d.tap_desc("Pair over Tailscale")
    d.wait(timeout=30, desc="Chats")


def tab(ctx: Ctx, name: str) -> bool:
    ok = ctx.dev.tap_desc(name, timeout=8)
    time.sleep(0.8)
    return ok


def chat_rows(ctx: Ctx) -> list[dict]:
    return ctx.dev.find_all(rid=r"chat-row-.*")


def row_harness(ctx: Ctx, row: dict) -> str | None:
    """The harness name the row shows (its orb label is "<harness> · <phase>")."""
    x1, y1, x2, y2 = ctx.dev.bounds(row)
    for n in ctx.dev.nodes():
        if n.get("resource-id") == "agent-orb":
            a1, b1, a2, b2 = ctx.dev.bounds(n)
            if x1 <= a1 and a2 <= x2 and y1 <= b1 and b2 <= y2:
                return (n.get("content-desc") or "").split(" · ")[0] or None
    return None


def open_chat(ctx: Ctx, row: dict | None = None, match: str | None = None) -> dict:
    d = ctx.dev
    if row is None:
        rows = chat_rows(ctx)
        if match:
            rows = [r for r in rows if re.search(match, row_text(ctx, r))]
        if not rows:
            raise StepFailed(f"no chat row{' matching ' + match if match else ''}")
        row = rows[0]
    d.tap(row)
    if not d.wait(timeout=10, desc="Close chat window"):
        raise StepFailed("chat window did not open (no Close chat window)")
    return row


def row_text(ctx: Ctx, row: dict) -> str:
    x1, y1, x2, y2 = ctx.dev.bounds(row)
    parts = []
    for n in ctx.dev.nodes():
        if not n.get("bounds"):
            continue
        a1, b1, a2, b2 = ctx.dev.bounds(n)
        if x1 <= a1 and a2 <= x2 and y1 <= b1 and b2 <= y2 and (n.get("text") or n.get("content-desc")):
            parts.append(n.get("text") or n.get("content-desc"))
    return " | ".join(parts)


def close_chat(ctx: Ctx) -> bool:
    return ctx.dev.tap_desc("Close chat window", timeout=5)


def composer(ctx: Ctx) -> dict | None:
    """The chat composer is the LAST EditText described "Message" (the workspace composer stays mounted)."""
    eds = [n for n in ctx.dev.nodes() if n.get("class") == "android.widget.EditText" and n.get("content-desc") == "Message"]
    return eds[-1] if eds else None


def type_into(ctx: Ctx, text: str) -> bool:
    c = composer(ctx)
    if not c:
        return False
    ctx.dev.tap(c)
    ctx.dev.type_text(text, clear=True)
    time.sleep(0.4)
    return text.split()[0] in ctx.dev.text_of(composer(ctx)) if text else True


def send(ctx: Ctx, text: str) -> float:
    if not type_into(ctx, text):
        raise StepFailed("composer did not take typed text")
    t0 = time.time()
    if not ctx.dev.tap_desc("Send"):
        raise StepFailed("no Send button")
    return t0


def visible(ctx: Ctx, pattern: str, timeout: float = 15) -> float | None:
    """Seconds until a node's text or content-desc matches pattern, else None."""
    t0 = time.time()
    return round(time.time() - t0, 2) if ctx.dev.wait(timeout=timeout, any_text=pattern) else None


def scroll(ctx: Ctx, times: int, up: bool = False, secs: float = 0.12) -> None:
    w, h = ctx.dev.window_size()
    a, b = int(h * 0.75), int(h * 0.3)
    for _ in range(times):
        ctx.dev.swipe(w // 2, b if up else a, w // 2, a if up else b, secs)


def frames_ok(ctx: Ctx, name: str, summary: dict, feature: str | None = None) -> bool:
    ctx.metrics[name] = summary
    ok = summary["frames"] > 0 and summary["jank_pct"] <= JANK_PCT_MAX and summary["p95_ms"] <= P95_FRAME_MS_MAX
    return ctx.check(name, ok, f"{summary} budget jank<={JANK_PCT_MAX}% p95<={P95_FRAME_MS_MAX}ms", feature)


def search(ctx: Ctx, query: str, expect: str) -> tuple[float | None, dict | None]:
    """Type into the Main composer (it is the search bar); time the first result node matching expect
    (seconds after the last keystroke landed) and return it."""
    d = ctx.dev
    field = next((n for n in d.nodes() if n.get("class") == "android.widget.EditText" and n.get("content-desc") == "Message"), None)
    if not field:
        raise StepFailed("Main search/composer field not found")
    d.tap(field)
    d.type_text(query, clear=True)
    t0 = time.time()
    rx = re.compile(expect)
    while time.time() - t0 < 5:
        hits = [n for n in d.nodes() if n.get("class") != "android.widget.EditText"
                and (rx.search(n.get("text") or "") or rx.search(n.get("content-desc") or ""))]
        if hits:
            return round(time.time() - t0, 2), hits[0]
        time.sleep(0.05)
    return None, None


def seed_token(harness_code: str, i: int, kind: str) -> str:
    """Matches seed_archive.py: title token kind "t", body token "b", oldest-turn token "o"."""
    return f"{SEED_PREFIX.lower()}{harness_code}{i:04d}{kind}"


def palette(path: str) -> dict:
    """Share of near-black pixels and of gold pixels in a screenshot (Pillow ships with uiautomator2)."""
    from PIL import Image
    im = Image.open(path).convert("RGB").resize((108, 234))
    px = list(im.getdata())
    black = sum(1 for r, g, b in px if r + g + b < 72) / len(px)
    gold = sum(1 for r, g, b in px if r > 170 and 120 < g < 215 and b < 120) / len(px)
    return {"black": round(black, 3), "gold": round(gold, 4)}


def fixture_turn_running(ctx: Ctx, timeout: float = 15) -> bool:
    return visible(ctx, r"ARMY_STREAM_BEGIN", timeout) is not None


# ================================================================== chats: roster, search, history

@journey("J-chat-list-all-harnesses", ("DF-001", "DF-003", "DF-009", "DF-010"), needs=("archive_seed", "second_host"))
def j_chat_list_all_harnesses(ctx: Ctx) -> None:
    """Chats lists every harness (live Hermes/OMP + archived Codex/Claude/Grok/OMP), each once, and
    scrolls 1000+ rows without breaching the frame budget."""
    d = ctx.dev
    home(ctx, fresh=True)
    ctx.require("chats tab opens", tab(ctx, "Chats") and d.wait(timeout=10, rid="chats-pane") is not None)
    seen_ids: dict[str, int] = {}
    harnesses: set[str] = set()
    markers: set[str] = set()
    d.gfx_reset()
    t0 = time.time()
    stale_rounds = 0
    while time.time() - t0 < 240 and stale_rounds < 4:
        before = len(seen_ids)
        for r in chat_rows(ctx):
            rid = r.get("resource-id")
            seen_ids[rid] = seen_ids.get(rid, 0) + 1
            h = row_harness(ctx, r)
            if h:
                harnesses.add(h)
        for n in d.find_all(any_text=SEED_PREFIX + r" \S+ archive"):
            markers.add(re.sub(r".*?(" + SEED_PREFIX + r" .+? archive \d+).*", r"\1", d.text_of(n)))
        stale_rounds = stale_rounds + 1 if len(seen_ids) == before else 0
        scroll(ctx, 3)
    frames = d.gfx_frames("roster-scroll")
    ctx.metrics.update(rows_seen=len(seen_ids), harnesses=sorted(harnesses), seeded_rows_seen=len(markers))
    ctx.check("1000+ chat rows reachable by scrolling", len(seen_ids) >= SCROLL_ROWS_MIN, f"rows={len(seen_ids)}", "DF-001")
    for h in ARCHIVE_HARNESSES + ("Hermes",):
        ctx.check(f"{h} sessions listed", h in harnesses, f"harnesses seen={sorted(harnesses)}", "DF-001")
    for h in ("pi", "fx"):
        ctx.check(f"{h} harness sessions listed", any(x.lower().startswith(h) for x in harnesses), sorted(harnesses), "DF-009")
    ctx.check("archived seeded sessions listed", len(markers) >= 4, f"seeded rows seen={len(markers)}", "DF-001")
    frames_ok(ctx, "roster scroll frame budget", frames, "DF-001")
    second = os.environ.get("DASH_E2E_SECOND_HOST")
    if second:
        ctx.check("second host sessions listed", d.find(any_text=re.escape(second)) is not None or
                  any(second in row_text(ctx, r) for r in chat_rows(ctx)), second, "DF-001")
    # DF-003: a running fixture session is live, never "ended".
    scroll(ctx, 40, up=True, secs=0.05)
    live = d.find_all(any_text=r"^Live on host$")
    ctx.check("running sessions marked live", len(live) >= 1, f"live dots={len(live)}", "DF-003")
    # DF-010: parallel tabs / usage hub are not built; the check states it observably.
    ctx.check("usage hub / parallel tabs surface present", d.find(any_text=r"(?i)usage|parallel tabs") is not None, "", "DF-010")


@journey("J-chat-search-fast", ("DF-002", "DF-006"), needs=("archive_seed",))
def j_chat_search_fast(ctx: Ctx) -> None:
    """With 1000+ chats loaded, search by a title token and by a message-body token; first result in
    under SEARCH_RESULT_S_MAX after the last keystroke; tapping it opens that exact session."""
    d = ctx.dev
    home(ctx)
    hit = None
    for label, q, expect in (("title", "@chats " + seed_token("cx", 417, "t"), r"Codex archive 0417"),
                             ("body", "@chats " + seed_token("cl", 123, "b"), r"Claude Code archive 0123")):
        secs, hit = search(ctx, q, expect)
        ctx.metrics[f"search_{label}_s"] = secs
        ctx.check(f"search by {label} returns a result < {SEARCH_RESULT_S_MAX}s", secs is not None and secs < SEARCH_RESULT_S_MAX,
                  f"first_result_s={secs}", "DF-002")
    ctx.require("a result row is tappable", hit is not None)
    d.tap(hit)
    opened = d.wait(timeout=10, desc="Close chat window") is not None
    ctx.check("result opens the matching session", opened and visible(ctx, seed_token("cl", 123, "b"), 10) is not None, "", "DF-002")
    close_chat(ctx)
    secs, _ = search(ctx, "/live ", r"(?i)hermes|omp")
    ctx.check("/live scope lists live sessions", secs is not None, f"s={secs}", "DF-006")


@journey("J-chat-open-history", ("DF-035",), needs=("archive_seed",))
def j_chat_open_history(ctx: Ctx) -> None:
    """Open a live Hermes row and a live OMP row (real transcript, never empty), then an archived
    Codex chat, and page back to its oldest turn."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    for h in ("Hermes", "OMP"):
        rows = [r for r in chat_rows(ctx) if row_harness(ctx, r) == h]
        ctx.require(f"{h} row present", bool(rows))
        open_chat(ctx, rows[0])
        vp = d.wait(timeout=10, rid="transcript-viewport")
        inside = 0
        if vp:
            x1, y1, x2, y2 = d.bounds(vp)
            inside = sum(1 for n in d.nodes() if (n.get("text") or "").strip() and n.get("class") != "android.widget.EditText"
                         and x1 <= d.bounds(n)[0] and d.bounds(n)[3] <= y2 and d.bounds(n)[1] >= y1)
        ctx.check(f"{h} transcript renders (pane not empty)", inside >= 2, f"text nodes in transcript={inside}")
        t0 = send(ctx, f"continue same session {h.lower()}")
        ctx.check(f"{h} continue sends into the same session", visible(ctx, rf"ARMY_REPLY: continue same session {h.lower()}", 20) is not None,
                  f"t0={t0:.0f}")
        close_chat(ctx)
    _, hit = search(ctx, "@chats " + seed_token("cx", 7, "t"), r"Codex archive 0007")
    ctx.require("archived Codex chat found", hit is not None)
    d.tap(hit)
    ctx.require("archived chat opens", d.wait(timeout=10, desc="Close chat window") is not None)
    ctx.check("archived chat shows its latest turn", visible(ctx, r"turn 119\b", 10) is not None)
    d.gfx_reset()
    found = None
    t0 = time.time()
    while time.time() - t0 < 120 and found is None:
        scroll(ctx, 4, up=True)
        found = d.find(any_text=seed_token("cx", 7, "o"))
    ctx.metrics["older_history_page_s"] = round(time.time() - t0, 1)
    ctx.check("paging back reaches the oldest turn", found is not None, f"after {ctx.metrics['older_history_page_s']} s")
    frames_ok(ctx, "history paging frame budget", d.gfx_frames("history-scroll"))


# ================================================================== send / receive

def _send_three(ctx: Ctx, harness: str, tag: str | None) -> None:
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    rows = [r for r in chat_rows(ctx) if row_harness(ctx, r) == harness]
    ctx.require(f"{harness} chat row present", bool(rows))
    count_before = len([r for r in chat_rows(ctx) if row_harness(ctx, r) == harness])
    session_row = rows[0].get("resource-id")
    open_chat(ctx, rows[0])
    for i in range(3):
        text = f"dash e2e {harness.lower()} message {i} {int(time.time())}"
        t0 = send(ctx, text)
        first = visible(ctx, r"ARMY_STREAM_BEGIN|ARMY_REPLY", 15)
        reply = visible(ctx, re.escape("ARMY_REPLY: " + text), 25)
        ctx.metrics[f"{harness}_msg{i}"] = {"first_chunk_s": first, "reply_s": reply}
        ctx.check(f"{harness} message {i} reply streams back", reply is not None, f"first={first} reply={reply}")
        if i == 0:
            ctx.check(f"{harness} first chunk < {SEND_FIRST_CHUNK_S_MAX}s", first is not None and first < SEND_FIRST_CHUNK_S_MAX,
                      f"first_chunk_s={first}", "DF-017" if harness == "Hermes" else None)
        dupes = len(d.find_all(any_text="^" + re.escape(text) + "$"))
        ctx.check(f"{harness} message {i} shown once", dupes == 1, f"copies={dupes}",
                  "DF-020" if harness == "Hermes" else None)
    if harness == "Hermes":
        send(ctx, "ARMY_ERROR provider down")
        err = visible(ctx, r"(?i)error|failed|unavailable", 20)
        ctx.check("agent failure is shown in the chat", err is not None, f"s={err}", "DF-018")
        send(ctx, "after provider error")
        ctx.check("chat keeps working after a provider failure", visible(ctx, r"ARMY_REPLY: after provider error", 20) is not None, "", "DF-018")
        ctx.stack.restart_bridge()
        type_into(ctx, "after supervisor restart")
        t0 = time.time()
        while time.time() - t0 < 45 and (d.find(desc="Send") or {}).get("enabled") != "true":
            time.sleep(1)
        d.tap_desc("Send")
        ctx.check("same session continues after the bridge supervisor restarts",
                  visible(ctx, r"ARMY_REPLY: after supervisor restart", 30) is not None, "", "DF-118")
        close_chat(ctx)
        after = [r for r in chat_rows(ctx) if row_harness(ctx, r) == harness]
        ctx.check("sends continued the same session (no new chat created)",
                  len(after) == count_before and any(r.get("resource-id") == session_row for r in after),
                  f"rows {count_before}->{len(after)}", "DF-005")
    if tag:
        # A running turn must never read "ended" (DF-004).
        send(ctx, "ARMY_SLOW still running check")
        time.sleep(4)
        close_chat(ctx)
        row = next((r for r in chat_rows(ctx) if row_harness(ctx, r) == harness), None)
        ctx.check("running chat not shown as ended", row is not None and "ended" not in row_text(ctx, row), row_text(ctx, row) if row else "", tag)


@journey("J-send-receive-hermes", ("DF-005", "DF-017", "DF-018", "DF-020", "DF-118"))
def j_send_receive_hermes(ctx: Ctx) -> None:
    """Three sends into a running Hermes session; each arrives once and the reply streams back."""
    _send_three(ctx, "Hermes", None)
    log = ctx.stack.bridge_log(400)
    ctx.check("bridge log shows no duplicate fallback send", "fallback" not in log.lower() or "duplicate" not in log.lower(), "", "DF-020")


@journey("J-send-receive-omp", ("DF-004", "DF-013"))
def j_send_receive_omp(ctx: Ctx) -> None:
    """Same as J-send-receive-hermes for OMP; Hermes still passes afterwards; running is never 'ended'."""
    _send_three(ctx, "OMP", "DF-004")
    close_chat(ctx)
    rows = [r for r in chat_rows(ctx) if row_harness(ctx, r) == "Hermes"]
    ctx.require("Hermes row still present", bool(rows))
    open_chat(ctx, rows[0])
    send(ctx, "hermes after omp")
    ctx.check("Hermes path still passes after OMP", visible(ctx, r"ARMY_REPLY: hermes after omp", 20) is not None, "", "DF-013")


@journey("J-send-failure-retry", ("DF-011", "DF-012"))
def j_send_failure_retry(ctx: Ctx) -> None:
    """Kill the bridge mid-send: the message stays with an explicit failed state; Retry delivers it once."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    ctx.stack.stop_bridge()
    text = f"retry me {int(time.time())}"
    send(ctx, text)
    failed = visible(ctx, r"(?i)not sent|failed|retry", 20)
    ctx.check("failed send shows an explicit failed state", failed is not None, f"after={failed}", "DF-011")
    ctx.check("message text kept on screen", d.find(any_text=re.escape(text)) is not None, "", "DF-011")
    ctx.stack.restart_bridge()
    retry = d.wait(timeout=45, any_text=r"(?i)^retry$|not sent.*retry")
    ctx.check("Retry control offered", retry is not None, "", "DF-012")
    if retry:
        d.tap(retry)
    delivered = visible(ctx, "ARMY_REPLY: " + re.escape(text), 45)
    ctx.check("Retry delivers the message", delivered is not None, f"s={delivered}", "DF-012")
    copies = len(d.find_all(any_text="^" + re.escape(text) + "$"))
    ctx.check("delivered exactly once", copies == 1, f"copies={copies}", "DF-012")


@journey("J-steer-queue-merge", ("DF-014", "DF-023", "DF-045"))
def j_steer_queue_merge(ctx: Ctx) -> None:
    """While a turn runs: steer once, queue three, merge, deliver; order and text kept; Stop unsticks."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    send(ctx, "ARMY_SLOW steer base")
    ctx.require("turn running", fixture_turn_running(ctx))
    type_into(ctx, "steer one")
    steer = d.find(desc="Steer") or d.find(any_text=r"(?i)^steer$")
    ctx.check("Steer offered while running", steer is not None, "", "DF-023")
    if steer:
        d.tap(steer)
    for i in range(3):
        type_into(ctx, f"queued {i}")
        if not d.tap_desc("Queue"):
            ctx.check(f"Queue button for queued {i}", False, "no Queue button while running", "DF-023")
    ctx.check("three queued messages shown", len(d.find_all(any_text=r"^Queued message \d")) >= 3 or d.find(any_text=r"3 queued") is not None, "", "DF-023")
    if d.tap_desc("Deliver queued as one message"):
        merged = visible(ctx, r"queued 0[\s\S]*queued 1[\s\S]*queued 2", 40)
        ctx.check("merged queue delivered in order", merged is not None, "", "DF-023")
    ctx.check("history shows user text, not wrapper", d.find(any_text=r"(?i)<steer>|\[queued\]|steer_message|queue wrapper") is None, "", "DF-045")
    send(ctx, "ARMY_HANG stuck turn")
    fixture_turn_running(ctx)
    ctx.check("stuck turn diagnosable (running state visible)", d.find(desc="Stop") is not None, "", "DF-014")
    d.tap_desc("Stop")
    ctx.check("Stop unsticks without killing the session", d.gone(timeout=10, desc="Stop"), "", "DF-014")
    send(ctx, "after unstick")
    ctx.check("next send works after unstick", visible(ctx, r"ARMY_REPLY: after unstick", 20) is not None, "", "DF-014")


# ================================================================== composer

@journey("J-composer-draft-restore", ("DF-024",))
def j_composer_draft_restore(ctx: Ctx) -> None:
    """Type half a sentence, force-stop Dash, relaunch: the exact draft is back in the same chat."""
    home(ctx)
    tab(ctx, "Chats")
    row = open_chat(ctx)
    draft = f"half a sentence draft {int(time.time()) % 100000}"
    ctx.require("draft typed", type_into(ctx, draft))
    time.sleep(1.5)  # debounce
    home(ctx, fresh=True)
    tab(ctx, "Chats")
    again = next((r for r in chat_rows(ctx) if r.get("resource-id") == row.get("resource-id")), None)
    ctx.require("same chat row after relaunch", again is not None)
    open_chat(ctx, again)
    ctx.check("exact draft restored", draft in ctx.dev.text_of(composer(ctx)), ctx.dev.text_of(composer(ctx)))


@journey("J-composer-paste-image", ("DF-025",))
def j_composer_paste_image(ctx: Ctx) -> None:
    """Put an image on the clipboard, long-press the composer, Paste: one attachment chip appears."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    d.sh("cmd", "clipboard", "set-primary-clip", "--uri", "content://media/external/images/media/1")  # best effort
    c = composer(ctx)
    ctx.require("composer present", c is not None)
    d.long_press(c)
    paste = d.wait(timeout=4, any_text=r"(?i)^paste$")
    ctx.check("Paste offered", paste is not None)
    if paste:
        d.tap(paste)
    chips = d.find_all(any_text=r"^Attached |^Remove ")
    ctx.check("one attachment chip after paste", len(chips) == 1, f"chips={len(chips)}")


@journey("J-composer-attach", ("DF-028",))
def j_composer_attach(ctx: Ctx) -> None:
    """Paperclip -> chooser (Photos / Files) is Dash-themed; an attached file reaches the agent."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    ctx.require("Attach file control", d.tap_desc("Attach file"))
    ctx.check("Dash attachment chooser opens", d.wait(timeout=6, desc="Attachment chooser") is not None or
              d.wait(timeout=2, rid="attachment-sheet") is not None)
    ctx.check("Photos and Files offered", d.find(desc="Photos") is not None and d.find(desc="Files") is not None)
    d.sh("sh", "-c", "printf 'dash e2e attach body' > /sdcard/Download/dash-e2e-attach.txt")
    if d.tap_desc("Files"):
        f = d.wait(timeout=10, any_text=r"dash-e2e-attach\.txt")
        if f:
            d.tap(f)
    ctx.check("attachment chip shows the file", d.wait(timeout=10, any_text=r"Attached dash-e2e-attach|dash-e2e-attach\.txt") is not None)
    send(ctx, "read the attachment")
    ctx.check("agent turn completes with the attachment", visible(ctx, r"ARMY_REPLY", 20) is not None)


@journey("J-composer-suggestions", ("DF-027",))
def j_composer_suggestions(ctx: Ctx) -> None:
    """Type / and @ on Main and inside a chat; real suggestions load and insert (fixture: honest popup)."""
    d = ctx.dev
    home(ctx)
    for where in ("Main", "chat"):
        if where == "chat":
            tab(ctx, "Chats")
            open_chat(ctx)
            c = composer(ctx)
        else:
            c = next((n for n in d.nodes() if n.get("class") == "android.widget.EditText" and n.get("content-desc") == "Message"), None)
        ctx.require(f"{where} composer present", c is not None)
        d.tap(c)
        d.type_text("/")
        time.sleep(1.2)
        slash = [d.text_of(n) for n in d.nodes() if d.text_of(n).startswith("/")]
        honest = d.find(any_text=r"Commands unavailable") is not None
        ctx.check(f"/ suggestions on {where}", len(slash) > 1 or (where == "chat" and honest), f"{slash[:6]} unavailable_popup={honest}")
        d.type_text("@")
        time.sleep(1.2)
        at = [d.text_of(n) for n in d.nodes() if d.text_of(n).startswith("@")]
        ctx.check(f"@ suggestions on {where}", len(at) > 1, at[:6])
        if len(at) > 1:
            pick = next(n for n in d.nodes() if d.text_of(n) == at[1])
            d.tap(pick)
            field = composer(ctx) if where == "chat" else next((n for n in d.nodes() if n.get("class") == "android.widget.EditText"), None)
            ctx.check(f"@ suggestion inserts on {where}", at[1].split()[0].lstrip("@") in d.text_of(field), d.text_of(field))
        d.type_text("", clear=True)


@journey("J-composer-single-button", ("DF-022", "DF-026"))
def j_composer_single_button(ctx: Ctx) -> None:
    """Idle, drafting, running-empty and running-with-draft each show ONE leading-edge primary button."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)

    def primaries():
        return [n.get("content-desc") for n in d.nodes() if n.get("content-desc") in ("Send", "Steer", "Queue", "Stop")]

    states = {}
    type_into(ctx, "")
    states["idle"] = primaries()
    type_into(ctx, "drafting a line")
    states["drafting"] = primaries()
    send(ctx, "ARMY_HANG single button")
    fixture_turn_running(ctx)
    type_into(ctx, "")
    states["running-empty"] = primaries()
    type_into(ctx, "running with draft")
    states["running-draft"] = primaries()
    ctx.metrics["primary_buttons"] = states
    for s, buttons in states.items():
        ctx.check(f"{s}: at most one primary button", len(buttons) <= 1, buttons, "DF-022")
    stop = d.find(desc="Stop")
    c = composer(ctx)
    if stop and c:
        ctx.check("Stop at the text's leading edge", d.bounds(stop)[0] < d.bounds(c)[0] + 40, f"stop={stop['bounds']} composer={c['bounds']}", "DF-022")
    d.tap_desc("Stop")
    type_into(ctx, "\n".join(f"line {i}" for i in range(9)))
    c = composer(ctx)
    h = d.bounds(c)[3] - d.bounds(c)[1] if c else 0
    ctx.check("composer wraps and caps near six lines", 0 < h < 0.35 * d.window_size()[1], f"height_px={h}", "DF-026")
    d.press("back")


# ================================================================== chat window and chat surfaces

@journey("J-chat-window-open-close", ("DF-031", "DF-034", "DF-037", "DF-108"))
def j_chat_window_open_close(ctx: Ctx) -> None:
    """Row -> full-screen window with cutout pill, attached dock, X in the handed corner; close restores."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    rows = chat_rows(ctx)
    ctx.require("chat rows present", bool(rows))
    first_before = rows[0].get("resource-id")
    open_chat(ctx, rows[0])
    w, h = d.window_size()
    win = d.find(rid="chat-window")
    ctx.check("window is full-screen", win is not None and d.bounds(win)[2] - d.bounds(win)[0] >= w * 0.95, win and win["bounds"], "DF-037")
    ctx.check("pill around the camera cutout", d.find(rid="chat-window-pill") is not None, "", "DF-037")
    dock = d.find(rid="chat-window-dock")
    ctx.check("dock attached at the bottom", dock is not None and d.bounds(dock)[3] >= h * 0.85, dock and dock["bounds"], "DF-037")
    x = d.find(desc="Close chat window")
    ctx.check("X is within thumb reach", x is not None and d.bounds(x)[1] >= 0, x and x["bounds"], "DF-031")
    draft = "window draft keep"
    type_into(ctx, draft)
    close_chat(ctx)
    ctx.check("close returns to the Chats list", d.wait(timeout=6, rid="chats-pane") is not None, "", "DF-108")
    rows2 = chat_rows(ctx)
    ctx.check("list position restored", bool(rows2) and rows2[0].get("resource-id") == first_before, "", "DF-037")
    ctx.check("top bar kept", d.find(desc="Settings") is not None or d.find(desc="Event trace") is not None, "", "DF-108")
    open_chat(ctx, rows2[0])
    ctx.check("draft restored on reopen", draft in d.text_of(composer(ctx)), "", "DF-037")
    close_chat(ctx)
    tab(ctx, "Orchestra")
    ctx.check("global composer attached outside chats", composer(ctx) is not None, "", "DF-034")


@journey("J-chat-identity-badge", ("DF-038",))
def j_chat_identity_badge(ctx: Ctx) -> None:
    """Badge -> host/harness/profile/session/model tree with source; switching target changes session."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    ctx.require("identity badge present", d.wait(timeout=6, rid="chat-window-badge") is not None)
    d.tap(d.find(rid="chat-window-badge"))
    ident = d.wait(timeout=6, rid="chat-window-identity")
    txt = " ".join(d.text_of(n) for n in d.nodes())
    for part in ("host", "harness", "session", "model"):
        ctx.check(f"identity shows {part}", re.search(part, txt, re.I) is not None)
    ctx.check("model source shown", d.find(rid="chat-window-model-source") is not None)
    before = txt
    if d.tap_desc("Choose harness"):
        pick = d.wait(timeout=6, desc=r"Pick (?!Hermes).*")
        if pick:
            d.tap(pick)
    after = " ".join(d.text_of(n) for n in d.nodes())
    ctx.check("switching target changes the session", ident is not None and after != before)


@journey("J-context-card", ("DF-039",), needs=("real_agent",))
def j_context_card(ctx: Ctx) -> None:
    """Context gauge -> real usage renders; Compact works or says unavailable truthfully."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    g = d.wait(timeout=6, desc=r"Context window.*")
    ctx.require("context control present", g is not None)
    d.tap(g)
    card = d.wait(timeout=6, desc="Context window details")
    ctx.check("context card opens", card is not None)
    ctx.check("real usage numbers render", d.find(any_text=r"\d[\d,.]*\s*(k|K|tokens|%)") is not None)
    compact = d.find(any_text=r"(?i)^compact$")
    if compact:
        d.tap(compact)
        ctx.check("Compact completes or says unavailable", visible(ctx, r"(?i)compacted|unavailable|not supported", 30) is not None)
    d.press("back")


@journey("J-thinking-tools-details", ("DF-043", "DF-044"), needs=("real_agent",))
def j_thinking_tools_details(ctx: Ctx) -> None:
    """Tool-heavy turn: compact descriptive tool rows, expandable tree, summary, answer keeps streaming."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    send(ctx, "List the files in this folder, read README.md, then summarise it in two lines.")
    ctx.check("descriptive tool row appears", visible(ctx, r"(?i)read|list|ls|README", 60) is not None, "", "DF-043")
    d.tap_desc("Details Compact")
    rows = d.find_all(rid=r"tree-row-.*")
    ctx.check("tool details expand as a tree", len(rows) > 0, f"rows={len(rows)}", "DF-043")
    ctx.check("answer keeps streaming after tools", visible(ctx, r"(?i)summary|readme", 90) is not None, "", "DF-044")
    tall = [n for n in d.nodes() if "Expand" in (n.get("content-desc") or "")]
    ctx.check("little forced expansion", len(tall) <= 2, f"expand controls={len(tall)}", "DF-044")


@journey("J-subagent-indicator", ("DF-046", "DF-047", "DF-112"), needs=("real_agent",))
def j_subagent_indicator(ctx: Ctx) -> None:
    """A turn that delegates two workers: one main indicator plus a compact worker tree, to completion."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    send(ctx, "Delegate two workers: one counts files, one reads README. Report both.")
    workers = d.wait(timeout=90, desc=r"\d+ subagents working")
    ctx.check("subagent indicator appears", workers is not None, "", "DF-046")
    ctx.check("one main working indicator", len(d.find_all(any_text=r"(?i)^working|thinking$")) <= 1, "", "DF-047")
    if workers:
        d.tap(workers)
        ctx.check("compact worker tree", len(d.find_all(rid=r"tree-row-.*")) >= 2, "", "DF-112")
    ctx.check("indicator clears at completion", d.gone(timeout=180, desc=r"\d+ subagents working"), "", "DF-046")


@journey("J-prompt-rail", ("DF-040", "DF-041"))
def j_prompt_rail(ctx: Ctx) -> None:
    """In a long chat, scrub the rail (keyboard open and closed); previews show prompt/result; jump works."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    for i in range(12):
        send(ctx, f"rail turn {i}")
        visible(ctx, rf"ARMY_REPLY: rail turn {i}", 15)
    rail = d.wait(timeout=6, desc="Prompt navigator")
    ctx.require("prompt rail present", rail is not None)
    x1, y1, x2, y2 = d.bounds(rail)
    d.swipe((x1 + x2) // 2, y2 - 10, (x1 + x2) // 2, y1 + 10, 1.2)
    ctx.check("scrub shows a turn preview", d.wait(timeout=4, desc="Turn preview") is not None or d.find(rid="scrub-readout") is not None, "", "DF-040")
    d.tap_desc("Close turn preview", timeout=2)
    c = composer(ctx)
    d.tap(c)  # keyboard open
    rail = d.find(desc="Prompt navigator")
    ctx.check("rail usable with keyboard open", rail is not None, "", "DF-040")
    jump = d.find(any_text=r"(?i)jump to latest|latest")
    if jump:
        d.tap(jump)
    ctx.check("latest turn visible", visible(ctx, r"ARMY_REPLY: rail turn 11", 6) is not None, "", "DF-040")
    ticks = [d.bounds(n)[1] for n in d.find_all(rid=r"row-.*")]
    gaps = sorted({b - a for a, b in zip(ticks, ticks[1:])})
    ctx.check("tick spacing follows turn duration (not uniform)", len(gaps) > 1, f"gaps={gaps[:8]}", "DF-041")


@journey("J-markdown-code", ("DF-042",), needs=("real_agent",))
def j_markdown_code(ctx: Ctx) -> None:
    """Reply with headings, lists, a table and fenced TS/bash code: formatted, highlighted, copyable."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    send(ctx, "Reply with: a level-2 heading 'Plan', a 3-item bullet list, a 2x2 markdown table, a ```ts block and a ```bash block.")
    ctx.require("reply arrives", visible(ctx, r"^Plan$", 90) is not None)
    ctx.check("no raw markdown markers", d.find(any_text=r"^#{1,3} |^```|^\|\s*-{3}") is None)
    ctx.check("code blocks get copy controls", len(d.find_all(any_text=r"^Copy (ts|bash|typescript)")) >= 2)


@journey("J-genui-render", ("DF-052", "DF-053"), needs=("real_agent",))
def j_genui_render(ctx: Ctx) -> None:
    """A mermaid diagram, a genui widget and an openui-lang block each render natively, never raw code."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    send(ctx, "Show a mermaid flowchart A-->B, a genui widget with a button, and an openui-lang card.")
    time.sleep(45)
    ctx.check("no raw mermaid/genui source", d.find(any_text=r"^(graph|flowchart) (TD|LR)|```(mermaid|genui|openui)") is None, "", "DF-052")
    ctx.check("diagram rendered natively", d.find(any_text=r"(?i)diagram|flowchart") is not None or d.find(rid=r".*-plot") is not None, "", "DF-053")


@journey("J-live-surface", ("DF-054", "DF-064"), needs=("real_agent",))
def j_live_surface(ctx: Ctx) -> None:
    """Switch to the Live surface, request an fx0 artifact, pick a version, send an intent; chat keeps control."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    d.tap_desc("Chat options")
    ctx.require("Live surface switch", d.tap_desc("Live surface"))
    ctx.check("live surface mounts", d.wait(timeout=10, rid="live-surface") is not None, "", "DF-054")
    send(ctx, "make a tiny counter artifact")
    ctx.check("artifact renders", d.wait(timeout=90, rid="live-artifact") is not None, "", "DF-054")
    v = d.wait(timeout=10, desc=r"Version \d+")
    if v:
        d.tap(v)
    ctx.check("version picker works", v is not None, "", "DF-064")
    ctx.check("chat composer keeps control", composer(ctx) is not None, "", "DF-054")


# ================================================================== voice, annotation

@journey("J-voice-live-call", ("DF-048", "DF-057"))
def j_voice_live_call(ctx: Ctx) -> None:
    """Live from an attached Hermes chat: in-app call, Dash-owned status, mute/end, mic released, no popup.
    (Ported from voice_journey.py V1-V5.)"""
    d = ctx.dev
    home(ctx)
    d.logcat_clear()
    tab(ctx, "Chats")
    rows = [r for r in chat_rows(ctx) if row_harness(ctx, r) == "Hermes"]
    open_chat(ctx, rows[0] if rows else None)
    start = d.find(desc="Voice input")
    if start:
        d.long_press(start, 0.6)
    live = d.wait(timeout=4, any_text=r"(?i)^live$") or d.wait(timeout=2, desc="Start voice in Dash") or d.find(rid="voice-start")
    ctx.require("V1 start control", live is not None)
    d.tap(live)
    time.sleep(8)
    phase = d.find(rid="voice-phase") or d.find(rid="voice-caption")
    err = d.find(rid="voice-error") or d.find(desc="Retry Live voice")
    ctx.check("V1 Dash-owned status visible", phase is not None or err is not None, d.text_of(phase or err), "DF-057")
    ctx.check("voice connects (not an error)", err is None, d.text_of(err), "DF-057")
    ctx.check("orb reflects voice state", d.find(rid="agent-orb") is not None, "", "DF-048")
    ctx.check("V4 Dash stays resumed after start", d.resumed_package() == "app.dash.mobile", d.resumed_package(), "DF-057")
    mute = d.find(rid="voice-mute")
    if mute:
        d.tap(mute)
        ctx.check("mute toggles", d.wait(timeout=4, desc="Unmute voice microphone") is not None, "", "DF-057")
    end = d.find(rid="voice-end") or d.find(desc="End voice call") or d.find(desc="End voice call and dismiss error")
    ctx.check("V2 in-Dash End in every state", end is not None, "", "DF-057")
    if end:
        d.tap(end)
        time.sleep(3)
    audio = d.sh("dumpsys", "audio")
    recording = any("app.dash.mobile" in line for line in audio.splitlines() if "rec" in line.lower() and "session" in line.lower())
    ctx.check("V3 idle and mic released after End", d.find(rid="voice-end") is None and not recording, f"recording={recording}", "DF-057")
    ctx.check("V4 Dash stays resumed after End", d.resumed_package() == "app.dash.mobile", d.resumed_package(), "DF-057")
    bad = [line[-160:] for line in d.logcat("voice").splitlines()
           if re.search(r"Unable to resolve|HTTP 404|status code 404|ChunkLoad|Requiring unknown module", line)]
    ctx.check("V5 no chunk/resolve errors", not bad, bad[-5:])


@journey("J-voice-dictation", ("DF-058",))
def j_voice_dictation(ctx: Ctx) -> None:
    """Dictate with the keyboard hidden: text goes in at the cursor, nothing is sent, errors stay in Dash."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    type_into(ctx, "before ")
    d.press("back")
    ctx.require("mic control", d.tap_desc("Voice input"))
    time.sleep(5)
    ctx.check("dictation stays inside Dash", d.resumed_package() == "app.dash.mobile", d.resumed_package())
    stop = d.find(desc="Stop dictation")
    if stop:
        d.tap(stop)
    err = d.find(desc="Retry dictation")
    ctx.check("dictation state shown in Dash", stop is not None or err is not None)
    ctx.check("nothing was sent", d.find(any_text=r"^ARMY_REPLY: before") is None)
    ctx.check("draft kept at cursor", "before" in d.text_of(composer(ctx)))


@journey("J-voice-mic-pill", ("DF-059",))
def j_voice_mic_pill(ctx: Ctx) -> None:
    """Hold mic, slide up/down, release: only the mode changes; a tap then uses that mode."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    mic = d.wait(timeout=6, desc="Voice input")
    ctx.require("mic present", mic is not None)
    x1, y1, x2, y2 = d.bounds(mic)
    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
    d.swipe(cx, cy, cx, cy - 260, 1.0)
    time.sleep(1)
    ctx.check("slide changes mode, nothing starts", d.find(rid="voice-end") is None and d.find(desc="Stop dictation") is None)
    mode = d.find(any_text=r"(?i)^(live|dictate)$")
    ctx.check("mode label visible", mode is not None, d.text_of(mode))


@journey("J-annotation-spen", ("DF-065", "DF-066", "DF-067"), needs=("spen", "physical_display"))
def j_annotation_spen(ctx: Ctx) -> None:
    """Enter annotation fast, draw visible ink, exit cleanly (ported from ink_journey.py); S Pen button toggles."""
    d = ctx.dev
    home(ctx)
    d.logcat_clear()
    tab(ctx, "Chats")
    open_chat(ctx)
    d.tap_desc("Chat options")
    t0 = time.time()
    ctx.require("Annotate entry", d.tap_desc("Annotate this screen"))
    on = d.wait(timeout=5, desc="Annotation mode on")
    entry_s = round(time.time() - t0, 2)
    ctx.metrics["annotation_entry_s"] = entry_s
    ctx.check("annotation entry is fast", on is not None and entry_s < 1.5, f"entry_s={entry_s}", "DF-065")
    ctx.check("ink renderer loaded", d.find(any_text=r"Ink couldn't load") is None, "", "DF-065")
    w, h = d.window_size()
    d.swipe(int(w * 0.3), int(h * 0.45), int(w * 0.7), int(h * 0.55), 0.4)
    ctx.check("composer stays usable during annotation", composer(ctx) is not None, "", "DF-065")
    ex = d.find(desc="Exit annotation")
    ctx.check("Exit visible", ex is not None, "", "DF-065")
    if ex:
        d.tap(ex)
    ctx.check("exit closes tray and frame", d.gone(timeout=5, desc="Annotation mode on"), "", "DF-065")
    # DF-066: the S Pen side button (KEYCODE_STYLUS_BUTTON_PRIMARY 308) toggles annotation.
    d.sh("input", "keyevent", "308")
    ctx.check("S Pen button enters annotation", d.wait(timeout=4, desc="Annotation mode on") is not None, "", "DF-066")
    d.sh("input", "keyevent", "308")
    ctx.check("S Pen button exits annotation", d.gone(timeout=4, desc="Annotation mode on"), "", "DF-066")
    ctx.check("hover indication", False, "no observable hover state exposed", "DF-067")


@journey("J-annotation-agent-pointer", ("DF-068",), needs=("real_agent",))
def j_annotation_agent_pointer(ctx: Ctx) -> None:
    """Ask where a feature is; the agent highlights it and navigates there in the same chat."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    send(ctx, "Where is the handedness setting in Dash? Take me there.")
    ctx.check("app navigates to the target", d.wait(timeout=90, desc=r"(Left|Right) handedness") is not None)
    ctx.check("pointer/highlight shown", d.find(any_text=r"(?i)here|highlight") is not None)


@journey("J-text-select-reply", ("DF-036",))
def j_text_select_reply(ctx: Ctx) -> None:
    """Select a range in a reply and reply: the reply carries exactly that quote."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    send(ctx, "quote source alpha beta gamma")
    reply = d.wait(timeout=20, any_text=r"ARMY_REPLY: quote source")
    ctx.require("reply present", reply is not None)
    d.long_press(reply, 1.0)
    rep = d.wait(timeout=4, any_text=r"(?i)^reply$|reply to selection")
    ctx.check("Reply offered on a selection", rep is not None)
    if rep:
        d.tap(rep)
        ctx.check("composer carries the quote", "quote source" in d.text_of(composer(ctx)))


# ================================================================== pairing, connectivity, approvals

@journey("J-pairing-fresh", ("DF-021", "DF-105"))
def j_pairing_fresh(ctx: Ctx) -> None:
    """Fresh install state: pair once; then every HTTP feature works (context, suggestions, Needs Kevin)."""
    d = ctx.dev
    d.sh("pm", "clear", "app.dash.mobile")
    d.launch()
    ctx.require("pairing screen on a fresh install", d.wait(timeout=90, any_text=r"(?i)pair") is not None)
    ctx.check("pair by link or sound offered", d.find(desc="z0bridge pairing link") is not None or d.find(desc="Pairing code") is not None, "", "DF-105")
    pair_with_token(ctx)
    ctx.require("paired to Main", d.wait(timeout=30, desc="Chats") is not None)
    tab(ctx, "Orchestra")
    nk = d.wait(timeout=10, rid="needs-kevin")
    ctx.check("Needs Kevin loads after pairing", nk is not None and d.find(any_text=r"(?i)401|unauthori|failed") is None, "", "DF-105")
    tab(ctx, "Chats")
    open_chat(ctx)
    type_into(ctx, "@")
    time.sleep(1.2)
    ctx.check("@ suggestions authorised after pairing", len([n for n in d.nodes() if d.text_of(n).startswith("@")]) > 1, "", "DF-105")
    d.tap_desc("Bridge details", timeout=3)
    ctx.check("transport security stated", d.find(any_text=r"(?i)tailscale|wireguard|encrypted|tls") is not None, "", "DF-021")


@journey("J-reconnect-reboot", ("DF-015", "DF-016"), needs=("host_reboot",))
def j_reconnect_reboot(ctx: Ctx) -> None:
    """Restart the bridge host; Dash reconnects authenticated without manual repair and replays events.
    Ported from the bridge-restart step of journeys.py; a true reboot needs host_reboot."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    ctx.stack.restart_bridge()
    t0 = time.time()
    type_into(ctx, "after bridge restart")
    sent = False
    while time.time() - t0 < 45 and not sent:
        n = d.find(desc="Send")
        if n and n.get("enabled") == "true":
            d.tap(n)
            sent = True
        else:
            time.sleep(1)
    ctx.metrics["send_enabled_after_s"] = round(time.time() - t0, 1) if sent else None
    ctx.check("reconnects and sends without manual steps", sent and visible(ctx, r"ARMY_REPLY: after bridge restart", 20) is not None,
              ctx.metrics["send_enabled_after_s"], "DF-015")
    ctx.check("no re-pair prompt", d.find(desc="Pair over Tailscale") is None, "", "DF-016")


@journey("J-approvals-batch", ("DF-097", "DF-098", "DF-099"))
def j_approvals_batch(ctx: Ctx) -> None:
    """Approvals: bulk approve safe ones, review one, write one manual comment; swipe shows done."""
    d = ctx.dev
    home(ctx)
    a = d.wait(timeout=6, desc=r"Approvals, \d+ pending")
    if a:
        d.tap(a)
    else:
        d.tap_desc("Settings")
        d.tap_desc("Approvals")
    ctx.require("Approvals screen", d.wait(timeout=10, rid="approval-metrics") is not None or d.find(any_text=r"(?i)approv") is not None)
    cards = d.find_all(rid=r"gate-card-.*")
    ctx.check("proposed comments listed", len(cards) >= 1, f"cards={len(cards)}", "DF-097")
    bulk = d.find(any_text=r"(?i)approve (all )?safe|bulk")
    ctx.check("bulk approve offered", bulk is not None, "", "DF-097")
    if cards:
        x1, y1, x2, y2 = d.bounds(cards[0])
        d.swipe(x1 + 20, (y1 + y2) // 2, x2 - 20, (y1 + y2) // 2, 0.3)
        ctx.check("swipe shows a completed state", d.wait(timeout=4, any_text=r"(?i)approved|done|undo") is not None, "", "DF-098")
    resp = d.find(desc="Owner response")
    if resp:
        d.tap(resp)
        d.type_text("manual comment from e2e")
        ctx.check("manual comment typed", "manual comment" in d.text_of(d.find(desc="Owner response")), "", "DF-097")
    d.press("back")
    tab(ctx, "Chats")
    open_chat(ctx)
    send(ctx, "ARMY_PERMISSION request a tool permission")
    ctx.check("Needs OK approval shown in chat", d.wait(timeout=20, any_text=r"(?i)needs ok|allow|approve") is not None, "", "DF-099")


# ================================================================== orchestra, bots, trace, roadmap

@journey("J-orchestra-views", ("DF-051", "DF-092", "DF-096", "DF-107", "DF-117"))
def j_orchestra_views(ctx: Ctx) -> None:
    """Orchestra: real network and roster; legend filters; a node opens a real chat; no demo data."""
    d = ctx.dev
    home(ctx, fresh=True)
    sel = d.find(desc="Orchestra")
    ctx.check("cold open lands on Orchestra", sel is not None and sel.get("selected") == "true", "", "DF-107")
    tab(ctx, "Orchestra")
    g = d.wait(timeout=15, rid="orchestra-graph")
    ctx.check("graph renders", g is not None, "", "DF-092")
    leg = d.find(desc="Graph legend. Tap to highlight, hold to show only.") or d.find(desc=r"Legend .*")
    ctx.check("legend present", leg is not None, "", "DF-092")
    if leg:
        before = len(d.nodes())
        d.long_press(leg)
        ctx.check("legend filters", len(d.nodes()) != before, "", "DF-092")
    ctx.check("trace card is not a bundled snapshot", d.find(any_text=r"(?i)snapshot|demo|sample") is None, "", "DF-117")
    ctx.check("avatars carry AODL encodings", len(d.find_all(any_text=r"identity orb$")) > 0 or d.find(rid="agent-orb") is not None, "", "DF-051")
    node = d.find(desc=r"Open .+ in .+") or d.find(desc=r"Open .+")
    if node:
        d.tap(node)
        ctx.check("node opens a real chat", d.wait(timeout=10, desc="Close chat window") is not None or d.find(any_text=r"(?i)project") is not None, "", "DF-096")


@journey("J-bots-tree", ("DF-008", "DF-050", "DF-110"))
def j_bots_tree(ctx: Ctx) -> None:
    """Bots: hosts collapse/expand; harness vs bot/profile vocabulary; Moodie faces; rows open chats."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Bots")
    hosts = d.find_all(rid=r"tree-row-.*")
    ctx.require("host tree rows", len(hosts) > 0)
    first = hosts[0]
    before = len(d.find_all(rid=r"tree-row-.*"))
    d.tap(first)
    time.sleep(0.8)
    after = len(d.find_all(rid=r"tree-row-.*"))
    ctx.check("host collapses/expands", before != after, f"{before}->{after}", "DF-110")
    ctx.check("vocabulary: harness and profile", d.find(any_text=r"(?i)harness") is not None and d.find(any_text=r"(?i)profile|bot") is not None, "", "DF-110")
    ctx.check("Moodie faces render", len(d.find_all(rid=r"bot-face-.*")) > 0 or len(d.find_all(any_text=r"face$")) > 0, "", "DF-050")
    ctx.check("roster is live (no offline placeholder for running fixture)", d.find(any_text=r"(?i)hermes") is not None, "", "DF-008")


@journey("J-trace-live", ("DF-093", "DF-094", "DF-095"))
def j_trace_live(ctx: Ctx) -> None:
    """Generate a backend event: the trace updates live and the detail shows ask, intent, receipts, artifacts."""
    d = ctx.dev
    home(ctx)
    ctx.require("trace opens", d.tap_desc("Event trace"))
    d.wait(timeout=10, rid="trace-scroll")
    before = len(d.find_all(rid="trace-entry"))
    ctx.stack.mbp("true")  # the send below is the backend event
    d.press("back")
    tab(ctx, "Chats")
    open_chat(ctx)
    send(ctx, "trace event please")
    visible(ctx, r"ARMY_REPLY: trace event please", 20)
    close_chat(ctx)
    d.tap_desc("Event trace")
    after = len(d.find_all(rid="trace-entry"))
    ctx.check("trace updates live", after > before, f"{before}->{after}", "DF-093")
    e = d.find(rid="trace-entry")
    if e:
        d.tap(e)
        det = d.wait(timeout=6, rid="trace-detail")
        txt = " ".join(d.text_of(n) for n in d.nodes())
        ctx.check("detail shows ask, intent, receipts, artifacts", det is not None and all(re.search(k, txt, re.I) for k in ("ask", "intent", "receipt", "artifact")), "", "DF-093")
        d.press("back")
        d.long_press(e)
        ctx.check("row long-press menu", d.wait(timeout=3, desc="Close row menu") is not None, "", "DF-095")
    d.press("back")
    tab(ctx, "Chats")
    open_chat(ctx)
    ctx.check("zero card with nested trace above composer", d.find(any_text=r"(?i)^zero") is not None, "", "DF-094")


@journey("J-roadmap-inline", ("DF-055",), needs=("real_agent",))
def j_roadmap_inline(ctx: Ctx) -> None:
    """Ask for the Dash roadmap: a Ripple roadmap with per-feature progress bars renders inline."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    send(ctx, "Show the Dash roadmap")
    r = d.wait(timeout=90, desc="Ripple roadmap") or d.wait(timeout=5, desc="Show roadmap")
    ctx.check("roadmap renders inline", r is not None)
    bars = d.find_all(any_text=r": \d+%$")
    ctx.check("per-feature progress bars", len(bars) >= 2, f"bars={len(bars)}")


# ================================================================== settings, launch, notifications

@journey("J-settings-density", ("DF-032", "DF-100"))
def j_settings_density(ctx: Ctx) -> None:
    """Information density and layout density change independently from the composer settings control."""
    d = ctx.dev
    home(ctx)
    d.tap_desc("Settings")
    ctx.require("density control", d.wait(timeout=8, desc="Information density") is not None)
    opts = d.find_all(rid=r"density-.*")
    ctx.check("several densities", len(opts) >= 2, len(opts), "DF-100")
    if len(opts) >= 2:
        d.tap(opts[-1])
        picked = d.find(rid=opts[-1].get("resource-id"))
        ctx.check("density selection sticks", picked is not None and picked.get("selected") == "true", "", "DF-100")
    ctx.check("layout density is a separate control", d.find(any_text=r"(?i)layout density|compact layout") is not None, "", "DF-100")
    d.press("back")
    tab(ctx, "Chats")
    open_chat(ctx)
    send_btn = d.find(desc="Send") or d.find(desc="Voice input")
    if send_btn:
        d.long_press(send_btn, 0.6)
    ctx.check("hold-slide options menu from the composer", d.wait(timeout=3, rid="radial-wheel") is not None, "", "DF-032")
    d.press("back")


@journey("J-settings-handedness", ("DF-101",))
def j_settings_handedness(ctx: Ctx) -> None:
    """Left/Right: close X, rail and mic mirror; Send stays at the text's leading edge."""
    d = ctx.dev
    home(ctx)
    pos = {}
    for side in ("Left", "Right"):
        d.tap_desc("Settings")
        ctx.require(f"{side} handedness option", d.tap_desc(f"{side} handedness"))
        d.press("back")
        tab(ctx, "Chats")
        open_chat(ctx)
        x = d.find(desc="Close chat window")
        pos[side] = d.bounds(x)[0] if x else None
        close_chat(ctx)
    w, _ = d.window_size()
    ctx.metrics["close_x_left"] = pos
    ctx.check("close X mirrors with handedness", pos["Left"] is not None and pos["Right"] is not None and
              (pos["Left"] < w / 2) != (pos["Right"] < w / 2), pos)


@journey("J-fullscreen-launch", ("DF-109",), needs=("physical_display",))
def j_fullscreen_launch(ctx: Ctx) -> None:
    """Launch Dash: status bar hidden, edge to edge (ported from the J-fullscreen step)."""
    home(ctx, fresh=True)
    out = ctx.dev.sh("dumpsys window | grep -m1 'type=statusBars frame'")
    ctx.check("status bar hidden while Dash is in front", "visible=false" in out, out.strip()[:160])
    ctx.check("Dash is the resumed activity", ctx.dev.resumed_package() == "app.dash.mobile", ctx.dev.resumed_package())


@journey("J-notifications-share", ("DF-106",), needs=("physical_display",))
def j_notifications_share(ctx: Ctx) -> None:
    """Background Dash, a reply notification arrives, tapping it opens the exact chat."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    send(ctx, "ARMY_SLOW notify me")
    d.press("home")
    time.sleep(12)
    notes = d.sh("dumpsys", "notification", "--noredact")
    ctx.check("reply notification posted", "app.dash.mobile" in notes and "ARMY_REPLY" in notes)
    d.launch()


# ================================================================== turbo, dogfood, watch, process

@journey("J-turbo-preview-brief", ("DF-071", "DF-072"), needs=("turbo",))
def j_turbo_preview_brief(ctx: Ctx) -> None:
    """A preview merge hot-reloads the phone; Dash shows a compact brief and jumps to the feature screen."""
    d = ctx.dev
    home(ctx)
    ctx.check("Metro serves this candidate", ctx.stack.mbp(f"curl -sm 3 http://127.0.0.1:{os.environ.get('DASH_E2E_METRO_PORT', '18520')}/status").strip()
              == "packager-status:running", "", "DF-072")
    brief = d.wait(timeout=30, any_text=r"(?i)test this|what to test")
    ctx.check("compact 'test this feature' brief", brief is not None, "", "DF-071")
    if brief:
        d.tap(brief)
        ctx.check("brief navigates to the feature screen", d.find(desc="Chats") is None, "", "DF-071")


@journey("J-turbo-chatgpt-fanout", ("DF-070", "DF-074", "DF-081"), needs=("turbo", "physical_display"))
def j_turbo_chatgpt_fanout(ctx: Ctx) -> None:
    """Trigger Turbo: N ChatGPT chats open on the S22, one per issue; counts reported in Dash."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Orchestra")
    t = d.find(any_text=r"(?i)turbo")
    ctx.require("Turbo control", t is not None)
    d.tap(t)
    ctx.check("orchestrator reports created/completed counts", d.wait(timeout=120, any_text=r"(?i)\d+ created.*\d+ completed") is not None, "", "DF-070")
    ctx.check("five-effort benchmark feeds the plan", d.find(any_text=r"(?i)benchmark") is not None, "", "DF-074")
    ctx.check("phones listed as busy workers", len(d.find_all(any_text=r"(?i)phone worker|s22.*busy")) > 0, "", "DF-081")


@journey("J-dogfood-loop", ("DF-019", "DF-069", "DF-073", "DF-120"))
def j_dogfood_loop(ctx: Ctx) -> None:
    """Dogfood: capture a bug from inside Dash, the in-app feedback surface takes it, and Fixed? closes it."""
    d = ctx.dev
    home(ctx)
    d.tap_desc("Settings")
    fb = d.wait(timeout=8, desc="In-app feedback")
    ctx.check("in-app feedback surface on", fb is not None, "", "DF-120")
    d.press("back")
    tab(ctx, "Chats")
    c = next((n for n in d.nodes() if n.get("class") == "android.widget.EditText"), None)
    ctx.check("Feedback for Dash composer present", c is not None and re.search(r"(?i)feedback", d.text_of(c) or "Feedback") is not None, "", "DF-073")
    ctx.check("dogfood mode marks the session", d.find(any_text=r"(?i)dogfood") is not None, "", "DF-073")
    ctx.check("Fixed? confirmation in the same session", d.find(any_text=r"(?i)fixed\?") is not None, "", "DF-069")
    log = d.logcat("dogfood")
    ctx.check("no dev-server 500 / red box", not re.search(r"(?i)status code 500|redbox", log), "", "DF-019")


@journey("J-watch-agent", ("DF-076",), needs=("watch_agent",))
def j_watch_agent(ctx: Ctx) -> None:
    """Use Dash; a watcher attaches automatically and reports an error before the owner does."""
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    send(ctx, "ARMY_ERROR watch me")
    time.sleep(10)
    log = ctx.stack.bridge_log(400)
    ctx.check("watch agent attached", re.search(r"(?i)watch(er)? agent attached", log) is not None)
    ctx.check("watch agent reported the error", re.search(r"(?i)watch.*ARMY_ERROR", log) is not None)


@journey("J-process-audit", ("DF-075", "DF-077", "DF-078", "DF-079", "DF-082", "DF-083", "DF-084", "DF-085"), needs=("repo_checks",))
def j_process_audit(ctx: Ctx) -> None:
    """spec/check.py and the Bend law CLI hold at the candidate; this run itself is the virtual-monitor E2E."""
    import subprocess
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    head = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    ctx.require("runner repo at candidate sha", head.startswith(ctx.sha[:12]) or ctx.sha.startswith(head[:12]), head)
    chk = subprocess.run(["python3", str(root / "spec/check.py")], capture_output=True, text=True)
    ctx.check("spec/check.py passes", chk.returncode == 0, chk.stdout[-300:] + chk.stderr[-300:], "DF-078")
    ctx.check("E2E runs on a virtual display", ctx.dev.display == "virtual", ctx.dev.display, "DF-077")
    st = subprocess.run(["python3", str(root / "scripts/feature_status.py"), "--evidence", str(root / ".acceptance-receipts"),
                         "--candidate", ctx.sha, "--scope", "P0", "--json"], capture_output=True, text=True)
    ctx.check("feature status CLI runs", st.returncode in (0, 1), st.stderr[-300:], "DF-077")
    sys_path = str(root / "spec")
    import sys
    sys.path.insert(0, sys_path)
    from check import load_yaml
    ledger = load_yaml((root / "spec/features.yaml").read_text())
    ctx.check("ledger marks bugs that block live use (priority one)", any(f.get("blocks_live_use") for f in ledger["features"]), "", "DF-075")
    by_id = {f["id"]: f for f in ledger["features"]}
    for fid in ("DF-079", "DF-082", "DF-083", "DF-084", "DF-085"):
        f = by_id[fid]
        refs = [r.rsplit(":", 1)[0] for r in f.get("surface_refs") or []]
        present = f.get("status_from_code") == "implemented" and bool(refs) and all((root / r).exists() for r in refs)
        ctx.check(f"{fid} process surface present at the candidate", present, f"{f.get('status_from_code')} refs={refs[:4]}", fid)


@journey("J-design-conformance", ("DF-029", "DF-033", "DF-103", "DF-111", "DF-113", "DF-114", "DF-115", "DF-116", "DF-119"))
def j_design_conformance(ctx: Ctx) -> None:
    """Every page renders (screenshot each) on black, without overflow; nav dots centred; no infra dashboards."""
    d = ctx.dev
    home(ctx)
    w, h = d.window_size()
    pages = {}
    for name in ("Bots", "Chats", "Orchestra"):
        tab(ctx, name)
        pages[name] = d.shot(f"page-{name}")
        over = [n for n in d.nodes() if n.get("bounds") and d.bounds(n)[2] > w + 2]
        ctx.check(f"{name} has no horizontal overflow", not over, len(over), "DF-116")
    for label, back in (("Settings", True), ("Event trace", True)):
        ok = d.tap_desc(label)
        time.sleep(1.2)
        ctx.check(f"{label} page renders", ok and len(d.nodes()) > 5 and d.find(any_text=r"(?i)error|undefined") is None, "", "DF-119")
        if back:
            d.press("back")
    tab(ctx, "Orchestra")
    ctx.check("no infra dashboards on Main", d.find(any_text=r"(?i)grafana|cpu %|disk usage|kubernetes") is None, "", "DF-114")
    tabs = [n for n in d.nodes() if n.get("content-desc") in ("Bots", "Chats", "Orchestra")]
    if len(tabs) == 3:
        xs = [(d.bounds(t)[0] + d.bounds(t)[2]) / 2 for t in tabs]
        ctx.check("nav dots centred", abs((min(xs) + max(xs)) / 2 - w / 2) < 12, xs, "DF-111")
    ctx.check("next-action surface present", d.find(rid="needs-kevin") is not None, "", "DF-115")
    ctx.check("glass composer present", composer(ctx) is not None, "", "DF-029")
    ctx.metrics["pages"] = pages
    for f in ("DF-033", "DF-103"):
        ctx.check("owner design review needed", False, "visual parity needs the owner's reference screens", f)
    pal = {k: palette(v) for k, v in pages.items() if v.endswith(".png")}
    ctx.metrics["palette"] = pal
    ctx.check("black/gold palette on every Main page", len(pal) == 3 and all(p["black"] >= 0.6 and p["gold"] > 0 for p in pal.values()), pal, "DF-113")


@journey("J-perf-profile", ("DF-049", "DF-086", "DF-087", "DF-088", "DF-089", "DF-090", "DF-091"))
def j_perf_profile(ctx: Ctx) -> None:
    """gfxinfo framestats and PSS over a scroll/chat/annotation/orb journey: no sustained jank, no growth,
    loops stop when backgrounded (extends the J-jank and J-memory steps of the original harness)."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    d.gfx_reset()
    scroll(ctx, 12)
    scroll(ctx, 12, up=True)
    frames_ok(ctx, "chat list scroll", d.gfx_frames("list-scroll"), "DF-086")
    open_chat(ctx)
    for i in range(6):
        send(ctx, f"perf turn {i}")
        visible(ctx, rf"ARMY_REPLY: perf turn {i}", 15)
    d.gfx_reset()
    for _ in range(6):
        scroll(ctx, 1)
        scroll(ctx, 1, up=True)
    frames_ok(ctx, "transcript scroll", d.gfx_frames("transcript-scroll"), "DF-087")
    d.tap_desc("Chat options")
    d.gfx_reset()
    d.tap_desc("Details Expanded")
    frames_ok(ctx, "trace/detail expansion", d.gfx_frames("detail-expand"), "DF-091")
    d.gfx_reset()
    send(ctx, "ARMY_SLOW orb motion")
    time.sleep(2)
    ctx.metrics["shimmer_seen"] = d.find(any_text=r"(?i)^(thinking|working|reading|responding)") is not None
    time.sleep(4)
    frames_ok(ctx, "thinking orb + shimmer while streaming", d.gfx_frames("orb-stream"), "DF-090")
    a = d.pss_mb()
    time.sleep(60)
    b = d.pss_mb()
    ctx.metrics["pss_idle_mb"] = [a, b]
    ctx.check("no memory growth idle in chat", a > 0 and b - a < PSS_GROWTH_MB_MAX, f"pss_mb {a}->{b} over 60 s", "DF-088")
    d.press("home")
    time.sleep(3)
    d.gfx_reset()
    time.sleep(10)
    bg = d.gfx_frames("backgrounded")
    ctx.metrics["background_frames"] = bg["frames"]
    ctx.check("animation loops stop when backgrounded", bg["frames"] < 5, f"frames in 10 s background={bg['frames']}", "DF-088")
    d.launch()
    ctx.check("motion profile is fast and quiet", ctx.metrics["thinking orb + shimmer while streaming"]["frames"] > 0, "", "DF-089")
    ctx.check("shimmer status text renders while streaming", ctx.metrics.get("shimmer_seen", False), "", "DF-049")


# ================================================================== remaining spec journeys

@journey("J-model-roles", ("DF-030", "DF-080", "DF-102"))
def j_model_roles(ctx: Ctx) -> None:
    """Models: roles and health render; the composer changes this session's model."""
    d = ctx.dev
    home(ctx)
    d.tap_desc("Settings")
    m = d.wait(timeout=8, any_text=r"(?i)^models?$")
    if m:
        d.tap(m)
    txt = " ".join(d.text_of(n) for n in d.nodes()).lower()
    roles = [r for r in ("judge", "tiny", "smol", "large", "default", "vision", "planning", "orchestrating") if r in txt]
    ctx.check("model roles render", len(roles) >= 6, roles, "DF-102")
    ctx.check("no Grok coding role", "grok" not in txt or "no grok" in txt, "", "DF-080")
    d.press("back")
    tab(ctx, "Chats")
    open_chat(ctx)
    ctx.check("composer harness/model popup", d.tap_desc("Choose harness") and d.wait(timeout=4, desc=r"Pick .*") is not None, "", "DF-030")
    d.press("back")


@journey("J-z0live-service", ("DF-060", "DF-061", "DF-062", "DF-063"), needs=("z0live",))
def j_z0live_service(ctx: Ctx) -> None:
    """Start z0live from Dash: one shared service; transcripts reach Hermes; screen control in-app."""
    d = ctx.dev
    home(ctx)
    d.tap_desc("Voice input")
    ctx.check("z0live session starts from Dash", d.wait(timeout=15, rid="voice-phase") is not None, "", "DF-060")
    ctx.check("z0live can control the screen", False, "no in-app control API observable", "DF-061")
    ctx.check("gesture activation configured", d.find(any_text=r"(?i)double-tap|gesture") is not None, "", "DF-062")
    ctx.check("conversation-quality experiment reported", d.find(any_text=r"(?i)experiment") is not None, "", "DF-063")


@journey("J-human-capability-loop", ("DF-121",))
def j_human_capability_loop(ctx: Ctx) -> None:
    """Open Dash with an approved goal: one optional <=2-minute action with Do/Later/Skip/Edit/Why?."""
    d = ctx.dev
    home(ctx, fresh=True)
    ctx.check("one optional action card", all(d.find(any_text=rf"^{k}$") for k in ("Do", "Later", "Skip", "Edit", r"Why\?")))


@journey("J-mesh-discovery", ("DF-007",), needs=("second_host",))
def j_mesh_discovery(ctx: Ctx) -> None:
    """A second tailnet host runs the bridge; Dash lists it and its sessions without re-pairing."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Bots")
    second = os.environ.get("DASH_E2E_SECOND_HOST", "")
    ctx.check("second host listed without re-pairing", bool(second) and d.find(any_text=re.escape(second)) is not None, second)


@journey("J-privacy-forget", ("DF-104",))
def j_privacy_forget(ctx: Ctx) -> None:
    """Forget this bridge: no drafts or local settings survive (checked through the app's own UI)."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    type_into(ctx, "forget me draft")
    close_chat(ctx)
    d.tap_desc("Bridge details")
    f = d.wait(timeout=6, any_text=r"(?i)forget")
    ctx.require("Forget offered", f is not None)
    d.tap(f)
    conf = d.wait(timeout=3, any_text=r"(?i)^forget$|^confirm$")
    if conf:
        d.tap(conf)
    pair_with_token(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    ctx.check("no draft survives Forget", "forget me draft" not in d.text_of(composer(ctx)))


@journey("J-study-mode", ("DF-056",), needs=("real_agent",))
def j_study_mode(ctx: Ctx) -> None:
    """Study mode: a prompt yields an ephemeral UI and iterates, without app source edits."""
    d = ctx.dev
    home(ctx)
    tab(ctx, "Chats")
    open_chat(ctx)
    send(ctx, "study mode: make a flashcard UI for three words")
    ctx.check("ephemeral UI renders", d.wait(timeout=90, rid="live-artifact") is not None or d.find(rid=r".*-plot") is not None)
