---
name: dash-genui
description: Use when replying in Dash with inline diagrams, images, previews or interactive choices. Emit bounded declarative UI alongside useful prose.
---

# Inline UI in Dash (opt-in)

When a diagram, visual result, comparison or choice is clearer than prose, include it directly in the normal assistant reply. No `/visual` or file-preparation command is needed. Keep accompanying text short. Never manufacture measurements or label a preview approved/verified without evidence.

- Use `mermaid` fences for `flowchart TD|LR|BT|RL` / `graph` or `stateDiagram-v2`. Supported: ASCII node IDs, square/round/diamond labels, `-->`, `---`, `==>`, `-.->`, `|edge label|`, simple chains; state aliases `state "Label" as Id`, `Id : detail`, `[*]` start/end, `--> Id : transition`. Avoid subgraphs, styling/click directives, nested/concurrent states and other Mermaid types; those remain readable code.
- Images: `![description](https://host/image.png)` or `![description](/absolute/shared/path/image.png)`. Bare HTTP image links also preview. PNG/JPEG/WebP/GIF/AVIF only for host files, max 12 MiB. Host files must be inside bridge share roots. Do not include secrets in URLs or paths. Remote image URLs are fetched by the user's client, so prefer trusted hosts.
- Use a `genui` fence with strict JSON `{ "version": 1, "components": [...] }`. `openui` accepts this same JSON only; it is NOT the Thesys OpenUI language. No JavaScript, event handlers, URLs, tool names or command fields.
- Components: every component has `type`, `title`. Optional `text`; `card` may have `children`; `stat` has string/number `value`; `progress` has numeric `value` 0–100; `table` has `columns: string[]`, `rows: string[][]`; `timeline` has `items: [{id,label,detail?}]`.
- `choices`, `buttons`, `checklist` require a short stable `id` and `items: [{id,label,detail?,checked?}]`. Taps send a validated LiveIntent, not a tool call, execution permission or approval. In ordinary Hermes/omp chats it arrives as a visible user message beginning `UI choice from reply ...`; in the libfx live lane it uses the existing live_intent/receipt path. Checklist intent values are `itemId:true|false`. Interpret the user's selection in context, and still follow normal approval policy for consequential actions.
- Use `html` fences for self-contained static previews. Inline scripts, navigation, forms, external assets and network are disabled. Inline CSS and embedded data images work. Offer the built-in “Open in stage” expansion; never claim the preview is published.

Example:

```genui
{"version":1,"components":[{"type":"card","title":"Next step","text":"Choose a direction, not an approval.","children":[{"type":"choices","id":"direction","title":"Explore","items":[{"id":"inspect","label":"Inspect changes"},{"id":"revise","label":"Revise design"}]}]}]}
```

Stay compact: max 24 root components, 80 total, nesting depth 5; tables max 40 rows/12 columns; items max 24; no unknown fields. Incomplete/invalid/unsupported source stays code. Don't emit UI merely to decorate an answer.
