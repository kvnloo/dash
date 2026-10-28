# Shared file tree

`Tree` uses `@headless-tree/core` / `@headless-tree/react` 1.8.0 for visible-item state and FlashList 2.0.2 for recycling. Only the synchronous state feature is enabled. Do not spread `item.getProps()` / `tree.getContainerProps()` onto React Native views or enable the DOM hotkey/DnD features. Dash owns the native accessibility, rows and gestures; TreeKeyboard.web supplies browser arrow/Home/End behavior.

## Nodes

Import `Tree` from `app/src/components/Tree` and `TreeNode` from `app/src/lib/tree`. Supply stable, globally unique IDs. `children` accepts an array or a lazy function returning an array/promise. Opening a node requests its children once per nodes snapshot. A new immutable nodes snapshot invalidates the cache while preserving expanded IDs. Async failures render an explicit retry row. Collapsing a parent preserves descendant expansion for reopening.

Rows without `onPress` expand/collapse. Rows with `onPress` activate; if they also have children, the separate 44px trailing disclosure expands without activating (session -> repository). Long-press calls `onLongPress`; a horizontal left swipe collapses the current branch or parent. Native screen-reader expand/collapse actions are supplied. Session orbs derive from actual conversation state, not the existence of a running harness process.

Default mode fills its parent with a virtualized FlashList. Use `inline` only for small bounded trees inside an existing chat scroll owner, to avoid nested virtualized scroll views. Large standalone reply inspectors should use the default virtualized mode. Reduced motion is delegated to Reanimated's System setting on chevrons, entering/exiting and layout transitions. Native layout transitions run on FlashList's positioned cell (not the inner row). Web uses row fades and spring chevrons without the additional positioned-cell layout transition, which otherwise double-translates RN Web cells. The Bots pager child must keep `flex: 1`; without a constrained viewport FlashList will mount the entire tree.

## Thinking and tool calls

Chat replies do not render their thinking and tool calls through `Tree`. `ReplyBlocks` draws one quiet row per block with dense `CompactToolRow` lines under the tool header; see `docs/tool-activity.md`. The earlier `toolTree` adapter, which nested Turn details > Tool calls > calls in an inline `Tree`, was removed with that UI.

## Bots

BotsPane renders the roster as host -> deployed bots / harness groups -> sessions -> cwd. Bot sessions are matched to their profile; remaining sessions belong to their harness group, not a duplicated bot. Only reported bots are counted; absent bot inventories are not converted to fictitious counts. The OS hostname is the display label, while the MagicDNS ID remains unchanged for routing (e.g. id `0`, label `host-b`). Hosts without children still disclose an explicit offline/empty note. Offline hosts and their children are dimmed.

Sessions open via the existing `profileFromAgent` / `openAgentConversation` path. An installed harness with no persisted session offers New chat. Hosts/bots expose their information and existing feedback action on long-press. Opening hosts/bots never navigates away.
