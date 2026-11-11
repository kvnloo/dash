#!/usr/bin/env python3
"""Compare retained browser artifacts, not host writes. Run through fleet-build."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

repo = Path(__file__).resolve().parents[2]
proof = Path(tempfile.mkdtemp(prefix="retention-proof-", dir=repo / "e2e"))
print(f"Evidence: {proof}", flush=True)
source = repo / "e2e/mbp-army/playwright.config.ts"
fixed = source.read_text()
policy = "trace: 'retain-on-failure', video: 'retain-on-failure'"
assert fixed.count(policy) == 1
baseline = fixed.replace(policy, "trace: 'on', video: 'on'")
(proof / "baseline.ts").write_text(baseline)
runtime = proof / "dash-e2e-army-20261025/virtual-runtime"
runtime.mkdir(parents=True, mode=0o700)
env = {k: v for k, v in os.environ.items() if k not in {
    "DISPLAY", "WAYLAND_DISPLAY", "SWAYSOCK", "ARMY_OUTPUT", "ARMY_HTML", "ARMY_JSON",
}}
env.update(XDG_RUNTIME_DIR=str(runtime), CI="1")

red = proof / "red"
red.mkdir()
shutil.copyfile(repo / "e2e/mbp-army/retention.test.ts", red / "retention.test.ts")
(red / "playwright.config.ts").write_text(baseline)
with (proof / "red.log").open("w") as log:
    result = subprocess.run(["bun", "test", str(red / "retention.test.ts")],
                            cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
assert result.returncode == 1, "Original policy must fail the retention regression"
red_output = (proof / "red.log").read_text()
assert 'Expected: "retain-on-failure"' in red_output and 'Received: "on"' in red_output
with (proof / "green.log").open("w") as log:
    result = subprocess.run(["bun", "test", "e2e/mbp-army/retention.test.ts"],
                            cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
assert result.returncode == 0, "Fixed policy must pass the retention regression"

cases = proof / "cases"
cases.mkdir()
(cases / "retention.spec.ts").write_text('''import { test, expect } from 'playwright/test';
for (const name of ['pass-one', 'pass-two', 'fail-one']) {
  test(name, async ({ page }, info) => {
    await page.setContent('<h1>Retention probe</h1><input aria-label="Message"/>');
    await page.getByLabel('Message').fill('Synthetic recording, no app or credentials');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: info.outputPath('final.png') });
    await expect(page.locator('h1')).toHaveText(
      name === 'fail-one' ? 'Deliberate failure' : 'Retention probe', { timeout: 100 });
  });
}
''')
rows = []
for repeat in range(2):
    for label, config_source in [("before", proof / "baseline.ts"), ("after", source)]:
        run = proof / f"{label}-{repeat}"
        run.mkdir()
        config = run / "config.ts"
        config.write_text(f'''import base from {json.dumps(str(config_source))};
export default {{ ...base,
  testDir: {json.dumps(str(cases))}, workers: 1, retries: 0,
  outputDir: {json.dumps(str(run / 'results'))},
  reporter: [['json', {{ outputFile: {json.dumps(str(run / 'results.json'))} }}],
    ['html', {{ outputFolder: {json.dumps(str(run / 'html'))}, open: 'never' }}]],
  use: {{ ...base.use, headless: true,
    launchOptions: {{ args: ['--disable-dev-shm-usage'] }} }}
}};
''')
        started = time.monotonic()
        with (run / "runner.log").open("w") as log:
            result = subprocess.run(["bun", "node_modules/playwright/cli.js", "test",
                                     "--config", str(config)], cwd=repo, env=env,
                                    stdout=log, stderr=subprocess.STDOUT)
        elapsed = time.monotonic() - started
        report = json.loads((run / "results.json").read_text())
        stats = report["stats"]
        assert result.returncode == 1, "Exactly one deliberate test must fail"
        assert stats["expected"] == 2 and stats["unexpected"] == 1, stats
        assert stats["skipped"] == 0 and stats["flaky"] == 0, stats
        test_rows = [test for suite in report["suites"] for spec in suite["specs"]
                     for test in spec["tests"]]
        assert len(test_rows) == 3
        for test in test_rows:
            attachments = test["results"][0]["attachments"]
            names = {a["name"] for a in attachments}
            failing = test["results"][0]["status"] == "failed"
            for name in ["trace", "video"]:
                assert (name in names) == (label == "before" or failing), (label, names)
        files = [{"path": str(p.relative_to(proof)), "bytes": p.stat().st_size}
                 for folder in [run / "results", run / "html"]
                 for p in sorted(folder.rglob("*")) if p.is_file()]
        total = sum(p["bytes"] for p in files)
        recording_bytes = sum(p["bytes"] for p in files
                              if p["path"].endswith((".zip", ".webm")))
        row = dict(policy=label, repeat=repeat, elapsed_seconds=elapsed,
                   retained_bytes=total, recording_bytes=recording_bytes,
                   retained_bytes_per_second=total / elapsed, stats=stats, files=files)
        rows.append(row)
        print(json.dumps({k: v for k, v in row.items() if k != "files"}), flush=True)

summary = {"metric": "Synthetic retained artifact growth, including HTML copies; not host I/O",
           "source_config": str(source), "workload": "2 passing + 1 failing case, twice per policy",
           "headless": True, "rows": rows}
(proof / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
for repeat in range(2):
    before, after = rows[repeat * 2:repeat * 2 + 2]
    assert after["recording_bytes"] < before["recording_bytes"], (before, after)
print("PASS: red/green regression; passing recordings discarded; failing recordings preserved", flush=True)
print("No live rollout, host-write measurement, or failed-run budget was tested.", flush=True)
