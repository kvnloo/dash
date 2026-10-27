"""Package real before/after captures; never synthesize app contents."""
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[1]
ARTIFACTS = Path("/mnt/zer0models/project-artifacts/dash/zeros-ui-20261020")
FRAMES = ["main-chats", "main-chats-search", "main-bots", "main-orchestra", "chat", "chat-streaming", "pair", "settings", "voice", "approvals"]
for folder in ["after", "pairs"]:
    (ARTIFACTS / folder).mkdir(parents=True, exist_ok=True)
(REPO / "screenshots/zeros-ui-before").mkdir(parents=True, exist_ok=True)
(REPO / "screenshots/zeros-ui-proof-mono").mkdir(parents=True, exist_ok=True)
for image in (REPO / "screenshots/debug").glob("*.png"):
    shutil.copy2(image, ARTIFACTS / "after" / image.name)
shutil.copy2(REPO / "screenshots/debug/geometry.json", ARTIFACTS / "after/geometry.json")
files = [*REPO.joinpath("app/src").rglob("*"), *REPO.joinpath("app/assets/orbs").rglob("*")]
files = [p for p in files if p.is_file()] + [REPO / p for p in ["app/App.tsx", "app/package.json", "app/bun.lock", "scripts/assert-living-night.mjs", "scripts/debug-screenshots.mjs"]]
hash_state = hashlib.sha256()
for file in sorted(files, key=lambda p: str(p.relative_to(REPO))):
    hash_state.update(str(file.relative_to(REPO)).encode() + b"\0" + file.read_bytes() + b"\0")
source_hash = hash_state.hexdigest()
for folder in [REPO / "screenshots/debug", ARTIFACTS / "proof-mono"]:
    receipt = json.loads((folder / "geometry.json").read_text())
    assert receipt.get("sourceHash") == source_hash, f"Stale render receipt: {folder}"
manifest = []
for frame in FRAMES:
    before = ARTIFACTS / "before-regenerated" / f"{frame}.png"
    after = ARTIFACTS / "after" / f"{frame}.png"
    pair = Image.new("RGB", (780, 876), "#151611")
    draw = ImageDraw.Draw(pair)
    draw.text((16, 10), "Before | 2ba915d", fill="#b4afa3")
    draw.text((406, 10), "After | Living Night", fill="#eccd8c")
    for image, x in [(before, 0), (after, 390)]:
        with Image.open(image) as capture:
            assert capture.size == (390, 844), (image, capture.size)
            pair.paste(capture.convert("RGB"), (x, 32))
    target = ARTIFACTS / "pairs" / f"{frame}.png"
    pair.save(target)
    shutil.copy2(before, REPO / "screenshots/zeros-ui-before" / before.name)
    manifest.append({"frame": frame, "before": str(before), "after": str(after), "pair": str(target), "after_sha256": hashlib.sha256(after.read_bytes()).hexdigest()})
for frame in ["main-chats", "approvals", "voice"]:
    shutil.copy2(ARTIFACTS / "proof-mono" / f"{frame}.png", REPO / "screenshots/zeros-ui-proof-mono" / f"{frame}.png")
assert len(manifest) == 10
for theme, folder in [("night", ARTIFACTS / "after"), ("proof-mono", ARTIFACTS / "proof-mono")]:
    receipt = json.loads((folder / "geometry.json").read_text())
    assert len(receipt["geometry"]) == 15, theme
    assert receipt["errors"] == [], theme
    assert len({r["scenario"] for r in receipt["geometry"]}) == 15, theme
(ARTIFACTS / "manifest.json").write_text(json.dumps({"baseline": "2ba915d871303fd302ffb2f5bd2747cff3405185", "required_frames": 10, "captured_per_theme": 15, "pairs": manifest}, indent=2) + "\n")
print(json.dumps({"pairs": len(manifest), "frames_per_theme": 15, "artifacts": str(ARTIFACTS)}, indent=2))
