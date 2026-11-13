#!/bin/bash
set -u
src="$PWD"; base="$HOME/.cache/dash-turbo01b-iso-20261025"
exec 9>"$base.lock"; flock 9
out="$src/.turbo-receipts/iso"; mkdir -p "$out"; : > "$out/status.txt"
while read -r name sha hash; do
  t="$src/.iso/$name.tar"; echo "$hash  $t" | sha256sum -c --quiet || { echo "$name sha=$sha hash_mismatch" >> "$out/status.txt"; continue; }
  d="$HOME/.cache/dash-iso-$name"; rm -rf "$d"; mkdir -p "$d"; tar xf "$t" -C "$d"
  ln -s "$base/node_modules" "$d/node_modules"; ln -s "$base/app/node_modules" "$d/app/node_modules"; ln -s "$base/bridge/node_modules" "$d/bridge/node_modules"
  ( cd "$d" && git init -q && git add app/src bridge/src shared scripts 2>/dev/null
    bun run test > "$out/$name.unit.log" 2>&1; u=$?
    bun run typecheck > "$out/$name.typecheck.log" 2>&1; ty=$?
    bun run lint > "$out/$name.lint.log" 2>&1; l=$?
    echo "$name sha=$sha unit=$u typecheck=$ty lint=$l" >> "$out/status.txt" )
  rm -rf "$d"
done < "$src/.iso/branches.txt"
cat "$out/status.txt"
