# Dash phone UI — full surface inventory

Case study of human–AI mobile synergy. Source: `app/src` on worktree `ai-ui-patterns` (branch `cursor/ai-ui-pattern-atlas-8df6`). Cross-checked against `decisions.json`, `.cursor/skills/dash-motion/SKILL.md`, `.cursor/skills/dash-android-ui/SKILL.md`.

Legend for **works?** — `yes` = handler wired to real behavior; `dead` = visible affordance with no handler or no reachable open path; `partial` = handler exists but outcome is empty/misleading; `display` = non-interactive chrome.

---

## 1. Every user-facing control

### App chrome — `components/AppNav.tsx`

| Control | Does | Gesture | Works? | A11y |
|---------|------|---------|--------|------|
| Expand circle (left) | Navigates to **Voice** (label says Expand) | tap · `PressScale` nav 0.9 · `haptic.tap` | yes (mislabeled) | `accessibilityLabel="Expand"` |
| Tab Bots / Chats / Orchestra | Switches Main pager page | tap · raw `Pressable` (no PressScale) · `haptic.tap` via `goTab` | yes | `role=tab`, label = tab name, `selected` |
| Gold gel pill | Follows pager progress (display) | none | display | inside pager `accessibilityLabel="Primary mobile workspace"` |
| Bridge chevron (right) | Toggles BridgePull; else Settings | tap · `PressScale` nav · `haptic.tap`; pan on chrome | yes | `accessibilityLabel="Bridge details"` |
| Nav chrome pan | Opens/closes BridgePull sheet | pan Y · `activeOffsetY([-22,10])` · `failOffsetX([-24,24])` | yes | dismiss/sheet labeled; hit strip hidden |

### Bridge overlay — `components/BridgePull.tsx`

| Control | Does | Gesture | Works? | A11y |
|---------|------|---------|--------|------|
| Dim backdrop | Closes sheet | tap · `haptic.tap` | yes | `Dismiss bridge details` |
| Status row | `bridge.retry()` when offline/connecting | tap · `PressScale` row | yes when retryable | label = status text |
| Host / harness rows & chips | Presence display | none | display | dots only |
| Edit / Pair | Closes → Settings or Pair | tap · `PressScale` · `haptic.tap` | yes | `Edit bridge` / `Pair` |
| Handle | Visual drag affordance | (sheet pan) | display | none |

### Main — `screens/MainScreen.tsx`

| Control | Does | Gesture | Works? | A11y |
|---------|------|---------|--------|------|
| Search results | Open bot/chat/product/harness or draft skill/tool/file into Chat | tap via `SearchResultRow` | yes | row `role=button`; no per-kind label |
| Search empty | Explains unknown `@`/`/` or no matches | — | display | title/sub text only |
| Hint line | Scope guidance while searching | — | display | `accessibilityRole="text"` |
| Bots / Chats / Orchestra panes | See panes | horizontal pager swipe | yes | — |
| `GlobalSearchBar` dock | See below | IME via `KeyboardDock` | yes | — |

### GlobalSearchBar — `components/GlobalSearchBar.tsx`

| Control | Does | Gesture | Works? | A11y |
|---------|------|---------|--------|------|
| `+` (Mention) | Inserts `@` / prefixes `@` | tap · `PressScale` control | yes | `Mention` |
| Text field | Query / message | type · focus shows chips | yes | `Message` |
| Scope chips | `onScope(label)` rewrite | tap · `staggerUp` enter · `haptic.tap` in Main | yes | `role=button`; chip text only |
| Send (when text) | `onSend` → open harness with draft | tap · `popIn`/`popOut` | yes | `Send` |
| Mic (when empty) | Navigate Voice | tap | yes | `Voice input` |

### Composer — `components/Composer.tsx`

| Control | Does | Gesture | Works? | A11y |
|---------|------|---------|--------|------|
| `+` Attach | **Nothing** — no `onPress` | tap squash only | **dead** | `Attach` (lies) |
| Message field | Multiline; web Enter sends, phone newline | type | yes | `Message` |
| Stop (streaming) | `onStop` → cancel | tap | yes | `Stop` |
| Queue/Send (streaming) | Queues if busy | tap | yes | `Queue message` / `Send` |
| Send (idle+text) | `onSend` · `popIn` | tap | yes | `Send` |
| Mic (idle+empty) | `onVoice` → Voice | tap | yes | `Voice input` |

### ConnectionPill — `components/ConnectionPill.tsx`

| Control | Does | Gesture | Works? | A11y |
|---------|------|---------|--------|------|
| Offline/connecting pill | `bridge.retry()`; hidden online/idle | tap · `enterDown` | yes | `role=button`; **no accessibilityLabel** |

### Panes

**BotsPane** — host sections + profile rows (`PressScale`, disabled when offline/not chattable). Empty: “No hosts yet”. Online = 8px dot (not Online pill). A11y: `role=button` + disabled state; no name label.

**ChatsPane** — date groups, 1-line preview, streaming 8px dot, long-press 350ms → confirm delete. Empty: “No chats yet”. **No long-press hint.**

**OrchestraPane** — cards from `DEMO_ORCHESTRAS` (always). Status dot + avatar stack. Empty copy exists but demo data prevents it.

### Chat — `screens/ChatScreen.tsx`

| Control | Does | Gesture | Works? | A11y |
|---------|------|---------|--------|------|
| Message list | `MessageRow` | scroll; interactive IME dismiss | yes | messages not buttons |
| Empty thread | Harness name + host / “Ask anything” | — | display | — |
| Composer | Send / queue / stop / voice | see Composer | yes | — |
| HarnessPicker | Switch harness | modal | **dead open path** — only `debugUi.chatHarnessPickerOpen` | picker rows OK |

### Voice — `screens/VoiceScreen.tsx`

| Control | Does | Gesture | Works? | A11y |
|---------|------|---------|--------|------|
| Orb / halo | Level + phase breath | none — hands-free VAD | display | **no labels**; unused `Pressable` import |
| Caption / heard | Phase/error + last transcript | — | display | none |
| Barge-in | VAD over TTS · `haptic.tap` | speech | yes | no announcement |

### Pair — `screens/PairScreen.tsx`

Computer field, Pair over Tailscale, Listen for pairing sound (6500ms), manual 6-char code, link to Settings. All use **opacity press**, not PressScale. Haptics: success on claim, error on fail. **No field/button accessibilityLabels** except implied text.

### Settings — `screens/SettingsScreen.tsx`

Address / Token / Folder (Field `accessibilityLabel`), Connect/Save (`role=button`), status dot row, harness list with Installed/Not found dots, Pair nearby, Forget bridge. **Opacity press.** KeyboardAvoidingView padding (allowed).

### OrchestraDetailScreen

Agent rows: `openAgent` only navigates if linked chat exists — otherwise **tap + haptic, no-op**. Chat rows work. Status dot on hero. Opacity press. Empty chats copy present.

### ConversationsScreen

Duplicate of Chats list (modal). Long-press delete, New chat. **Dead destination:** registered in `App.tsx`, **zero** `navigate("Conversations")` callers.

### Orphan chrome

| Control | File | Notes |
|---------|------|-------|
| `Header` / `IconButton` | `Header.tsx` | Opacity press; **zero screen imports** |
| `TopTabs` | `TopTabs.tsx` | Labeled text tabs; **unused** (AppNav dots replaced it) |

### MessageRow — `components/MessageRow.tsx`

User bubble · pending “Queued…” · streaming markdown + `PulseDot` + 1-line status · done markdown · interrupted note · inline error. No press handlers.

---

## 2. Every micro-interaction

### Press scale (`motion.ts` + `PressScale.tsx`)

| Token | Value | Use |
|-------|-------|-----|
| `PRESS_SCALE.row` | 0.985 | List rows, Bridge status |
| `PRESS_SCALE.control` | 0.92 | Send, mic, chips, Edit |
| `PRESS_SCALE.nav` | 0.9 | Expand / chevron |
| Spring | `SNAP` + `ReduceMotion.System` | PressScale only |

### Springs / enter-exit

| Motion | Spec | Where |
|--------|------|-------|
| `GEL` | mass 0.4 / stiff 240 / damp 13 | Nav pill, BridgePull, page gel |
| `MOTION_MS` | enter 240 / exit 140 / stagger 36 | Chips, send, pill |
| `popIn` / `popOut` | Zoom spring / 140ms | Composer & search send |
| `staggerUp(i)` | enterUp + i×36ms | Scope chips |
| `LinearTransition.springify(SNAP)` | chip reflow | GlobalSearchBar |
| `enterDown` / `fadeOut` | ConnectionPill | offline only |
| `pillStep` / `pillStretch` | UI-thread gel | AppNav |
| `pageStep` / `PAGE_LAG_PX` | Body lag | MainScreen |
| Sheet `translateY` + rubber | BridgePull | no Modal |
| Orb breath | `withRepeat(withTiming)` 2600 / 900ms | VoiceScreen — **no ReduceMotion** |
| PulseDot | opacity loop 600+600ms | MessageRow — **no ReduceMotion** |

### Haptics (`haptics.ts` — call-site only)

| Kind | Fired on |
|------|----------|
| `tap` | Nav, send/queue path, scope chip, Voice utterance/barge-in, Settings save, Bridge edit/dismiss/retry |
| `select` | Open bot/chat/product, BridgePull settle, harness select |
| `success` | Pair/Settings connect success |
| `error` | Pair fail, send while offline |

**Not on:** dead Attach, list scroll, PulseDot, send control itself (parent fires `tap`, not `success`).

### IME

| Surface | Mechanism |
|---------|-----------|
| Main search + Chat composer | `KeyboardDock` translateY + padding fade (`KeyboardDock.tsx`) |
| Settings | `KeyboardAvoidingView` padding |
| Pair | ScrollView only |
| Voice | none |

---

## 3. Gaps vs well-thought mobile UX

| Gap | Sev | Notes |
|-----|-----|-------|
| Dead Attach `+` | P1 | Squash + a11y “Attach”, no handler |
| Same `+` = Mention on Main, Attach on Chat | P2 | One glyph, two verbs |
| Mixed press languages | P1 | PressScale vs opacity on Pair/Settings/Detail/Conversations/Header |
| Header/TopTabs dead code | P2 | Unused; Header still teaches opacity |
| ReduceMotion ignored on idle loops | P1 | PulseDot + Voice orb |
| Expand label → Voice | P2 | Name ≠ destination |
| HarnessPicker unreachable | P1 | Debug-only open |
| Conversations unreachable | P1 | Stack zombie |
| Long-press delete, no hint | P2 | No `accessibilityHint`, no swipe |
| No swipe-to-delete / pull-to-refresh | P2 | — |
| Agent rows that no-op | P1 | Detail without linked chat |
| Orchestra always demo | P1 | `DEMO_ORCHESTRAS` |
| Search “Online/Offline” text | P2 | vs bots.compression dots |
| ConnectionPill missing label | P3 | — |
| Voice: no mute/end control | P2 | AppNav only escape |
| Send haptic is `tap` not `success` | P3 | — |
| Streaming/live dots not announced | P2 | — |
| Nav tabs skip PressScale | P2 | Third dialect |

---

## 4. How attention is encoded

| Signal | Encoding | Where |
|--------|----------|-------|
| Destination | 4px dots + gold gel pill | AppNav |
| Bridge health | ConnectionPill when broken; BridgePull status | chrome |
| Host/agent presence | 8px green/faint dot | BotsPane, BridgePull, Settings |
| Orchestra status | 8px ok/warn/faint | OrchestraPane / Detail |
| Other live turns | 8px static dot | ChatsPane, Conversations, SearchResultRow |
| This turn thinking | PulseDot + 1-line status | MessageRow |
| Queued / error / interrupt | In-thread copy | MessageRow |
| Voice phase | Caption + orb rate + level | VoiceScreen |
| Search mode | Hint + chips on focus | Main |
| Tokens | `store/text.ts` rAF keyed store | Chat |

Multi-stream: row dots only — no fleet marks on Bots/Orchestra while another thread is open.

---

## 5. Exact source quotes for gaps

Dead Attach (no `onPress`):

```43:51:app/src/components/Composer.tsx
        <PressScale
          scaleTo={PRESS_SCALE.control}
          style={styles.sideIcon}
          accessibilityRole="button"
          accessibilityLabel="Attach"
          hitSlop={8}
        >
          <Ionicons name="add" size={22} color={colors.textMuted} />
        </PressScale>
```

Expand → Voice:

```127:140:app/src/components/AppNav.tsx
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="Expand"
            android_ripple={RIPPLE}
            scaleTo={PRESS_SCALE.nav}
            onPress={() => {
              haptic.tap();
              navigation.navigate("Voice");
            }}
            style={styles.circle}
          >
            <Image source={expandSrc} style={styles.expandIcon} />
            <View pointerEvents="none" style={styles.circleHair} />
          </PressScale>
```

Nav tabs without PressScale:

```149:164:app/src/components/AppNav.tsx
            <View style={styles.tabs}>
              {TAB_LABELS.map((label, i) => (
                <Pressable
                  key={label}
                  accessibilityRole="tab"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: i === active }}
                  android_ripple={RIPPLE}
                  onPress={() => goTab(i)}
                  style={styles.tab}
                >
                  <View
                    pointerEvents="none"
                    style={[styles.dot, i === active ? styles.dotOn : styles.dotOff]}
                  />
                </Pressable>
              ))}
            </View>
```

Header opacity press (unused, still in tree):

```20:28:app/src/components/Header.tsx
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={size} color={colors.text} />
    </Pressable>
```

PulseDot ignores ReduceMotion:

```14:26:app/src/components/PulseDot.tsx
export function PulseDot() {
  const opacity = useSharedValue(0.35);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.35, { duration: 600, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, style]} />;
```

Voice orb ignores ReduceMotion:

```145:151:app/src/screens/VoiceScreen.tsx
  // A slow breath while idle; a faster one while the agent works.
  useEffect(() => {
    cancelAnimation(pulse);
    const duration = phase === "thinking" ? 900 : 2600;
    pulse.value = 0;
    pulse.value = withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [phase, pulse]);
```

HarnessPicker debug-only open:

```48:54:app/src/screens/ChatScreen.tsx
  const debugPicker = debugUi.use((s) => s.chatHarnessPickerOpen);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerVisible = debugPicker ?? pickerOpen;
  const setPickerVisible = useCallback((open: boolean) => {
    setPickerOpen(open);
    if (isDebugActive()) debugUi.set((s) => ({ ...s, chatHarnessPickerOpen: open }));
  }, []);
```

OrchestraDetail agent no-op when unlinked:

```51:55:app/src/screens/OrchestraDetailScreen.tsx
  const openAgent = (harnessId: string) => {
    haptic.select();
    const chat = linkedChats.find((c) => c.harness === harnessId);
    if (chat) openChat(chat.id);
  };
```

Demo orchestra source:

```69:74:app/src/screens/panes/OrchestraPane.tsx
  const projects = useMemo(() => {
    if (conversations.length === 0) return DEMO_ORCHESTRAS;
    return DEMO_ORCHESTRAS.map((p) => ({
      ...p,
      chatIds: conversations.filter((c) => p.agents.includes(c.harness)).map((c) => c.id),
```

Long-press delete without hint:

```42:47:app/src/screens/panes/ChatsPane.tsx
    <PressScale
      onPress={() => onPress(item.id)}
      onLongPress={() => onDelete(item.id)}
      delayLongPress={350}
      style={[styles.row, active && styles.rowActive]}
      accessibilityRole="button"
```

Opacity press on Pair:

```175:175:app/src/screens/PairScreen.tsx
          style={({ pressed }) => [styles.primary, (busy || computer.trim().length === 0) && styles.primaryDisabled, pressed && styles.pressed]}
```

PressScale honors ReduceMotion (contrast):

```11:11:app/src/components/PressScale.tsx
const spring = { ...SNAP, reduceMotion: ReduceMotion.System };
```

Mention `+` on Main (same glyph, live):

```77:86:app/src/components/GlobalSearchBar.tsx
        <PressScale
          onPress={insertMention}
          scaleTo={PRESS_SCALE.control}
          style={styles.sideIcon}
          accessibilityRole="button"
          accessibilityLabel="Mention"
          hitSlop={8}
        >
          <Ionicons name="add" size={22} color={colors.textMuted} />
```

---

## 6. Gesture conflicts

| Conflict | Axes | Resolution today | Risk |
|----------|------|------------------|------|
| MainPager ↔ FlashList | H vs V | Axis split (`gesture.pager-vs-list`) | Low |
| BridgePull ↔ pager | V pan on nav vs H swipe | failOffsetX / activeOffsetY | Medium at chrome |
| BridgePull ↔ list scroll | Both V | Pull on **nav**, not list | Medium if pull from list top |
| Long-press delete ↔ scroll | press vs pan | 350ms delay | Medium |
| Search overlay vs pager | Exclusive swap | `searchActive` unmounts pager | None |
| IME vs dock | translateY | KeyboardDock | None if edge-to-edge provider |
| Voice barge-in vs orb | no touch | VAD only | Cannot tap-to-interrupt |
| Tab Pressable vs pill spring | tap vs shared value | Pill follows progress | Low |
| Pager bounce sentinels | edge pages | MainPager.native remaps | Edge swipe feel |

---

## 7. Decision-tree nodes this inventory required

These splits are now in `decisions.json` `walk` (kind `gap` unless noted). Ticket bodies: `proposedIssues`. Do not invent a fourth option. Walk already had `chrome.destinations`, `composer.attach`, `press.language`, `motion.reduce`. These are the additional splits.

### `chrome.expand-affordance`

- **Q:** What does the left nav circle mean?
- **Adopted:** Label “Expand” → Voice.
- **Target:** Label “Voice” / mic, or true expand.
- **Reject:** Keep Expand→Voice.
- **Wiring:** `AppNav.tsx`, `AppNav.web.tsx`

### `chrome.conversations-route`

- **Q:** Is Conversations first-class or legacy?
- **Adopted:** Stack screen; no navigators.
- **Target:** Remove **or** wire from Chats overflow / BridgePull.
- **Reject:** Zombie modal.
- **Wiring:** `ConversationsScreen.tsx`, `App.tsx`, `navigation.ts`

### `chat.harness-entry`

- **Q:** How to switch harness mid-thread?
- **Adopted:** HarnessPicker mounted; debug-only open.
- **Target:** Title tap or BridgePull chips open picker.
- **Reject:** Hidden modal forever.
- **Wiring:** `ChatScreen.tsx`, `HarnessPicker.tsx`

### `composer.plus-semantics` (sibling of `composer.attach`)

- **Q:** What does leading `+` mean across docks?
- **Adopted:** Main = Mention; Chat = dead Attach.
- **Target:** One glyph→one verb; hide until real.
- **Reject:** Same icon, two verbs.
- **Wiring:** `Composer.tsx`, `GlobalSearchBar.tsx`

### `list.delete-affordance`

- **Q:** How are chats removed?
- **Adopted:** Long-press 350ms → confirm; no hint; no swipe.
- **Target:** Swipe-to-delete **or** overflow; hint if long-press kept.
- **Reject:** Undiscoverable long-press only.
- **Wiring:** `ChatsPane.tsx`, `ConversationsScreen.tsx`

### `list.pull-refresh`

- **Q:** How to refresh hosts/roster?
- **Adopted:** None (pill retry only).
- **Target:** PTR on Bots + existing pill retry.
- **Reject:** Invisible staleness.
- **Wiring:** `BotsPane.tsx`, `ConnectionPill.tsx`

### `orchestra.agent-row`

- **Q:** Agent row with no linked chat?
- **Adopted:** Haptic + no-op.
- **Target:** Disabled + hint, or mint chat (`live.session` adopt).
- **Reject:** Tappable silence.
- **Wiring:** `OrchestraDetailScreen.tsx`

### `voice.chrome` (sibling of `overlay.voice`)

- **Q:** Explicit controls on Voice stage?
- **Adopted:** Orb + caption; leave via AppNav; VAD barge-in.
- **Target:** End/mute/leave + labels; optional tap barge-in.
- **Reject:** Zero controls forever.
- **Wiring:** `VoiceScreen.tsx`, `lib/voice-session.ts`

### `nav.tab-press` (split from `press.language`)

- **Q:** Do tabs use the same squash as nav circles?
- **Adopted:** Circles = PressScale; tabs = Pressable.
- **Target:** PressScale on tabs **or** document tabs as pure hit targets.
- **Reject:** Accidental third dialect.
- **Wiring:** `AppNav.tsx`, `golden-nav.ts`

### `search.status-copy` (split from `bots.compression`)

- **Q:** Search row liveness copy?
- **Adopted:** Meta “Online”/“Offline”.
- **Target:** Dot only (match BotsPane).
- **Reject:** Online chips.
- **Wiring:** `SearchResultRow.tsx`

### `haptic.send-weight` (split from `haptic.pairing`)

- **Q:** Haptic weight for committed send?
- **Adopted:** `haptic.tap()` in Chat/Main.
- **Target:** `success` on first send of a turn; `tap` on queue; `error` offline.
- **Reject:** Silent send.
- **Wiring:** `ChatScreen.tsx`, `MainScreen.tsx`, `haptics.ts`

### `a11y.live-regions`

- **Q:** How are streaming/connection changes announced?
- **Adopted:** Visible text/dots; few labels; no live region.
- **Target:** `accessibilityLiveRegion` on status + ConnectionPill label.
- **Reject:** Motion-only cues.
- **Wiring:** `MessageRow.tsx`, `ConnectionPill.tsx`, `ChatsPane.tsx`

### Walk nodes confirmed

| Node | Verdict |
|------|---------|
| `composer.attach` | Dead-plus; target hide |
| `press.language` | Mixed |
| `motion.reduce` | Ignore on PulseDot + orb |
| `orchestra.source` | Demo |
| `live.session` | Mint-only |
| `attention.multi-stream` | Row-dot-only |
| `connection.pill` | Only-broken; missing label |
| `gesture.pager-vs-list` | Axis-split; BridgePull residual |
| `chrome.destinations` / `height` | Top dots / 60px |
| `composer.send-mic` / `streaming` | Swap + stop/queue |
| `stream.indicator` / `status` | PulseDot + one-line |

---

## Skills cross-check

| Rule | Honored? |
|------|----------|
| Reanimated 4, transform/opacity | Mostly; KeyboardDock also fades `paddingBottom` (IME) |
| PressScale every pressable | **No** |
| No `entering=` on FlashList rows | Yes |
| No GOLD_GLOW on native AppNav | Yes |
| Haptic at call site | Yes |
| ReduceMotion on springs | Yes on PressScale/GEL; **No** on idle loops |
| KeyboardDock for bottom inputs | Yes Main/Chat |
| `offscreenPageLimit={1}` | Yes |

---

## Synergy read

Dash already encodes the right job: phone as control plane over laptop harnesses, one foveal stream, peripheral dots for presence, gel chrome out of the transcript, stop-and-queue so the human keeps encoding while agents work, sonic pair as a short trust ritual. The failure mode is not missing features — it is **lying or silent affordances** (Attach, Expand→Voice, agent rows, HarnessPicker, Conversations) plus **two press languages** and **idle motion that ignores rest**. Fix those and the compression grammar (1-line status, send popIn, ConnectionPill only when broken) is already a strong human–AI mobile loop.
