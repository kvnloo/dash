"""Device layer for the Dash native journeys: adb, uiautomator2, displays, owner guard, frame stats.

Adapted from the S22 harness (journey.py / probe.py / ink_journey.py / voice_journey.py) and the fleet
owner guard (the private fleet adb wrapper Device.restore_guest). Behaviour kept:
  - the agent phone only (S22+); never the owner's S25;
  - one UI user per device: an exclusive flock on /tmp/<node>-ui.lock for the whole run;
  - the owner-activity guard fails closed (owner_busy / in_call / owner_evidence_unavailable);
  - every agent launch is recorded in /tmp/<node>-agent-opened.json so the ChatGPT queue loop's guard
    can tell an agent-opened foreground from an owner-opened one.
Nothing here holds a secret. The bridge bootstrap token is read from the stack host state dir at pairing time
and is only typed into the device; it is never written to a receipt or a log.
"""
from __future__ import annotations

import contextlib
import fcntl
import json
import os
import re
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

PKG = "app.dash.mobile"
CHATGPT_PKG = "com.openai.chatgpt"
NODE = os.environ.get("DASH_E2E_NODE", "s22")
# Hardware serial of the S22+ agent phone; adb reaches it over the tailnet address below.
HARDWARE_SERIAL = os.environ.get("DASH_E2E_HW_SERIAL", "")
ADB_SERIAL = os.environ.get("S22_SERIAL", "")
FORBIDDEN_MODELS = ("SM-S93",)  # S25 family: the owner's phone, never a journey target
ADB = os.environ.get("ADB", str(Path.home() / "android/sdk/platform-tools/adb"))
STACK_HOST = os.environ.get("DASH_E2E_STACK_HOST", "stack-host")
STACK_IP = os.environ.get("DASH_E2E_STACK_IP", "")
METRO_PORT = int(os.environ.get("DASH_E2E_METRO_PORT", "18520"))
BRIDGE_PORT = int(os.environ.get("DASH_E2E_BRIDGE_PORT", "18530"))
STACK_BASE = os.environ.get("DASH_E2E_BASE", "~/dash-e2e-stack")
OWNER_IDLE_MS = 60_000


class OwnerBusy(Exception):
    """The owner is (or may be) using the phone. The journey is skipped, never failed."""


class EnvironmentUnavailable(Exception):
    """The device stack cannot run this journey here (no device, no virtual display, no stack)."""


# ---------------------------------------------------------------- owner guard (pure, unit-tested)

GUARD_PROBE = ("cat /proc/uptime; cat /proc/sys/kernel/random/boot_id; dumpsys power; "
               "dumpsys activity activities; dumpsys telephony.registry; dumpsys audio")


def owner_guard(facts: str, ledger: dict, display: str) -> str:
    """Return "ok" or the reason the device must not be driven now. Fails closed.

    physical: the same rule as fleet-adb restore_guest. The owner has been idle >= 60 s and the
              foreground app was opened by an agent after the owner's last touch (ledger, same boot).
    virtual:  Dash runs on a secondary display, so the owner's foreground app is left alone; the
              owner must still be idle >= 60 s. A call blocks both modes.
    """
    try:
        lines = facts.splitlines()
        uptime = int(float(lines[0].split()[0]) * 1000)
        boot = lines[1].strip()
    except (IndexError, ValueError):
        return "owner_evidence_unavailable"
    activity = re.search(r"mLastUserActivityTime(?:\(excludingAttention\))?=(\d+)", facts)
    foreground = re.search(r"(?:topResumedActivity=|mResumedActivity:).*?\bu\d+\s+([^/\s]+)/", facts)
    calls = re.findall(r"\bmCallState=(\d+)", facts)
    modes = re.findall(r"\bmMode=(MODE_[A-Z_]+)", facts)
    if not boot or not activity or not calls or not modes or (display == "physical" and not foreground):
        return "owner_evidence_unavailable"
    last = int(activity[1])
    if not 0 <= uptime - last or uptime - last < OWNER_IDLE_MS:
        return "owner_busy"
    if display == "physical":
        opened = ledger.get(foreground[1], {})
        if opened.get("boot_id") != boot or not last <= opened.get("opened_uptime_ms", -1) <= uptime:
            return "owner_busy"
    if any(c != "0" for c in calls) or any(m != "MODE_NORMAL" for m in modes):
        return "in_call"
    return "ok"


def midrun_guard(facts: str, display: str) -> str:
    """Between steps our own injected input moves mLastUserActivityTime, so only hard signals count:
    a call, or (physical) the owner switching the foreground away from Dash."""
    calls = re.findall(r"\bmCallState=(\d+)", facts)
    modes = re.findall(r"\bmMode=(MODE_[A-Z_]+)", facts)
    if any(c != "0" for c in calls) or any(m != "MODE_NORMAL" for m in modes):
        return "in_call"
    if display == "physical":
        fg = re.search(r"(?:topResumedActivity=|mResumedActivity:).*?\bu\d+\s+([^/\s]+)/", facts)
        if fg and fg[1] not in (PKG, "com.android.systemui"):
            return "owner_busy"
    return "ok"


# ---------------------------------------------------------------- frame stats (pure, unit-tested)

def parse_framestats(text: str) -> list[float]:
    """Frame durations (ms) from `dumpsys gfxinfo <pkg> framestats`; non-zero Flags rows are skipped."""
    out: list[float] = []
    header: list[str] | None = None
    for line in text.splitlines():
        line = line.strip().rstrip(",")
        if line.startswith("Flags,"):
            header = line.split(",")
            continue
        if header is None or not line or not line[0].isdigit():
            if line.startswith("---PROFILEDATA---") and header is not None:
                header = None if out else header
            continue
        cells = line.split(",")
        if len(cells) < len(header):
            continue
        row = dict(zip(header, cells))
        try:
            if int(row["Flags"]) != 0:
                continue
            start, done = int(row["IntendedVsync"]), int(row["FrameCompleted"])
        except (KeyError, ValueError):
            continue
        if done > start > 0:
            out.append((done - start) / 1e6)
    return out


def frame_summary(durations: list[float], refresh_hz: float) -> dict:
    if not durations:
        return {"frames": 0, "jank_pct": None, "p50_ms": None, "p95_ms": None, "max_ms": None}
    s = sorted(durations)
    budget = 1000.0 / refresh_hz
    pick = lambda q: round(s[min(len(s) - 1, int(q * len(s)))], 2)  # noqa: E731
    return {"frames": len(s), "frame_budget_ms": round(budget, 2),
            "jank_pct": round(100.0 * sum(d > budget for d in s) / len(s), 1),
            "p50_ms": pick(0.5), "p95_ms": pick(0.95), "max_ms": round(s[-1], 2)}


# ---------------------------------------------------------------- device session

def adb(*args: str, serial: str = ADB_SERIAL, timeout: float = 60) -> str:
    return subprocess.run([ADB, "-s", serial, *args], capture_output=True, text=True, timeout=timeout).stdout


def stack_run(cmd: str, timeout: float = 120) -> str:
    return subprocess.run(["ssh", STACK_HOST, cmd], capture_output=True, text=True, timeout=timeout).stdout


@contextlib.contextmanager
def ui_lock(node: str = NODE, wait_s: float = 900):
    """One UI user per device (the ChatGPT driver's rule): exclusive flock on /tmp/<node>-ui.lock."""
    with open(f"/tmp/{node}-ui.lock", "a") as lock:
        end = time.time() + wait_s
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.time() > end:
                    raise EnvironmentUnavailable(f"/tmp/{node}-ui.lock held by another UI user for {wait_s:.0f} s")
                time.sleep(2)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def record_agent_open(package: str, serial: str = ADB_SERIAL, node: str = NODE) -> None:
    """Same ledger the fleet guard reads: {pkg: {boot_id, opened_uptime_ms, opened_at}}."""
    raw = adb("shell", "cat /proc/uptime; cat /proc/sys/kernel/random/boot_id", serial=serial).splitlines()
    try:
        uptime, boot = int(float(raw[0].split()[0]) * 1000), raw[1].strip()
    except (IndexError, ValueError):
        return
    path = Path(f"/tmp/{node}-agent-opened.json")
    try:
        ledger = json.loads(path.read_text()) if path.exists() else {}
    except ValueError:
        ledger = {}
    ledger[package] = {"boot_id": boot, "opened_uptime_ms": uptime,
                       "opened_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    path.write_text(json.dumps(ledger) + "\n")


def read_ledger(node: str = NODE) -> dict:
    try:
        return json.loads(Path(f"/tmp/{node}-agent-opened.json").read_text())
    except (OSError, ValueError):
        return {}


@dataclass
class Device:
    """One Dash app instance on one display of the agent phone."""
    display: str  # "physical" | "virtual"
    out: Path
    serial: str = ADB_SERIAL
    display_id: int = 0
    _u2: object = None
    _scrcpy: subprocess.Popen | None = None
    refresh_hz: float = 60.0
    shots: list[str] = field(default_factory=list)

    # -- lifecycle
    def connect(self) -> "Device":
        model = adb("shell", "getprop", "ro.product.model", serial=self.serial).strip()
        hw = adb("shell", "getprop", "ro.serialno", serial=self.serial).strip()
        if not model:
            raise EnvironmentUnavailable(f"adb cannot reach {self.serial}")
        if model.startswith(FORBIDDEN_MODELS):
            raise EnvironmentUnavailable(f"{model} is the owner's phone; journeys never drive it")
        self.hardware_serial = hw or HARDWARE_SERIAL
        self.emulator = adb("shell", "getprop", "ro.kernel.qemu", serial=self.serial).strip() == "1"
        import uiautomator2 as u2  # imported late: dry runs need no device library
        self._u2 = u2.connect(self.serial)
        if self.display == "virtual":
            self._open_virtual_display()
        m = re.search(r"refreshRate=([\d.]+)", adb("shell", "dumpsys display | grep -m1 refreshRate", serial=self.serial))
        self.refresh_hz = float(m[1]) if m else 60.0
        return self

    def _open_virtual_display(self) -> None:
        """A headless scrcpy (>= 3.0) virtual display; Dash is started on it with `am start --display`."""
        scrcpy = shutil.which("scrcpy")
        if not scrcpy:
            raise EnvironmentUnavailable("--display virtual needs scrcpy >= 3.0 on this host (--new-display)")
        before = set(re.findall(r"mDisplayId=(\d+)", adb("shell", "dumpsys display", serial=self.serial)))
        self._scrcpy = subprocess.Popen(
            [scrcpy, "-s", self.serial, "--new-display=1080x2340/420", "--no-window", "--no-audio",
             "--no-playback", "--no-vd-system-decorations"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            now = set(re.findall(r"mDisplayId=(\d+)", adb("shell", "dumpsys display", serial=self.serial)))
            new = sorted(int(x) for x in now - before)
            if new:
                self.display_id = new[0]
                return
            time.sleep(0.5)
        self.close()
        raise EnvironmentUnavailable("scrcpy did not create a virtual display")

    def close(self) -> None:
        if self._scrcpy and self._scrcpy.poll() is None:
            self._scrcpy.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                self._scrcpy.wait(5)

    @property
    def real_device(self) -> bool:
        return not getattr(self, "emulator", True)

    # -- guard
    def guard(self, midrun: bool = False) -> None:
        facts = adb("shell", GUARD_PROBE, serial=self.serial, timeout=30)
        verdict = midrun_guard(facts, self.display) if midrun else owner_guard(facts, read_ledger(), self.display)
        if verdict != "ok":
            raise OwnerBusy(verdict)

    # -- shell
    def sh(self, *args: str, timeout: float = 60) -> str:
        return adb("shell", *args, serial=self.serial, timeout=timeout)

    # -- app
    def launch(self, metro: str = f"http://{STACK_IP}:{METRO_PORT}") -> None:
        url = "exp+dash://expo-development-client/?url=" + metro.replace(":", "%3A").replace("/", "%2F")
        extra = ["--display", str(self.display_id)] if self.display == "virtual" else []
        self.sh("am", "start", *extra, "-a", "android.intent.action.VIEW", "-d", url, PKG)
        record_agent_open(PKG, self.serial)

    def force_stop(self) -> None:
        self.sh("am", "force-stop", PKG)

    def hand_back(self) -> None:
        """Physical runs give the S22 back to the ChatGPT lane, as the original harness did."""
        if self.display == "physical":
            self.sh("monkey", "-p", CHATGPT_PKG, "-c", "android.intent.category.LAUNCHER", "1")
            record_agent_open(CHATGPT_PKG, self.serial)

    # -- tree
    def nodes(self) -> list[dict]:
        root = ET.fromstring(self._u2.dump_hierarchy())
        want = str(self.display_id)
        return [n.attrib for n in root.iter("node") if n.get("package") == PKG
                and n.get("display-id", want if self.display == "virtual" else "0") in (want, None)]

    def find(self, desc: str | None = None, text: str | None = None, rid: str | None = None,
             any_text: str | None = None) -> dict | None:
        """Regex full-match on content-desc / text / resource-id; any_text is a regex search on either."""
        rx = re.compile(any_text) if any_text else None
        for n in self.nodes():
            if rx and (rx.search(n.get("text") or "") or rx.search(n.get("content-desc") or "")):
                return n
            for key, want in (("content-desc", desc), ("text", text), ("resource-id", rid)):
                if want is not None and re.fullmatch(want, n.get(key) or "") is not None:
                    return n
        return None

    def find_all(self, rid: str | None = None, any_text: str | None = None) -> list[dict]:
        rx = re.compile(any_text) if any_text else None
        out = []
        for n in self.nodes():
            if rid and re.fullmatch(rid, n.get("resource-id") or ""):
                out.append(n)
            elif rx and (rx.search(n.get("text") or "") or rx.search(n.get("content-desc") or "")):
                out.append(n)
        return out

    def wait(self, timeout: float = 10, **kw) -> dict | None:
        end = time.time() + timeout
        while True:
            n = self.find(**kw)
            if n or time.time() > end:
                return n
            time.sleep(0.3)

    def gone(self, timeout: float = 10, **kw) -> bool:
        end = time.time() + timeout
        while time.time() < end:
            if not self.find(**kw):
                return True
            time.sleep(0.3)
        return False

    @staticmethod
    def bounds(n: dict) -> tuple[int, int, int, int]:
        x1, y1, x2, y2 = map(int, re.findall(r"\d+", n["bounds"]))
        return x1, y1, x2, y2

    def tap(self, n: dict) -> None:
        x1, y1, x2, y2 = self.bounds(n)
        self.tap_xy((x1 + x2) // 2, (y1 + y2) // 2)

    def tap_xy(self, x: int, y: int) -> None:
        if self.display == "virtual":
            self.sh("input", "-d", str(self.display_id), "tap", str(x), str(y))
        else:
            self._u2.click(x, y)

    def long_press(self, n: dict, secs: float = 0.8) -> None:
        x1, y1, x2, y2 = self.bounds(n)
        x, y = (x1 + x2) // 2, (y1 + y2) // 2
        self.swipe(x, y, x, y, secs)

    def swipe(self, x1: int, y1: int, x2: int, y2: int, secs: float = 0.15) -> None:
        if self.display == "virtual":
            self.sh("input", "-d", str(self.display_id), "swipe", *map(str, (x1, y1, x2, y2)), str(int(secs * 1000)))
        else:
            self._u2.swipe(x1, y1, x2, y2, secs)

    def tap_desc(self, desc: str, timeout: float = 6) -> bool:
        n = self.wait(timeout=timeout, desc=desc)
        if n:
            self.tap(n)
        return bool(n)

    def type_text(self, text: str, clear: bool = True) -> None:
        """Type into the focused field like a user (IME), not by setting the node value."""
        if self.display == "virtual":
            if clear:
                self.sh("input", "-d", str(self.display_id), "keycombination", "113", "29")  # ctrl+a
                self.sh("input", "-d", str(self.display_id), "keyevent", "67")
            esc = re.sub(r"([\\\"'`$&|;<>()*?! ])", lambda m: "%s" if m[1] == " " else "\\" + m[1], text)
            self.sh("input", "-d", str(self.display_id), "text", esc)
        else:
            self._u2.send_keys(text, clear=clear)

    def press(self, key: str) -> None:
        codes = {"back": "4", "home": "3", "enter": "66"}
        if self.display == "virtual":
            self.sh("input", "-d", str(self.display_id), "keyevent", codes[key])
        else:
            self._u2.press(key)

    def window_size(self) -> tuple[int, int]:
        if self.display == "virtual":
            return 1080, 2340
        return self._u2.window_size()

    def text_of(self, n: dict | None) -> str:
        return "" if not n else (n.get("text") or n.get("content-desc") or "")

    def shot(self, name: str) -> str:
        p = self.out / f"{len(self.shots):02d}-{re.sub(r'[^A-Za-z0-9_.-]+', '-', name)[:48]}.png"
        try:
            if self.display == "virtual":
                data = subprocess.run([ADB, "-s", self.serial, "exec-out", "screencap", "-p", "-d", str(self.display_id)],
                                      capture_output=True, timeout=30).stdout
                p.write_bytes(data)
            else:
                self._u2.screenshot(str(p))
        except Exception as e:  # noqa: BLE001 - a missing screenshot is recorded, not fatal
            p = p.with_suffix(".txt")
            p.write_text(f"screenshot failed: {type(e).__name__}: {e}\n")
        self.shots.append(str(p))
        return str(p)

    def dump(self, name: str) -> str:
        p = self.out / f"{len(self.shots):02d}-{name}.xml"
        p.write_text(self._u2.dump_hierarchy())
        self.shots.append(str(p))
        return str(p)

    # -- measurements
    def gfx_reset(self) -> None:
        self.sh("dumpsys", "gfxinfo", PKG, "reset")

    def gfx_frames(self, name: str) -> dict:
        raw = self.sh("dumpsys", "gfxinfo", PKG, "framestats", timeout=60)
        p = self.out / f"{name}-framestats.txt"
        p.write_text(raw)
        self.shots.append(str(p))
        summary = frame_summary(parse_framestats(raw), self.refresh_hz)
        jk = re.search(r"Janky frames: (\d+) \(([\d.]+)%\)", raw)
        summary["android_janky_pct"] = float(jk[2]) if jk else None
        return summary

    def pss_mb(self) -> int:
        m = re.search(r"TOTAL PSS:\s+(\d+)", self.sh("dumpsys", "meminfo", PKG))
        return int(m[1]) // 1024 if m else -1

    def resumed_package(self) -> str | None:
        m = re.search(r"(?:mResumedActivity|topResumedActivity).*? ([\w.]+)/", self.sh("dumpsys", "activity", "activities"))
        return m[1] if m else None

    def logcat_clear(self) -> None:
        adb("logcat", "-c", serial=self.serial)

    def logcat(self, name: str) -> str:
        raw = adb("logcat", "-d", serial=self.serial, timeout=60)
        p = self.out / f"{name}-logcat.txt"
        # Keep only Dash/React Native lines; the full device log is the owner's data.
        keep = [line for line in raw.splitlines() if re.search(r"ReactNative|ReactNativeJS|dash|Expo|AndroidRuntime", line)]
        p.write_text("\n".join(keep[-2000:]) + "\n")
        self.shots.append(str(p))
        return "\n".join(keep)
