#!/usr/bin/env bash
# Launch, check, drive and tear down one tester-army stack for the commit checked out here.
#
#   army-stack.sh sway-up                 start the private headless Sway if it is not running
#   army-stack.sh up       <run>          web-export HEAD of this checkout, serve it on a free loopback port
#   army-stack.sh doctor   <run>          read-only: is this stack worth driving?
#   army-stack.sh drive    <run> <workers> [playwright args...]   run the army (run.py) against the stack
#   army-stack.sh evidence <run>          list the proof files and the receipt for <run>
#   army-stack.sh down     <run>          stop only what `up` started; evidence stays
#
# <run> names one stack and one army result. Use <branch-slug>-<sha7>-<what>; never reuse one.
# Scratch and evidence live under $ARMY_BASE (default ~/dash-e2e-army-20261025; the Playwright
# config refuses any other private runtime). Never touches the physical display or a phone.
set -euo pipefail

ARMY_BASE=${ARMY_BASE:-$HOME/dash-e2e-army-20261025}
RUNTIME=$ARMY_BASE/virtual-runtime
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
export PATH="$HOME/.bun/bin:$PATH"

die() { echo "army-stack: $*" >&2; exit 1; }
need_run() { [ -n "${1:-}" ] || die "missing <run> name"; [[ $1 =~ ^[A-Za-z0-9._-]+$ ]] || die "bad <run> name: $1"; }
state_file() { echo "$ARMY_BASE/stack-$1/state.env"; }
load() { local f; f=$(state_file "$1"); [ -f "$f" ] || die "no stack '$1' (run: up $1)"; # shellcheck disable=SC1090
  . "$f"; }
sway_alive() { [ -S "$RUNTIME/wayland-1" ] && pgrep -u "$(id -u)" -f "sway -c $ARMY_BASE/sway.conf" >/dev/null; }
pid_is() { # pid, required substring of its command line
  [ -n "$1" ] && [ -r "/proc/$1/cmdline" ] && tr '\0' ' ' <"/proc/$1/cmdline" | grep -qF -- "$2"; }

cmd=${1:-}; shift || true
case "$cmd" in
sway-up)
  mkdir -p "$ARMY_BASE"
  if sway_alive; then echo "sway: already running on $RUNTIME/wayland-1 (not ours; never stop it)"; exit 0; fi
  [ -f "$ARMY_BASE/sway.conf" ] || printf 'output * mode 3840x2160\nseat seat0 fallback true\ndefault_border pixel 1\nfocus_follows_mouse no\n' >"$ARMY_BASE/sway.conf"
  mkdir -p "$RUNTIME"; chmod 700 "$RUNTIME"
  env -u WAYLAND_DISPLAY -u DISPLAY -u SWAYSOCK XDG_RUNTIME_DIR="$RUNTIME" WLR_BACKENDS=headless \
    WLR_HEADLESS_OUTPUTS=1 WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman \
    setsid sway -c "$ARMY_BASE/sway.conf" >"$ARMY_BASE/sway.log" 2>&1 </dev/null &
  echo $! >"$ARMY_BASE/sway.pid"
  for _ in $(seq 1 40); do [ -S "$RUNTIME/wayland-1" ] && break; sleep 0.25; done
  sway_alive || die "headless Sway did not come up; see $ARMY_BASE/sway.log"
  echo "sway: started pid $(cat "$ARMY_BASE/sway.pid") on $RUNTIME/wayland-1 (stop it with: kill \$(cat $ARMY_BASE/sway.pid))"
  ;;
up)
  run=${1:-}; need_run "$run"
  dir=$ARMY_BASE/stack-$run
  [ -e "$dir" ] && die "stack '$run' exists; pick a new name or run: down $run"
  mkdir -p "$dir"
  sha=$(git -C "$repo" rev-parse HEAD)
  dirty=$([ -n "$(git -C "$repo" status --porcelain --untracked-files=no)" ] && echo 1 || echo 0)
  [ -d "$repo/node_modules/playwright" ] && [ -d "$repo/app/node_modules/expo" ] && [ -d "$repo/bridge/node_modules" ] \
    || die "deps missing: bun install --frozen-lockfile in $repo, $repo/app and $repo/bridge"
  echo "up: exporting web build of $sha (dirty=$dirty) -> $dir/web-export"
  (cd "$repo/app" && CI=1 EXPO_PUBLIC_DEBUG=0 EXPO_PUBLIC_DEBUG_AUTONAV=0 \
    bun node_modules/expo/bin/cli export --platform web --output-dir "$dir/web-export") >"$dir/web-export.log" 2>&1 \
    || { tail -30 "$dir/web-export.log"; die "web export failed; log: $dir/web-export.log"; }
  port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  setsid python3 "$repo/e2e/mbp-army/serve.py" "$dir/web-export" "$port" >"$dir/serve.log" 2>&1 </dev/null &
  pid=$!
  printf 'RUN=%q\nREPO=%q\nSHA=%q\nDIRTY=%q\nPORT=%q\nSERVE_PID=%q\nWEB=%q\n' \
    "$run" "$repo" "$sha" "$dirty" "$port" "$pid" "http://127.0.0.1:$port" >"$dir/state.env"
  for _ in $(seq 1 60); do curl -fs "http://127.0.0.1:$port/" >/dev/null && break; sleep 0.5; done
  curl -fs "http://127.0.0.1:$port/" | grep -q '<div id="root"' || die "server did not serve the Dash index; log: $dir/serve.log"
  echo "up: serving $sha at http://127.0.0.1:$port (pid $pid); state: $dir/state.env"
  ;;
doctor)
  run=${1:-}; need_run "$run"; load "$run"; ok=1
  chk() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; ok=0; fi; }
  chk "private headless Sway at $RUNTIME/wayland-1" sway_alive
  chk "XDG_RUNTIME_DIR for the run is private (never /run/user)" '[[ $RUNTIME != /run/user/* ]]'
  chk "web server pid $SERVE_PID is our serve.py" 'pid_is "$SERVE_PID" "serve.py $ARMY_BASE/stack-$run/web-export $PORT"'
  chk "$WEB serves the Dash web export" 'curl -fs "$WEB/" | grep -q "<div id=\"root\""'
  chk "export is from HEAD ($SHA) of $REPO" '[ "$(git -C "$REPO" rev-parse HEAD)" = "$SHA" ]'
  chk "checkout has no tracked edits since the export" '[ -z "$(git -C "$REPO" status --porcelain --untracked-files=no)" ] || [ "$DIRTY" = 1 ]'
  chk "bun, node, bwrap and Playwright Chromium present" 'command -v bun >/dev/null && command -v node >/dev/null && command -v bwrap >/dev/null && ls "$HOME"/.cache/ms-playwright 2>/dev/null | grep -q chromium'
  chk "run name '$run' has no earlier result (run.py overwrites)" '[ ! -e "$ARMY_BASE/$run.json" ]'
  [ "$ok" = 1 ] && echo "doctor: stack '$run' is worth driving" || { echo "doctor: do not drive '$run'"; exit 1; }
  ;;
drive)
  run=${1:-}; need_run "$run"; workers=${2:-}; [ -n "$workers" ] || die "missing <workers>"; shift 2; load "$run"
  [ ! -e "$ARMY_BASE/$run.json" ] || die "result '$run' already exists; never overwrite a run"
  sway_alive || die "virtual display missing; run: sway-up (never fall back to the physical display)"
  cd "$REPO"
  set +e
  ARMY_BASE=$ARMY_BASE ARMY_WEB=$WEB ARMY_BRIDGE_ROOT=$REPO python3 e2e/mbp-army/run.py "$run" "$workers" "$@"
  rc=$?
  set -e
  python3 - "$ARMY_BASE" "$run" "$SHA" "$DIRTY" "$rc" "$@" <<'PY'
import json, sys, subprocess
from pathlib import Path
base, run, sha, dirty, rc, *args = sys.argv[1:]
base = Path(base)
def walk(s):
    for spec in s.get('specs', []):
        for t in spec.get('tests', []):
            r = t.get('results') or [{}]
            yield {'file': spec.get('file'), 'title': spec.get('title'), 'status': r[-1].get('status', 'not-started')}
    for c in s.get('suites', []): yield from walk(c)
report = base / f'{run}.json'
tests = [t for s in json.loads(report.read_text()).get('suites', []) for t in walk(s)] if report.exists() else []
receipt = {'run': run, 'sha': sha, 'dirty': dirty == '1', 'exit_code': int(rc), 'playwright_args': args,
           'passed': sum(t['status'] == 'passed' for t in tests), 'failed': sum(t['status'] not in ('passed', 'skipped') for t in tests),
           'skipped': sum(t['status'] == 'skipped' for t in tests), 'tests': tests,
           'evidence': {k: str(base / v) for k, v in {'per_test': run, 'html': f'{run}-html', 'report': f'{run}.json', 'log': f'{run}.log', 'wall': f'{run}-wall.json'}.items()}}
(base / f'{run}-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(f"receipt: {base / (run + '-receipt.json')}  passed={receipt['passed']} failed={receipt['failed']} skipped={receipt['skipped']} exit={rc}")
PY
  exit "$rc"
  ;;
evidence)
  run=${1:-}; need_run "$run"
  for p in "$run-receipt.json" "$run-wall.json" "$run.json" "$run.log" "$run-html" "$run"; do
    [ -e "$ARMY_BASE/$p" ] && echo "$ARMY_BASE/$p" || echo "missing: $ARMY_BASE/$p"
  done
  [ -d "$ARMY_BASE/$run" ] && find "$ARMY_BASE/$run" -name final.png -o -name 'test-failed-*.png' -o -name error-context.md | sort
  ;;
down)
  run=${1:-}; need_run "$run"; load "$run"
  if pid_is "$SERVE_PID" "serve.py $ARMY_BASE/stack-$run/web-export"; then kill "$SERVE_PID"; echo "down: stopped serve.py pid $SERVE_PID"
  else echo "down: serve.py pid $SERVE_PID is not running (or is not ours); nothing killed"; fi
  rm -rf "$ARMY_BASE/stack-$run/web-export"
  echo "down: removed the web export; kept $ARMY_BASE/stack-$run/{state.env,serve.log,web-export.log} and every $ARMY_BASE/$run* evidence file"
  ;;
*) sed -n '2,13p' "$0"; exit 2 ;;
esac
