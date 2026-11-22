import { DensityText as Text } from "../components/Density";
import { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BotFace } from "../components/BotFace";
import { PressScale } from "../components/PressScale";
import { PrimaryButton } from "../components/PrimaryButton";
import { ScreenHeader } from "../components/ScreenHeader";
import { Tree } from "../components/Tree";
import { haptic } from "../haptics";
import { botTarget } from "../lib/bots";
import { FAMILY_LABEL, botGems, gemChannels, gemsSummary, orbitSlots, orreryHosts, type BotGem, type GemTone, type OrreryHost } from "../lib/bots-page";
import { hostsTree } from "../lib/hosts-tree";
import { botFaceIdentity } from "../lib/moodie-identity";
import { profileFromAgent } from "../lib/roster";
import { sessionChats } from "../lib/session-chats";
import { toMain } from "../lib/main-nav";
import { PRESS_SCALE } from "../motion";
import type { ScreenProps } from "../navigation";
import { shallowArrayEqual } from "../store/createStore";
import { openAgentConversation, store } from "../store/app";
import { colors, controlMin, glass, radius, space, type } from "../theme";
import type { AgentInfo, HostInfo } from "../../../shared/protocol";

type View3 = "table" | "orrery" | "tree";
const VIEWS: { id: View3; label: string }[] = [{ id: "table", label: "Table" }, { id: "orrery", label: "Orrery" }, { id: "tree", label: "Tree" }];

const TONE: Record<GemTone, string> = { ok: colors.ok, warn: colors.warn, danger: colors.danger, idle: colors.textFaint, offline: colors.textFaint };

/**
 * Bots page prototype (DA-073): every deployed bot as a gem in an element table or an orrery
 * around its host, a simple page per bot, and the host > harness > profile tree.
 */
export function BotsPageScreen({ navigation }: ScreenProps<"BotsPage">) {
  const insets = useSafeAreaInsets();
  const hosts = store.use(s => s.connection.hosts);
  const conversations = store.useSelector(sessionChats, shallowArrayEqual);
  const gems = useMemo(() => botGems(hosts), [hosts]);
  const [view, setView] = useState<View3>("table");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = gems.find(g => g.id === selectedId) ?? null;
  const pick = useCallback((gem: BotGem) => { haptic.select(); setSelectedId(gem.id); }, []);
  const back = () => {
    if (selected) { setSelectedId(null); return; }
    if (navigation.canGoBack()) navigation.goBack(); else toMain(navigation);
  };
  const openAgent = useCallback((host: HostInfo, agent: AgentInfo) => {
    const result = openAgentConversation(profileFromAgent(host, agent));
    if ("error" in result) { Alert.alert("Session unavailable", result.error); return; }
    navigation.navigate("Chat");
  }, [navigation]);
  const treeActions = useCallback(() => undefined, []);
  const nodes = useMemo(() => hostsTree(hosts, openAgent, treeActions, Date.now(), conversations), [hosts, openAgent, treeActions, conversations]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="bots-page">
      <ScreenHeader compact title={selected ? selected.name : "Bots"} onBack={back} />
      {selected ? <BotPage gem={selected} onChat={() => {
        const target = botTarget(selected.host, selected.bot);
        if (!target) return;
        const result = openAgentConversation(target);
        if ("error" in result) { Alert.alert("Chat unavailable", result.error); return; }
        navigation.navigate("Chat");
      }} bottom={insets.bottom} /> : <>
        <Text style={styles.summary} testID="bots-page-summary">{gemsSummary(gems, hosts)}</Text>
        <View style={styles.switcher} accessibilityRole="tablist">
          {VIEWS.map(v => {
            const on = v.id === view;
            return <PressScale key={v.id} scaleTo={PRESS_SCALE.control} accessibilityRole="tab" accessibilityLabel={`${v.label} view`} accessibilityState={{ selected: on }}
              onPress={() => { haptic.select(); setView(v.id); }} style={[styles.switch, on && styles.switchOn]}>
              <Text style={[styles.switchText, on && styles.switchTextOn]}>{v.label}</Text>
            </PressScale>;
          })}
        </View>
        {view === "tree" ? <View style={styles.tree}><Tree nodes={nodes} label="Hosts, harnesses and profiles" /></View> : (
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}>
            {gems.length === 0 ? null : view === "table" ? <GemTable gems={gems} onPick={pick} /> : orreryHosts(gems).map(h => <Orrery key={h.id} host={h} onPick={pick} />)}
          </ScrollView>
        )}
      </>}
    </View>
  );
}

function GemTable({ gems, onPick }: { gems: BotGem[]; onPick(gem: BotGem): void }) {
  const { width } = useWindowDimensions();
  // Phone widths get three columns, wide windows (DeX, web) up to six.
  const columns = Math.max(3, Math.min(6, Math.floor((Math.min(width, 900) - space.lg * 2) / 112)));
  const size = Math.floor((Math.min(width, 900) - space.lg * 2 - space.sm * (columns - 1)) / columns);
  return <View style={styles.table} accessibilityLabel="Bot table">
    {gems.map(gem => <Gem key={gem.id} gem={gem} size={size} onPick={onPick} />)}
  </View>;
}

function Gem({ gem, size, onPick }: { gem: BotGem; size: number; onPick(gem: BotGem): void }) {
  const identity = botFaceIdentity(gem.id, gem.bot.runtime);
  return (
    <PressScale testID={`bot-gem-${gem.id}`} accessibilityRole="button" accessibilityLabel={`${gem.name} on ${gem.hostName}, ${gem.stateWord}`}
      onPress={() => onPick(gem)} style={[styles.gem, { width: size, height: size }, !gem.hostOnline && styles.dim]}>
      <View pointerEvents="none" style={[styles.facet, { borderTopColor: identity.bodyColor }]} />
      <View style={styles.gemTop}>
        <Text style={styles.gemNumber}>{gem.number}</Text>
        <BotFace identity={identity} size={22} />
      </View>
      <Text style={styles.gemSymbol} numberOfLines={1}>{gem.symbol}</Text>
      <Text style={styles.gemName} numberOfLines={1}>{gem.name}</Text>
      <View style={styles.gemFoot}>
        <View style={[styles.dot, { backgroundColor: TONE[gem.tone] }]} />
        <Text style={styles.gemState} numberOfLines={1}>{gem.stateWord}</Text>
      </View>
    </PressScale>
  );
}

function Orrery({ host, onPick }: { host: OrreryHost; onPick(gem: BotGem): void }) {
  const { width } = useWindowDimensions();
  const box = Math.min(width - space.lg * 2, 420);
  const planet = 56;
  const orbit = (box - planet) / 2;
  const slots = orbitSlots(host.gems.length);
  const outer = host.gems.length > 6;
  return (
    <View style={styles.orreryWrap} testID={`bot-orrery-${host.id}`}>
      <View style={{ width: box, height: box }}>
        <View pointerEvents="none" style={[styles.ring, ringBox(box, orbit * 0.55)]} />
        {outer ? <View pointerEvents="none" style={[styles.ring, ringBox(box, orbit)]} /> : null}
        <View style={[styles.sun, { left: box / 2 - 44, top: box / 2 - 44 }, !host.online && styles.dim]}>
          <Text style={styles.sunLabel} numberOfLines={2}>{host.label}</Text>
          <Text style={styles.sunMeta}>{host.online ? `${host.gems.length} bots` : "Offline"}</Text>
        </View>
        {host.gems.map((gem, i) => {
          const slot = slots[i] ?? { x: 0, y: 0 };
          return <PressScale key={gem.id} testID={`bot-planet-${gem.id}`} accessibilityRole="button" accessibilityLabel={`${gem.name} on ${gem.hostName}, ${gem.stateWord}`}
            onPress={() => onPick(gem)} style={[styles.planet, { left: box / 2 + slot.x * orbit - planet / 2, top: box / 2 + slot.y * orbit - planet / 2, width: planet, height: planet }, !gem.hostOnline && styles.dim]}>
            <BotFace identity={botFaceIdentity(gem.id, gem.bot.runtime)} size={30} />
            <View style={[styles.planetDot, { backgroundColor: TONE[gem.tone] }]} />
          </PressScale>;
        })}
      </View>
      <Text style={styles.orreryCaption} numberOfLines={2}>{host.gems.map(g => g.symbol).join(" · ")}</Text>
    </View>
  );
}

function ringBox(box: number, r: number) {
  return { left: box / 2 - r, top: box / 2 - r, width: r * 2, height: r * 2, borderRadius: r };
}

/** The simple bot page: who it is, where it runs, which channels are live, and one action. */
function BotPage({ gem, onChat, bottom }: { gem: BotGem; onChat(): void; bottom: number }) {
  const identity = botFaceIdentity(gem.id, gem.bot.runtime);
  const target = botTarget(gem.host, gem.bot);
  const channels = gemChannels(gem);
  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: bottom + space.xl }]} testID="bot-page">
      <View style={styles.hero}>
        <View style={[styles.heroGem, { borderColor: identity.bodyColor }]}><BotFace identity={identity} size={96} /></View>
        <Text style={styles.heroSymbol}>{gem.symbol}</Text>
        <Text style={styles.heroMeta}>{`${FAMILY_LABEL[gem.family]} · ${gem.hostName}`}</Text>
        {gem.bot.detail ? <Text style={styles.heroDetail}>{gem.bot.detail}</Text> : null}
      </View>
      <Text style={styles.label}>Channels</Text>
      {channels.length === 0 ? <Text style={styles.note}>{`No chat platforms reported. ${gem.stateWord}.`}</Text> : channels.map(c => (
        <View key={c.id} style={styles.channel} testID={`bot-channel-${c.id}`} accessible accessibilityLabel={`${c.label} ${c.word}`}>
          <View style={[styles.dot, { backgroundColor: TONE[c.tone] }]} />
          <Text style={styles.channelName}>{c.label}</Text>
          <Text style={styles.channelState}>{c.word}</Text>
        </View>
      ))}
      <View style={styles.action}>
        {target ? <PrimaryButton label={`Chat with ${gem.name}`} disabled={!gem.hostOnline} onPress={onChat} />
          : <Text style={styles.note}>{`${gem.hostName} does not list a harness for this bot, so Dash cannot open a chat with it yet.`}</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  summary: { ...type.small, color: colors.textMuted, paddingHorizontal: space.lg, paddingBottom: space.sm },
  switcher: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
  switch: { minHeight: controlMin, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.border, backgroundColor: glass.fillChip, justifyContent: "center" },
  switchOn: { borderColor: colors.gold, backgroundColor: glass.fillChipOn },
  switchText: { ...type.label, color: colors.textMuted },
  switchTextOn: { color: colors.gold },
  tree: { flex: 1 },
  table: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.lg },
  gem: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.borderBright, backgroundColor: colors.surfaceRaised, padding: space.sm, overflow: "hidden", justifyContent: "space-between" },
  facet: { position: "absolute", left: 0, right: 0, top: 0, borderTopWidth: 2 },
  gemTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  gemNumber: { ...type.mono, color: colors.textTertiary },
  gemSymbol: { ...type.number, color: colors.text },
  gemName: { ...type.small, color: colors.textMuted },
  gemFoot: { flexDirection: "row", alignItems: "center", gap: space.xs },
  gemState: { ...type.mono, color: colors.textTertiary, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dim: { opacity: 0.45 },
  orreryWrap: { alignItems: "center", paddingVertical: space.md },
  ring: { position: "absolute", borderWidth: StyleSheet.hairlineWidth, borderColor: glass.hair2 },
  sun: { position: "absolute", width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surfaceRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.borderBright, alignItems: "center", justifyContent: "center", padding: space.xs },
  sunLabel: { ...type.label, color: colors.text, textAlign: "center" },
  sunMeta: { ...type.mono, color: colors.textTertiary },
  planet: { position: "absolute", borderRadius: radius.pill, backgroundColor: glass.fillRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.borderBright, alignItems: "center", justifyContent: "center" },
  planetDot: { position: "absolute", right: 6, bottom: 6, width: 8, height: 8, borderRadius: 4 },
  orreryCaption: { ...type.mono, color: colors.textTertiary, paddingTop: space.sm, paddingHorizontal: space.lg, textAlign: "center" },
  page: { paddingHorizontal: space.lg },
  hero: { alignItems: "center", paddingVertical: space.xl, gap: space.xs },
  heroGem: { width: 136, height: 136, borderRadius: radius.lg, borderWidth: 1, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  heroSymbol: { ...type.title, color: colors.text, paddingTop: space.sm },
  heroMeta: { ...type.small, color: colors.textMuted },
  heroDetail: { ...type.small, color: colors.textTertiary },
  label: { ...type.label, color: colors.textTertiary, paddingTop: space.md, paddingBottom: space.xs },
  channel: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: controlMin, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: glass.hair },
  channelName: { ...type.body, color: colors.text, flex: 1 },
  channelState: { ...type.small, color: colors.textMuted },
  note: { ...type.small, color: colors.textMuted, paddingVertical: space.sm },
  action: { paddingTop: space.xl },
});
