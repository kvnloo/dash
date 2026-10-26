#!/usr/bin/env python3
"""Validate spec/features.yaml (the Dash feature ledger).

Checks, all of which must pass (exit 1 otherwise):
  1. features.yaml parses and matches spec/schema.json.
  2. Feature ids (DF-NNN) and journey ids are unique; DF ids are contiguous from DF-001.
  3. Every feature names a journey that is defined in `journeys`.
  4. Every surface_ref / gap_ref file exists at the git revision (default HEAD) and its line,
     when given, is within the file.
  5. Ledger laws: status missing <=> surface_refs empty; recurring => priority P0.

Dependency-free: features.yaml is written in a YAML subset (block mappings and lists whose
scalars are JSON literals), so any YAML 1.2 parser reads it the same way as `load_yaml`.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


class YamlError(ValueError):
    pass


def _lines(text: str) -> list[tuple[int, int, str]]:
    out = []
    for number, raw in enumerate(text.splitlines(), 1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "\t" in raw[: len(raw) - len(raw.lstrip())]:
            raise YamlError(f"line {number}: tab indentation")
        out.append((number, len(raw) - len(raw.lstrip(" ")), stripped))
    return out


def _scalar(text: str, number: int):
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise YamlError(f"line {number}: value must be a JSON literal: {text!r} ({exc.msg})") from None


_KEY = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$")


def _block(lines, i: int, indent: int):
    """Parse the block starting at lines[i] whose indentation is exactly `indent`."""
    if lines[i][2].startswith("- ") or lines[i][2] == "-":
        return _list(lines, i, indent)
    return _mapping(lines, i, indent)


def _value_after_key(lines, i: int, indent: int, rest, number: int):
    if rest is not None and rest != "":
        return _scalar(rest, number), i + 1
    if i + 1 < len(lines) and lines[i + 1][1] > indent:
        return _block(lines, i + 1, lines[i + 1][1])
    if i + 1 < len(lines) and lines[i + 1][1] == indent and lines[i + 1][2].startswith("- "):
        return _list(lines, i + 1, indent)
    raise YamlError(f"line {number}: key has no value")


def _mapping(lines, i: int, indent: int, first: str | None = None):
    out: dict = {}
    while i < len(lines):
        number, ind, text = lines[i]
        if first is not None:
            text, first = first, None
        elif ind != indent:
            if ind > indent:
                raise YamlError(f"line {number}: unexpected indentation")
            break
        elif text.startswith("- "):
            break
        m = _KEY.match(text)
        if not m:
            raise YamlError(f"line {number}: expected 'key: value'")
        key = m.group(1)
        if key in out:
            raise YamlError(f"line {number}: duplicate key {key!r}")
        out[key], i = _value_after_key(lines, i, indent, m.group(2), number)
    return out, i


def _list(lines, i: int, indent: int):
    out: list = []
    while i < len(lines):
        number, ind, text = lines[i]
        if ind != indent or not text.startswith("- "):
            if ind > indent:
                raise YamlError(f"line {number}: unexpected indentation")
            break
        body = text[2:].strip()
        if _KEY.match(body):
            item, i = _mapping(lines, i, indent + 2, first=body)
            out.append(item)
        else:
            out.append(_scalar(body, number))
            i += 1
    return out, i


def load_yaml(text: str):
    lines = _lines(text)
    if not lines:
        raise YamlError("empty document")
    value, i = _block(lines, 0, lines[0][1])
    if i != len(lines):
        raise YamlError(f"line {lines[i][0]}: trailing content")
    return value


def dump_yaml(value, indent: int = 0) -> str:
    """Inverse of load_yaml for dicts/lists/JSON scalars."""
    pad = " " * indent
    out: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, (dict, list)) and item:
                out.append(f"{pad}{key}:")
                out.append(dump_yaml(item, indent + 2))
            else:
                out.append(f"{pad}{key}: {json.dumps(item, ensure_ascii=False)}")
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, dict) and item:
                body = dump_yaml(item, indent + 2).splitlines()
                out.append(f"{pad}- {body[0].lstrip()}")
                out.extend(body[1:])
            else:
                out.append(f"{pad}- {json.dumps(item, ensure_ascii=False)}")
    else:
        out.append(pad + json.dumps(value, ensure_ascii=False))
    return "\n".join(out)


# ---- minimal JSON Schema (draft 2020-12 subset used by schema.json) ----
_TYPES = {"object": dict, "array": list, "string": str, "boolean": bool, "integer": int}


def validate(value, schema: dict, root: dict, path: str = "$") -> list[str]:
    if "$ref" in schema:
        ref = schema["$ref"]
        if not ref.startswith("#/$defs/"):
            return [f"{path}: unsupported $ref {ref}"]
        schema = root["$defs"][ref.split("/")[-1]]
    errors: list[str] = []
    kind = schema.get("type")
    if kind:
        expected = _TYPES[kind]
        if not isinstance(value, expected) or (kind == "integer" and isinstance(value, bool)):
            return [f"{path}: expected {kind}"]
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} not in {schema['enum']}")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            errors.append(f"{path}: shorter than {schema['minLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{path}: {value!r} does not match {schema['pattern']}")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            errors.append(f"{path}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{path}: more than {schema['maxItems']} items")
        if schema.get("uniqueItems") and len({json.dumps(v, sort_keys=True) for v in value}) != len(value):
            errors.append(f"{path}: items are not unique")
        for index, item in enumerate(value):
            errors += validate(item, schema.get("items", {}), root, f"{path}[{index}]")
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f"{path}: missing {key}")
        props = schema.get("properties", {})
        for key, item in value.items():
            if key in props:
                errors += validate(item, props[key], root, f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}: unexpected key {key}")
    return errors


# ---- repository checks ----
def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)


def _line_count(repo: Path, rev: str, path: str, cache: dict) -> int | None:
    if path not in cache:
        shown = _git(repo, "show", f"{rev}:{path}")
        cache[path] = None if shown.returncode else shown.stdout.count("\n") + (0 if shown.stdout.endswith("\n") or not shown.stdout else 1)
    return cache[path]


def check(doc, schema: dict, repo: Path, rev: str = "HEAD") -> list[str]:
    errors = validate(doc, schema, schema)
    if errors:
        return errors
    journeys = [j["id"] for j in doc["journeys"]]
    for dup in sorted({j for j in journeys if journeys.count(j) > 1}):
        errors.append(f"duplicate journey id {dup}")
    ids = [f["id"] for f in doc["features"]]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        errors.append(f"duplicate feature id {dup}")
    expected = [f"DF-{n:03d}" for n in range(1, len(ids) + 1)]
    if sorted(ids) != expected:
        errors.append("feature ids must be contiguous DF-001..DF-%03d" % len(ids))
    known = set(journeys)
    cache: dict = {}
    for feature in doc["features"]:
        fid = feature["id"]
        if feature["journey"] not in known:
            errors.append(f"{fid}: journey {feature['journey']} is not defined")
        missing = feature["status_from_code"] == "missing"
        if missing and feature["surface_refs"]:
            errors.append(f"{fid}: status missing but surface_refs is not empty (use gap_refs)")
        if not missing and not feature["surface_refs"]:
            errors.append(f"{fid}: status {feature['status_from_code']} needs surface_refs")
        if feature["recurring"] and feature["priority"] != "P0":
            errors.append(f"{fid}: recurring owner asks are P0")
        for ref in feature["surface_refs"] + feature.get("gap_refs", []):
            errors += _check_ref(repo, rev, ref, fid, cache)
    for item in doc.get("unrequired_surface", []):
        errors += _check_ref(repo, rev, item["ref"], "unrequired_surface", cache)
    return errors


def _check_ref(repo: Path, rev: str, ref: str, owner: str, cache: dict) -> list[str]:
    path, _, line = ref.partition(":")
    count = _line_count(repo, rev, path, cache)
    if count is None:
        return [f"{owner}: {path} does not exist at {rev}"]
    if line and int(line) > count:
        return [f"{owner}: {ref} is past end of file ({count} lines at {rev})"]
    return []


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--features", type=Path, default=HERE / "features.yaml")
    parser.add_argument("--schema", type=Path, default=HERE / "schema.json")
    parser.add_argument("--repo", type=Path, default=HERE.parent)
    parser.add_argument("--rev", default="HEAD")
    args = parser.parse_args(argv)
    try:
        doc = load_yaml(args.features.read_text(encoding="utf-8"))
    except (OSError, YamlError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    schema = json.loads(args.schema.read_text(encoding="utf-8"))
    errors = check(doc, schema, args.repo, args.rev)
    for error in errors:
        print(f"error: {error}", file=sys.stderr)
    if errors:
        return 1
    print(f"ok: {len(doc['features'])} features, {len(doc['journeys'])} journeys at {args.rev}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
