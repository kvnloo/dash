"""MBP-only check of captured intents against the pinned canonical AODL schema.

No corpus/profile activation, model call or private-data upload. Only the public
schema is downloaded. Validation errors report the field/rule, not private values.
"""
import json
import pathlib
import sys
import urllib.request

import jsonschema

REVISION = "55db6314f9e05c145dc47710ea6a7dba21d5af60"
URL = f"https://raw.githubusercontent.com/kvnloo/aodl/{REVISION}/schema/hotl-0.2.schema.json"
root = pathlib.Path(sys.argv[1])
with urllib.request.urlopen(URL, timeout=20) as response:
    schema = json.load(response)
validator = jsonschema.Draft202012Validator(schema)
paths = sorted(root.glob("intents/*/INTENT.json"))
if not paths:
    raise SystemExit("No actual captured intents to validate")
failures = []
for path in paths:
    document = json.loads(path.read_text())
    for error in validator.iter_errors(document):
        failures.append({"file": path.parent.name, "field": ".".join(map(str, error.path)), "rule": error.validator})
print(json.dumps({"schema": URL, "documents": len(paths), "failures": failures}))
raise SystemExit(bool(failures))
