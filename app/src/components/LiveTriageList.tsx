import { useEffect, useState } from 'react';
import { AppState, Linking, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { parseTriage, triageAge, triageStale, type TriageItem, type TriageSnapshot } from '../../../shared/triage';
import { executionToken } from '../lib/bridge-auth';
import { store } from '../store/app';
import { colors, fonts, space } from '../theme';
import { PressScale } from './PressScale';
import { useOrbMotion } from './OrbMotion';

type Feed = { phase: 'loading' } | { phase: 'unavailable'; reason: string } | { phase: 'live'; snapshot: TriageSnapshot };
export function LiveTriageList() {
  const settings = store.use(s => s.settings);
  const { active } = useOrbMotion();
  const [result, setResult] = useState<{ source: typeof settings; feed: Feed }>({ source: settings, feed: { phase: 'loading' } });
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const sameSource = result.source?.address === settings?.address && result.source?.token === settings?.token && result.source?.identity === settings?.identity;
  const feed: Feed = !settings ? { phase: 'unavailable', reason: 'Pair with a bridge to load current priorities' } : sameSource ? result.feed : { phase: 'loading' };
  useEffect(() => {
    setSelected(null);
    setResult({ source: settings, feed: { phase: 'loading' } });
    if (!settings || !active) return;
    let disposed = false, pending = false;
    let controller: AbortController | undefined;
    async function load() {
      if (disposed || pending || AppState.currentState !== 'active' || !settings) return;
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 12000);
      try {
        const token = await executionToken(settings);
        if (disposed || AppState.currentState !== 'active') return;
        if (controller.signal.aborted) throw new Error('Bridge request timed out');
        const response = await fetch(`http://${settings.address}/triage`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error(`Bridge HTTP ${response.status}`);
        const snapshot = parseTriage(await response.json());
        if (!snapshot || Date.now() - snapshot.generatedAt > 30000) throw new Error('Source snapshot is stale or unreadable');
        if (!disposed && AppState.currentState === 'active') setResult({ source: settings, feed: { phase: 'live', snapshot } });
      } catch (error) {
        if (!disposed && AppState.currentState === 'active') { setResult({ source: settings, feed: { phase: 'unavailable', reason: error instanceof Error ? error.message : 'Bridge unreachable' } }); setSelected(null); }
      } finally { clearTimeout(timeout); pending = false; }
    }
    void load();
    const poll = setInterval(() => void load(), 5000);
    return () => { disposed = true; controller?.abort(); clearInterval(poll); };
  }, [settings?.address, settings?.token, settings?.identity, active]);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const items = feed.phase === 'live' ? [...feed.snapshot.items].sort((a, b) => Number(triageStale(a, now)) - Number(triageStale(b, now)) || a.priority - b.priority || rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.id.localeCompare(b.id)) : [];
  const open = items.find(i => i.id === selected);
  return <View style={s.root}>
    <Text style={s.heading}>Current work and priorities</Text>
    {feed.phase !== 'live' ? <Text accessibilityRole="alert" style={s.meta}>{feed.phase === 'loading' ? 'Loading current priorities…' : `Triage unavailable · ${feed.reason}`}</Text> : null}
    {feed.phase === 'live' && feed.snapshot.warnings.length ? <Text style={s.meta}>{feed.snapshot.warnings.join(' · ')}</Text> : null}
    <ScrollView testID="live-triage-list" contentContainerStyle={s.list}>
      {feed.phase === 'live' && !items.length ? <Text style={s.meta}>No running work, blockers or owner-needed items reported. Missing sources are listed above.</Text> : null}
      {items.map(item => <PressScale key={item.id} accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={() => setSelected(item.id)} testID={`triage-item-${item.id}`} style={[s.card, triageStale(item, now) && s.stale]}>
        <Text style={s.title}>{item.title}</Text>
        <Text style={s.meta}>{triageStale(item, now) ? 'Stale · not current' : item.kind === 'running' ? 'Running · board status' : item.kind === 'blocked' ? 'Running · blocked' : item.kind === 'owner' ? 'Needs you' : 'Waiting on you'} · P{item.priority} · {triageAge(item, now)}</Text>
        <Text style={s.body}>{item.next}</Text>
        <Text style={s.meta}>{item.source}</Text>
      </PressScale>)}
    </ScrollView>
    {active && open ? <Modal transparent visible animationType="none" onRequestClose={() => setSelected(null)}><View style={s.backdrop}><View style={s.detail} testID="triage-detail" accessibilityViewIsModal>
      <ScrollView><Text style={s.title}>{open.title}</Text><Text style={s.meta}>{triageStale(open, now) ? 'Stale · not current · ' : ''}{triageAge(open, now)} · {open.source}</Text><Text selectable style={s.body}>{open.reason}</Text><Text selectable style={s.body}>{open.next}</Text>
      {open.url ? <PressScale accessibilityRole="button" accessibilityLabel="Open triage source" onPress={() => { if (open.url) void Linking.openURL(open.url); }} style={s.button}><Text style={s.body}>Open source PR</Text></PressScale> : null}</ScrollView>
      <PressScale accessibilityRole="button" accessibilityLabel="Close triage item" onPress={() => setSelected(null)} style={s.button}><Text style={s.body}>Close</Text></PressScale>
    </View></View></Modal> : null}
  </View>;
}
const rank = (item: TriageItem) => item.kind === 'blocked' ? 0 : item.kind === 'owner' ? 1 : 2;
const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.md, gap: space.sm }, list: { paddingBottom: 80, gap: space.sm },
  heading: { color: colors.text, fontSize: 16, marginVertical: space.sm }, title: { color: colors.text, fontSize: 15 },
  body: { color: colors.text, fontSize: 13, lineHeight: 20, marginVertical: 4 }, meta: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 11, lineHeight: 17 },
  card: { alignItems: 'stretch', padding: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }, stale: { opacity: 0.55 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)' },
  detail: { position: 'absolute', left: space.md, right: space.md, bottom: space.md, top: '25%', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.goldLo, borderRadius: 10, padding: space.md }, button: { minHeight: 44, justifyContent: 'center' },
});
