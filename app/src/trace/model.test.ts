import { describe, expect, test } from "bun:test";
import snapshot from "./snapshot.json";
import {
  ZOOM_MAX, ZOOM_MIN, activeAt, clock, hourStep, initialZoom, packLanes, panBounds, parseTraceSnapshot,
  rubberband, rowMeta, scrubTick, softClamp, softZoom, summarizeRow, swipeDecision, timeAtX, txForTime, zoomAround,
  type TraceWorker,
} from "./model";
import { createAppRouteRouter, parseAppRouteLink } from "../lib/app-route-link";

const snap = parseTraceSnapshot(snapshot);

describe("trace snapshot", () => {
  test("bundled snapshot parses and matches the round-3 READ numbers", () => {
    expect(snap.stats.live).toBe(4);
    expect(snap.stats.cut).toBe(18);
    expect(snap.stats.resumed).toBe(2);
    expect(snap.read).toContain("18 workers were cut");
    expect(snap.actions.map((a) => a.id)).toEqual(["a-resume", "a-triage", "a-ring"]);
  });

  test("rows are ordered live, then last 3 hours, then earlier", () => {
    const rank = { live: 0, recent: 1, earlier: 2 } as const;
    const ranks = snap.rows.map((r) => rank[r.group]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(snap.rows.filter((r) => r.group === "live").length).toBe(4);
  });

  test("rejects a wrong schema and a bad field", () => {
    expect(() => parseTraceSnapshot({ ...snapshot, schema: "x" })).toThrow("unknown schema");
    expect(() => parseTraceSnapshot({ ...snapshot, now: "soon" })).toThrow("now is not a number");
  });

  test("snapshot carries no raw goals or paths", () => {
    const text = JSON.stringify(snapshot);
    expect(/\/home\/|\/mnt\/|short_goal|prompt"|args"/.test(text)).toBe(false);
  });

  test("row summary and meta", () => {
    const video = snap.rows.find((r) => r.key === "Video · fframestudio");
    expect(video).toBeDefined();
    if (!video) return;
    const s = summarizeRow(video);
    expect(s.workers).toBe(6);
    expect(s.cut).toBe(2);
    expect(rowMeta(s)).toMatch(/^6 workers · 2 cut/);
  });

  test("activeAt at now equals live workers", () => {
    expect(activeAt(snap.rows, snap.now - 1)).toBe(4);
  });

  test("clock reads t0-relative wall time", () => {
    expect(clock(snap.t0, snap.now)).toBe("00:53");
  });
});

describe("lanes", () => {
  const w = (s: number, e: number): TraceWorker => ({ id: `${s}`, model: "m", status: "completed", s, e, calls: 0, errors: 0, asks: [], resumed: false, isResume: false, density: [], fails: [], stalls: [] });
  test("overlapping workers get separate lanes; a later one reuses a free lane", () => {
    expect(packLanes([w(0, 10), w(5, 20), w(12, 30)])).toEqual([0, 1, 0]);
  });
});

describe("gesture math", () => {
  test("rubber band resists and is bounded", () => {
    expect(rubberband(0, 300)).toBe(0);
    expect(rubberband(100, 300)).toBeLessThan(100);
    expect(rubberband(1e6, 300)).toBeLessThan(300);
    expect(rubberband(-100, 300)).toBe(-rubberband(100, 300));
  });

  test("soft clamp passes inside values and pulls outside ones back", () => {
    expect(softClamp(-50, -100, 0, 300)).toBe(-50);
    expect(softClamp(40, -100, 0, 300)).toBeGreaterThan(0);
    expect(softClamp(40, -100, 0, 300)).toBeLessThan(40);
  });

  test("pan bounds keep content covering the viewport", () => {
    expect(panBounds(1000, 300)).toEqual([-700, 0]);
    expect(panBounds(200, 300)).toEqual([0, 0]);
  });

  test("zoom limits rubber band past 1x and 24x", () => {
    expect(softZoom(2)).toBe(2);
    expect(softZoom(0.5)).toBeGreaterThan(0.5);
    expect(softZoom(0.5)).toBeLessThan(ZOOM_MIN);
    expect(softZoom(48)).toBeLessThan(48);
    expect(softZoom(48)).toBeGreaterThan(ZOOM_MAX);
  });

  test("zooming keeps the time under the focal point fixed", () => {
    const viewW = 280, span = 60000, focal = 120, z0 = 2, tx0 = -150;
    const before = timeAtX(focal, tx0, viewW, z0, span);
    const tx1 = zoomAround(focal, tx0, z0, 5);
    expect(timeAtX(focal, tx1, viewW, 5, span)).toBeCloseTo(before, 6);
  });

  test("opens at ~3 h ending near now", () => {
    const span = snap.now + 1200, viewW = 280;
    const z = initialZoom(span);
    const tx = txForTime(snap.now, span, viewW, z, 0.84);
    const left = timeAtX(0, tx, viewW, z, span), right = timeAtX(viewW, tx, viewW, z, span);
    expect((right - left) / 3600).toBeCloseTo(3, 1);
    expect(right).toBeGreaterThan(snap.now);
  });

  test("hour labels thin out when zoomed out", () => {
    expect(hourStep(280, 1, 60000)).toBeGreaterThan(1);
    expect(hourStep(280, 12, 60000)).toBe(1);
  });

  test("scrub ticks every 15 min", () => {
    expect(scrubTick(899, 900)).toBe(0);
    expect(scrubTick(900, 900)).toBe(1);
  });

  test("swipe: right = Do, left = Not now, short drags snap back, flings commit", () => {
    expect(swipeDecision(130, 0, 340)).toBe("do");
    expect(swipeDecision(-130, 0, 340)).toBe("not_now");
    expect(swipeDecision(60, 0, 340)).toBeNull();
    expect(swipeDecision(40, 1200, 340)).toBe("do");
    expect(swipeDecision(-40, -1200, 340)).toBe("not_now");
    expect(swipeDecision(10, 1200, 340)).toBeNull();
  });
});

describe("deep links", () => {
  test("Expo Go and dev-build routes", () => {
    expect(parseAppRouteLink("exp://100.113.138.100:8097/--/lab")).toBe("Lab");
    expect(parseAppRouteLink("exp://100.113.138.100:8097/--/trace")).toBe("Trace");
    expect(parseAppRouteLink("dash://trace")).toBe("Trace");
    expect(parseAppRouteLink("exp://100.113.138.100:8097/--/orchestra")).toBe("Orchestra");
    expect(parseAppRouteLink("dash://orchestra")).toBe("Orchestra");
    for (const [path, route] of [["settings", "Settings"], ["bots", "Bots"]] as const) {
      expect(parseAppRouteLink(`exp://100.113.138.100:8097/--/${path}`)).toBe(route);
      expect(parseAppRouteLink(`dash://${path}`)).toBe(route);
    }
    expect(parseAppRouteLink("dash://lab/?x=1")).toBe("Lab");
  });
  test("other links are not routes", () => {
    expect(parseAppRouteLink("dash://connect?address=a&code=b")).toBeNull();
    expect(parseAppRouteLink("exp://100.113.138.100:8097/--/stage?url=x")).toBeNull();
    expect(parseAppRouteLink("exp://100.113.138.100:8097")).toBeNull();
    expect(parseAppRouteLink(null)).toBeNull();
  });
  test("a cold-start link is held until navigation is ready, then opened once", () => {
    let ready = false;
    const opened: string[] = [];
    const r = createAppRouteRouter({ isReady: () => ready, open: (x) => opened.push(x) });
    expect(r.handle("exp://h:8097/--/lab")).toBe(true);
    expect(opened).toEqual([]);
    ready = true;
    r.flush();
    r.flush();
    expect(opened).toEqual(["Lab"]);
    expect(r.handle("exp://h:8097/--/orchestra")).toBe(true);
    expect(opened).toEqual(["Lab", "Orchestra"]);
    expect(r.handle("exp://h:8097/--/connect?code=x")).toBe(false);
  });
});
