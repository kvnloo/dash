import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { issuesByNode, kindOf, loadTree, partition } from "./tree";

const ROOT = join(import.meta.dir, "../../..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const LOCKS = [
  "product.job",
  "identity.unit",
  "chrome.destinations",
  "chrome.height",
  "search.placement",
  "search.chips",
  "composer.dock",
  "composer.ime",
  "composer.enter",
  "composer.send-mic",
  "composer.streaming",
  "thread.assistant",
  "thread.user",
  "stream.status",
  "stream.store",
  "list.entering",
  "haptic.pairing",
  "nav.motion",
  "overlay.bridge",
  "overlay.voice",
  "voice.barge-in",
  "history.compression",
  "bots.compression",
  "error.inline",
  "connection.pill",
  "pair.sonic",
  "settings.keyboard",
  "gesture.pager-vs-list",
  "gesture.bridge-vs-list",
] as const;

const FORKS = ["chrome.default-tab", "chrome.compose-entry"] as const;

const CLAIMED = ["stream.indicator", "orchestra.source", "live.session"] as const;

const GAPS = [
  "chrome.expand-affordance",
  "chrome.chat-tab",
  "chrome.conversations-route",
  "chrome.dead-header",
  "search.status-copy",
  "composer.attach",
  "composer.plus-semantics",
  "stream.blocked",
  "press.language",
  "nav.tab-press",
  "haptic.send-weight",
  "voice.chrome",
  "motion.reduce",
  "list.delete-affordance",
  "list.pull-refresh",
  "chat.harness-entry",
  "orchestra.agent-row",
  "a11y.live-regions",
  "attention.multi-stream",
] as const;

describe("Dash UX decision tree", () => {
  const tree = loadTree();
  const parts = partition(tree);
  const byIssue = issuesByNode(tree);

  test("walk order covers every node exactly once", () => {
    expect(tree.walk.length).toBe(tree.nodes.length);
    expect(new Set(tree.walk).size).toBe(tree.walk.length);
    const ids = new Set(tree.nodes.map((n) => n.id));
    for (const id of tree.walk) expect(ids.has(id)).toBe(true);
    for (const node of tree.nodes) expect(tree.walk.includes(node.id)).toBe(true);
  });

  test("axioms are the attention protocol", () => {
    expect(tree.axioms).toEqual([
      "one-foveal-stream",
      "four-working-memory-chunks",
      "encode-not-expose",
      "alert-then-rest",
      "measure-not-vibe",
      "prune-unused-chrome",
    ]);
  });

  test("each node names one adopted option and one target option that exist", () => {
    for (const node of tree.nodes) {
      const ids = node.options.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.includes(node.adopted)).toBe(true);
      expect(ids.includes(node.target)).toBe(true);
      expect(node.options.some((o) => o.verdict === "reject")).toBe(true);
      expect(node.wiring.length).toBeGreaterThan(0);
    }
  });

  test("wiring files exist so the tree is inspectable against source", () => {
    for (const node of tree.nodes) {
      for (const file of node.wiring) {
        expect(existsSync(join(ROOT, file))).toBe(true);
      }
    }
  });

  test("kind partition is an exact set so new nodes cannot hide as vibes", () => {
    expect(parts.lock).toEqual([...LOCKS]);
    expect(parts.fork).toEqual([...FORKS]);
    expect(parts.claimed).toEqual([...CLAIMED]);
    expect(parts.gap).toEqual([...GAPS]);
    expect(tree.walk.length).toBe(LOCKS.length + FORKS.length + CLAIMED.length + GAPS.length);
  });

  test("every gap has a proposedIssue; lock/fork/claimed do not", () => {
    for (const node of tree.nodes) {
      const issues = byIssue.get(node.id) ?? [];
      const kind = kindOf(node);
      if (kind === "gap") {
        expect(issues.length).toBeGreaterThan(0);
      } else {
        expect(issues).toEqual([]);
      }
    }
    expect(tree.proposedIssues.map((i) => i.fromNode).sort()).toEqual([...GAPS].sort());
  });

  test("claimed nodes name GitHub issues and must not be implemented from this catalog", () => {
    const byId = new Map(tree.nodes.map((n) => [n.id, n]));
    expect(byId.get("stream.indicator")?.claimedIssue).toBe("#27");
    expect(byId.get("orchestra.source")?.claimedIssue).toBe("#19");
    expect(byId.get("live.session")?.claimedIssue).toBe("#20");
  });

  test("converged nodes match current source contracts", () => {
    const nav = read("app/src/components/golden-nav.ts");
    expect(nav).toContain("export const NAV_CHROME_HEIGHT = 60");
    expect(nav).toContain("export const NAV_DOT_SIZE = 4");

    const dock = read("app/src/components/KeyboardDock.tsx");
    expect(dock).toContain("translateY: height.value");
    expect(dock).not.toContain("KeyboardAvoidingView");

    const composer = read("app/src/components/Composer.tsx");
    expect(composer).toContain("popIn");
    expect(composer).toContain("onVoice");
    expect(composer).toContain("accessibilityLabel=\"Voice input\"");

    const text = read("app/src/store/text.ts");
    expect(text).toContain("requestAnimationFrame(flush)");

    const chats = read("app/src/screens/panes/ChatsPane.tsx");
    expect(chats).not.toContain("entering=");
    expect(chats).toContain("numberOfLines={1}");

    const motion = read(".cursor/skills/dash-motion/SKILL.md");
    expect(motion).toContain("Never** `entering=` on FlashList rows");

    const pull = read("app/src/components/bridge-pull.ts");
    expect(existsSync(join(ROOT, "app/src/components/BridgePull.tsx"))).toBe(true);
    expect(pull.length).toBeGreaterThan(0);
  });

  test("open gaps are named, not vibes: dead attach, mixed press, idle ReduceMotion", () => {
    const byId = new Map(tree.nodes.map((n) => [n.id, n]));
    expect(byId.get("composer.attach")?.adopted).toBe("dead-plus");
    expect(byId.get("composer.attach")?.target).toBe("hide");

    const composer = read("app/src/components/Composer.tsx");
    const plusBlock = composer.slice(
      composer.indexOf("accessibilityLabel=\"Attach\""),
      composer.indexOf("accessibilityLabel=\"Attach\"") + 280,
    );
    expect(plusBlock).toContain("name=\"add\"");
    expect(plusBlock.includes("onPress")).toBe(false);

    const press = byId.get("press.language");
    expect(press?.adopted).toBe("mixed");
    expect(press?.target).toBe("press-scale");
    const header = read("app/src/components/Header.tsx");
    expect(header).toContain("pressed && styles.pressed");
    expect(header).not.toContain("PressScale");
    const pair = read("app/src/screens/PairScreen.tsx");
    expect(pair).toContain("pressed && styles.pressed");

    const reduce = byId.get("motion.reduce");
    expect(reduce?.adopted).toBe("ignore");
    expect(reduce?.target).toBe("honor");
    const pulse = read("app/src/components/PulseDot.tsx");
    expect(pulse).toContain("withRepeat");
    expect(pulse).not.toContain("ReduceMotion");
  });

  test("default tab stays Chats until language.md changes, even if #29 is claimed", () => {
    const node = tree.nodes.find((n) => n.id === "chrome.default-tab");
    expect(node?.adopted).toBe("chats");
    expect(node?.target).toBe("chats");
    expect(kindOf(node!)).toBe("fork");
    expect(read("docs/design/language.md")).toContain("Default tab: **Chats**");
    expect(read("app/src/screens/MainScreen.tsx")).toContain("useState(1)");
  });

  test("compose-entry fork: language.md says pencil, Main ships the dock", () => {
    const node = tree.nodes.find((n) => n.id === "chrome.compose-entry");
    expect(node?.adopted).toBe("dock");
    expect(node?.target).toBe("dock");
    expect(kindOf(node!)).toBe("fork");
    expect(read("docs/design/language.md")).toContain("header** (pencil)");
    expect(read("app/src/screens/MainScreen.tsx")).toContain("placeholder=\"Message Dash\"");
  });

  test("lying and silent affordances are pinned to source", () => {
    const nav = read("app/src/components/AppNav.tsx");
    expect(nav).toContain("accessibilityLabel=\"Expand\"");
    expect(nav).toContain("navigate(\"Voice\")");
    expect(nav).toContain("<Pressable");

    const chat = read("app/src/screens/ChatScreen.tsx");
    expect(chat).toContain("tab={1}");
    expect(chat).toContain("chatHarnessPickerOpen");
    expect(chat).not.toContain("setPickerVisible(true)");

    const voice = read("app/src/screens/VoiceScreen.tsx");
    expect(voice).toContain("tab={1}");
    expect(voice).toContain("withRepeat(withTiming");
    expect(voice).not.toContain("ReduceMotion");

    const app = read("app/App.tsx");
    expect(app).toContain("name=\"Conversations\"");
    expect(read("app/src/screens/MainScreen.tsx")).not.toContain("navigate(\"Conversations\")");
    expect(read("app/src/components/BridgePull.tsx")).not.toContain("navigate(\"Conversations\")");

    const search = read("app/src/components/GlobalSearchBar.tsx");
    expect(search).toContain("accessibilityLabel=\"Mention\"");
    expect(search).toContain("name=\"add\"");

    const searchRow = read("app/src/components/SearchResultRow.tsx");
    expect(searchRow).toContain("\"Online\"");
    expect(searchRow).toContain("\"Offline\"");

    const chats = read("app/src/screens/panes/ChatsPane.tsx");
    expect(chats).toContain("delayLongPress={350}");
    expect(chats).not.toContain("accessibilityHint");

    const bots = read("app/src/screens/panes/BotsPane.tsx");
    expect(bots).not.toContain("RefreshControl");

    const detail = read("app/src/screens/OrchestraDetailScreen.tsx");
    expect(detail).toContain("if (chat) openChat(chat.id)");

    const pill = read("app/src/components/ConnectionPill.tsx");
    expect(pill).not.toContain("accessibilityLabel");
    expect(pill).toContain("accessibilityRole=\"button\"");

    const send = read("app/src/screens/ChatScreen.tsx");
    expect(send).toContain("haptic.tap()");
    expect(send).not.toContain("haptic.success()");

    const headerImport = read("app/src/screens/ChatScreen.tsx");
    expect(headerImport).not.toContain("components/Header");
    expect(read("app/src/screens/MainScreen.tsx")).not.toContain("TopTabs");
  });
});
