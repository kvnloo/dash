"""Isolated MBP job only: resolve the existing private dependency without moving credentials."""
import json
from pathlib import Path
p = Path('app/package.json')
x = json.loads(p.read_text())
x['dependencies']['@kvnloo/aodl-views'] = 'file:../../input-vendor/aodl-views'
p.write_text(json.dumps(x, indent=2) + '\n')
p = Path('bridge/node_modules')
if p.is_symlink():
    p.unlink()
p = Path('.git')
if p.is_file():
    p.unlink()
