/** @jsxImportSource @stencil-hq/tern */
// The minimal roadmap as TSP nodes. Attention order: what waits on the owner (with the one next
// action), what runs now (with how long since it last moved), then the roadmap by priority with a
// compact progress bar; the selected item opens to its evidence. No spinners: running work shows
// a Tern-clocked `elapsed`, and a changed item glows once (styles.ts).
import { type JSX } from '@stencil-hq/tern'

import { prUrl, roadmapProgress, roadmapSections, type RoadmapDocument, type RoadmapItem } from '../../shared/roadmap'

export interface ViewState {
  doc: RoadmapDocument
  selected: string | undefined
  expanded: ReadonlySet<string>
  changed: ReadonlySet<string>
  error: string | undefined
  /** Tern-clocked age (ms) for a timer, fixed at first use so frames do not resend it. */
  age: (key: string, since: number) => number
  readAt: number
  onPick: (id: string) => void
}

/** Items in keyboard order. */
export function order(doc: RoadmapDocument): string[] {
  const s = roadmapSections(doc)
  return [...s.you, ...s.running, ...s.list].map(i => i.id)
}

/** The node id of an item's row, for `reveal` (main's root id, then section and item keys). */
export function itemNodeId(section: 'you' | 'running' | 'list', id: string): string {
  return `main.root.${section}.i-${id}`
}

export function sectionOf(doc: RoadmapDocument, id: string): 'you' | 'running' | 'list' {
  const item = doc.items.find(i => i.id === id)
  return item?.attention === 'you' ? 'you' : item?.attention === 'running' ? 'running' : 'list'
}

function roles(base: string, item: RoadmapItem, v: ViewState): string {
  return [base, v.selected === item.id ? 'sel' : '', v.changed.has(item.id) ? 'changed' : '', v.expanded.has(item.id) ? 'open' : ''].filter(Boolean).join(' ')
}

function pct(item: RoadmapItem): string {
  return item.progress === undefined ? '' : `${item.progress}%`
}

function details(item: RoadmapItem, v: ViewState): JSX.Element | null {
  if (!v.expanded.has(item.id)) return null
  const url = prUrl(item)
  const facts = [
    item.evidence ? { k: 'Evidence', v: item.evidence } : null,
    item.next && item.attention !== 'you' ? { k: 'Next', v: item.next } : null,
    item.detail ? { k: 'Detail', v: item.detail } : null,
    { k: 'Stage', v: `${item.stage}${item.area ? ` · ${item.area}` : ''}` }
  ].filter(x => x !== null)
  return (
    <col key="more" role="dash.more" gap="xs">
      {facts.map(f => <text key={f.k} role="dash.fact" wrap="word" spans={[{ t: `${f.k}  `, s: 'dim' }, f.v]} />)}
      {url ? <text key="pr" spans={[{ t: 'o', s: 'key' }, ' ', { t: url.replace('https://github.com/', ''), s: 'link', href: url }]} /> : null}
    </col>
  )
}

function youRow(item: RoadmapItem, v: ViewState): JSX.Element {
  const action = item.next && item.next !== item.title ? item.next : ''
  return (
    <col key={`i-${item.id}`} role={roles('dash.item dash.you', item, v)} onClick={() => v.onPick(item.id)} gap="none">
      <row key="head" gap="sm" align="baseline">
        {item.priority ? <badge key="p" tone="warning">{item.priority}</badge> : null}
        <text key="t" role="dash.title" wrap="word" grow={1}>{item.title}</text>
      </row>
      {action ? <text key="next" role="dash.next" spans={[{ t: '→ ', s: 'accent' }, action]} wrap="word" /> : null}
      {details(item, v)}
    </col>
  )
}

function runningRow(item: RoadmapItem, v: ViewState): JSX.Element {
  return (
    <col key={`i-${item.id}`} role={roles('dash.item dash.running', item, v)} onClick={() => v.onPick(item.id)} gap="none">
      <row key="head" gap="sm" align="baseline">
        <text key="dot" role="dash.livedot" text="●" />
        <text key="t" role="dash.title" wrap="word" lines={v.expanded.has(item.id) ? undefined : 2} truncate="end" grow={1}>{item.title}</text>
        {item.updatedAt ? <elapsed key="age" role="dash.age" age={v.age(`${item.id}@${item.updatedAt}`, item.updatedAt)} format="short" /> : null}
      </row>
      {details(item, v)}
    </col>
  )
}

function listRow(item: RoadmapItem, v: ViewState): JSX.Element {
  const value = (item.progress ?? 0) / 100
  const finished = (item.progress ?? 0) >= 100 || item.stage === 'verified'
  return (
    <col key={`i-${item.id}`} role={roles(`dash.item dash.row${finished ? ' done' : ''}`, item, v)} onClick={() => v.onPick(item.id)} gap="none">
      <row key="head" gap="sm" align="center">
        <text key="p" role="dash.pri" text={item.priority ?? '··'} />
        <text key="t" role="dash.title" wrap={v.expanded.has(item.id) ? 'word' : 'none'} truncate="end" grow={1}>{item.title}</text>
        <meter key="m" role="dash.bar" value={value} style="bar" size="sm" tone={finished ? 'success' : 'neutral'} title={pct(item)} />
        <text key="n" role="dash.pct" text={pct(item)} />
      </row>
      {details(item, v)}
    </col>
  )
}

function head(title: string, count: number, key: string, hint?: string): JSX.Element {
  return (
    <row key={key} role="dash.head" gap="sm" align="baseline">
      <text key="t" text={title.toUpperCase()} role="dash.label" />
      <text key="n" text={String(count)} role="dash.count" />
      {hint ? <text key="h" text={hint} role="dash.hint" grow={1} truncate="end" wrap="none" /> : null}
    </row>
  )
}

export function roadmapView(v: ViewState): JSX.Element[] {
  const s = roadmapSections(v.doc)
  const overall = roadmapProgress(v.doc)
  const out: JSX.Element[] = [
    <row key="top" role="dash.top" gap="sm" align="baseline">
      <text key="t" role="dash.brand" text="Roadmap" />
      {overall === undefined ? null : <text key="o" role="dash.overall" text={`${overall}% proven`} />}
      <text key="u" role="dash.hint" grow={1} wrap="none" truncate="end" text={`${v.doc.items.length} items`} />
      <elapsed key="age" role="dash.age" age={v.age(`read@${v.readAt}`, v.readAt)} format="short" title="since the file last changed" />
    </row>
  ]
  if (v.error) out.push(<text key="err" role="dash.error" tone="error" wrap="word" text={v.error} />)
  if (s.you.length) {
    out.push(head('Waiting on you', s.you.length, 'you-h', 'blocks progress'))
    out.push(<col key="you" role="dash.section dash.attn" gap="xs">{s.you.map(i => youRow(i, v))}</col>)
  }
  if (s.running.length) {
    out.push(head('Running now', s.running.length, 'run-h'))
    out.push(<col key="running" role="dash.section" gap="xs">{s.running.map(i => runningRow(i, v))}</col>)
  }
  out.push(head('Roadmap', s.list.length, 'list-h', 'by priority'))
  out.push(<col key="list" role="dash.section" gap="none">{s.list.map(i => listRow(i, v))}</col>)
  out.push(
    <text key="keys" role="dash.keys" wrap="word" spans={[{ t: 'j k', s: 'key' }, ' move  ', { t: 'enter', s: 'key' }, ' evidence  ', { t: 'o', s: 'key' }, ' PR  ', { t: 'r', s: 'key' }, ' refresh  ', { t: 'q', s: 'key' }, ' close']} />
  )
  return [<col key="root" role="dash.root" gap="none">{out}</col>]
}
