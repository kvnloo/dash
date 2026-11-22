"""Usage: python3 -I trust.py <config.json> <dir> [--show]  -> set projects[dir].hasTrustDialogAccepted=true (backup kept)."""
import json, shutil, sys, time
cfg, d = sys.argv[1], sys.argv[2]
data = json.load(open(cfg))
p = data.setdefault("projects", {})
if "--show" in sys.argv:
    print({k: {kk: v.get(kk) for kk in ("hasTrustDialogAccepted", "allowedTools")} for k, v in p.items() if d in k or k in d})
    sys.exit(0)
shutil.copy2(cfg, cfg + ".bak-turbo-" + time.strftime("%Y%m%d%H%M%S"))
p.setdefault(d, {})["hasTrustDialogAccepted"] = True
tmp = cfg + ".tmp"
json.dump(data, open(tmp, "w"), indent=2)
shutil.move(tmp, cfg)
print("trusted", d)
