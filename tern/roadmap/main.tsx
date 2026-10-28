#!/usr/bin/env bun
/** @jsxImportSource @stencil-hq/tern */
// Dash minimal roadmap: a native Tern pane over the Tern Surface Protocol.
//
//   bun tern/roadmap/main.tsx            # in a Tern pane
//   tern split @focused right -- bun "$PWD/tern/roadmap/main.tsx"
//
// Reads the Dash roadmap file (bridge/src/roadmap-store.ts; $DASH_ROADMAP_FILE overrides) and
// watches it: an update from `dash-roadmap set …` repaints within a frame, and the changed item
// glows once. Outside Tern it prints the roadmap as text and exits.
import { spawn } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { mkdirSync, statSync } from 'node:fs'
import { basename, dirname } from 'node:path'

import { connect, plain, type Key, type Surface } from '@stencil-hq/tern'

import { changedItems, emptyRoadmap, prUrl, type RoadmapDocument } from '../../shared/roadmap'
import { readRoadmap, roadmapFile } from '../../bridge/src/roadmap-store'
import { PALETTE, STYLES } from './styles'
import { itemNodeId, order, roadmapView, sectionOf, type ViewState } from './view'

const GLOW_MS = 2400

const file = roadmapFile()
let doc: RoadmapDocument = emptyRoadmap()
let error: string | undefined
let readAt = Date.now()
let selected: string | undefined
const expanded = new Set<string>()
const changed = new Map<string, number>()
const ages = new Map<string, number>()

let stamp = ''
function load(initial: boolean, force = true): void {
  try {
    const st = statSync(file, { throwIfNoEntry: false })
    const seen = st ? `${st.mtimeMs}:${st.size}` : 'none'
    if (!force && seen === stamp) return
    stamp = seen
    const next = readRoadmap(file)
    if (!initial) {
      const now = Date.now()
      for (const id of changedItems(doc, next)) changed.set(id, now + GLOW_MS)
    }
    doc = next
    error = undefined
    readAt = Date.now()
  } catch (e) {
    // Keep the last good document on screen; say why the new one was not shown.
    error = `Could not read ${basename(file)}: ${e instanceof Error ? e.message : String(e)}`
  }
  const ids = order(doc)
  if (!selected || !ids.includes(selected)) selected = ids[0]
}

load(true)

const session = await connect({ app: 'dash-roadmap', version: '0.1.0' })
if (!session) {
  const v = viewState()
  process.stdout.write(plain(roadmapView(v)) + '\n')
  process.exit(0)
}

const surface: Surface = session.open({ mode: 'screen', title: 'Dash roadmap', role: 'dash.roadmap' })
surface.stylesheet('dash', STYLES)
surface.palette(PALETTE)

function viewState(): ViewState {
  const now = Date.now()
  return {
    doc,
    selected,
    expanded,
    changed: new Set([...changed].filter(([, until]) => until > now).map(([id]) => id)),
    error,
    readAt,
    age: (key, since) => {
      let a = ages.get(key)
      if (a === undefined) ages.set(key, (a = Math.max(0, Date.now() - since)))
      return a
    },
    onPick: id => {
      if (selected === id) toggle(id)
      selected = id
      paint()
    }
  }
}

let glowTimer: ReturnType<typeof setTimeout> | undefined
function paint(reveal = false): void {
  if (surface.closed) return
  surface.render(roadmapView(viewState()))
  if (reveal && selected) surface.reveal(itemNodeId(sectionOf(doc, selected), selected), 'nearest')
  // One repaint when the newest glow ends, so the role drops and the next change can glow again.
  const pending = [...changed.values()].filter(t => t > Date.now())
  for (const [id, until] of changed) if (until <= Date.now()) changed.delete(id)
  if (glowTimer) clearTimeout(glowTimer)
  if (pending.length) glowTimer = setTimeout(() => paint(), Math.max(...pending) - Date.now() + 20)
}

function toggle(id: string): void {
  if (expanded.has(id)) expanded.delete(id)
  else expanded.add(id)
}

function move(by: number): void {
  const ids = order(doc)
  if (!ids.length) return
  const at = selected ? ids.indexOf(selected) : -1
  selected = ids[Math.max(0, Math.min(ids.length - 1, at + by))]
  paint(true)
}

function openPr(): void {
  const item = doc.items.find(i => i.id === selected)
  const url = item ? prUrl(item) : undefined
  if (!url) {
    error = item ? `No pull request on “${item.title}”.` : undefined
    paint()
    setTimeout(() => { if (error?.startsWith('No pull request')) { error = undefined; paint() } }, 2400)
    return
  }
  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
}

// Live: watch the directory (writes are a rename onto the file) and repaint once per burst; an
// event that left the file as it was (same mtime and size) repaints nothing.
let watcher: FSWatcher | undefined
let debounce: ReturnType<typeof setTimeout> | undefined
try {
  mkdirSync(dirname(file), { recursive: true })
  watcher = watch(dirname(file), (_event, name) => {
    // Bun reports an atomic write (temp file renamed onto the file) by the temp file's name.
    if (name && !name.startsWith(basename(file))) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => { const before = stamp; load(false, false); if (stamp !== before) paint() }, 60)
  })
} catch (e) {
  error = `Not watching ${dirname(file)}: ${e instanceof Error ? e.message : String(e)}. Press r to refresh.`
}

paint()

function onKey(key: Key): boolean {
  if ((key.ctrl && (key.name === 'c' || key.name === 'd')) || key.name === 'q' || key.name === 'escape') return false
  switch (key.name) {
    case 'j': case 'down': move(1); break
    case 'k': case 'up': move(-1); break
    case 'g': case 'home': move(-1e6); surface.scroll('main.root', 'start'); break
    case 'end': move(1e6); break
    case 'enter': case 'space': case 'l': case 'h':
      if (selected) { toggle(selected); paint(true) }
      break
    case 'o': openPr(); break
    case 'r': load(false); paint(); break
    default:
      if (key.text === 'G') move(1e6)
  }
  return true
}

for await (const input of session) {
  if (input.type === 'key' && !onKey(input.key)) break
  if (input.type === 'event' && (input.event.ev === 'resize' || input.event.ev === 'theme' || input.event.ev === 'visible')) paint()
}
watcher?.close()
await session.close()
process.exit(0)
