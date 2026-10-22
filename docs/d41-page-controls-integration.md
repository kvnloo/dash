# D41 page-control prerequisite

This branch supplies the qualified density-dial registry and Orchestra's actual controller. It does **not** install a menu, alter navigation, add gestures, or claim app/device integration. MainScreen, FilterMenu, App, ChatScreen, Composer, and ChatWindow are untouched. The parent owns applying the host hunks below alongside its menu integration.

## Host-consumption API

`PageControlsFocusProvider` takes `{ routeFocused: boolean, activeMainPage: string | null }`. Supply the real navigation route focus and Main's selected pager page, not pane mount state. Without an adapter the default is unfocused and registrations are inert. The three panes can stay mounted.

`usePageControls(screen, rows)` registers the existing `SettingRow` shape only when **routeFocused AND activeMainPage === screen**. Its layout-effect lifecycle removes registration on blur before paint; refocus registers once, including in StrictMode. Callback-only renders update dispatch targets without re-registering or duplicating rows. The callbacks reflect the latest committed render, not an abandoned render. Old row handles become inert after blur, replacement, or metadata replacement.

**The one menu-host API is `usePageRows(screen)`** inside the same provider. It returns a stable empty array when off-page/blurred, even before a pane's registration cleanup commits. Pass it to the preserved `rowsFor(home, globalRows, pageRows)`. Do not consume `pageControls.use(s => s[screen])` directly in the host: that omits the host-side focus gate. `pageRowsFor` is the corresponding pure selector used by behavioral tests. `registerPage(screen, rows) -> cleanup` remains available and ownership-token cleanup protects replacements even when both owners reuse the identical array. Low-level registration alone does not infer focus; page code should use the hook.

`OrchestraPane` owns one `OrchestraController`, passes it into `OrchestraGraph`, subscribes to its state, and registers `orchestraControlRows(controller, graph)`. Both native graph actions and menu rows call this controller. Graph-only consumers without a supplied controller get exactly one graph-owned controller. `switchView` clears selection, filter, and focus scope even on reselect, marks the view chosen, and restarts the transition; automatic evidence defaults apply only until a view is explicitly chosen. Reset clears selection/filter/scope but keeps the chosen view. Legend tap toggles highlight; legend hold selects only and exits focus-only scope. Closing node details clears selection but not filter/scope. Host focus selects the host and enables focus-only. No old geometry modes are restored.

Stable row IDs preserved from WIP: `orchestra-view`, `orchestra-focus` (Scope), `orchestra-filter` (Highlight), `orchestra-reset`. Additional actual actions: `orchestra-selection` selects/clears node details, and `orchestra-filter-scope` exposes Highlight/Only while a filter is selected.

## Exact MainScreen focus-adapter diff (native-turbo e29dd36)

This hunk does not create the menu. Apply it in the parent's integration candidate; it wraps both the mounted pager panes and the future bottom-menu host in one focus boundary.

```diff
--- a/app/src/screens/MainScreen.tsx
+++ b/app/src/screens/MainScreen.tsx
@@
 import { useSafeAreaInsets } from "react-native-safe-area-context";
+import { useIsFocused } from "@react-navigation/native";
+import { PageControlsFocusProvider } from "../lib/settings-registry";
@@
   const index = debugTab !== null ? debugTab : localTab;
+  const routeFocused = useIsFocused();
+  const controlsFocus = useMemo(() => ({
+    routeFocused,
+    activeMainPage: ["bots", "chats", "orchestra"][index] ?? null,
+  }), [routeFocused, index]);
@@
   return (
+    <PageControlsFocusProvider value={controlsFocus}>
     <View style={[styles.screen, { paddingTop: insets.top }]}><Canvas />
@@
       </KeyboardDock>
     </View>
+    </PageControlsFocusProvider>
   );
```

No page prop or navigation hook is needed in OrchestraPane. A route blur keeps the provider mounted with `routeFocused: false`; pager changes update `activeMainPage`. If the parent's final host lives outside this subtree, move the provider to the lowest common ancestor of that host and the panes, preserving these explicit input values. A host for a different route must get its own route/page adapter, never reuse Main's retained page selection as route-focus evidence.

## Exact preserved WIP FilterMenu host diff

`FilterMenu.tsx` is absent on e29dd36 and remains parent-owned. Apply this diff to the preserved density-dial WIP host when the parent brings that host into its integration candidate. It changes only page-row consumption; the existing global rows, menu, geometry and gesture mechanism are retained.

```diff
--- a/app/src/components/FilterMenu.tsx
+++ b/app/src/components/FilterMenu.tsx
@@
-import { pageControls, rowsFor, tapIndex, type SettingRow } from "../lib/settings-registry";
+import { usePageRows, rowsFor, tapIndex, type SettingRow } from "../lib/settings-registry";
@@
 export function FilterMenuHost({ screen, children }: { screen: string; children: ReactNode }) {
   const global = useGlobalRows();
-  const page = pageControls.use(s => s[screen]);
+  const page = usePageRows(screen);
   const rows = useMemo(() => rowsFor("composer", global, page ?? []), [global, page]);
```

The parent's existing bottom-host integration must pass the matching selected page as `screen` (`["bots", "chats", "orchestra"][index] ?? "chats"`) and place that host inside the provider above. This branch deliberately supplies no invented MainScreen/Composer menu-slot diff: that host/slot is absent from the assigned base and belongs to the parent's menu work. This is the narrow integration prerequisite, not an instruction to edit those protected files here.

## Reproducible qualification

RED receipt: MBP job `20261022-170657-c906`, source `9a482d3ea79223ea0112c92d0fe506dec71fb7a5`: the copied WIP failed the same-array replacement cleanup regression (1 fail, 1 pass).

Run the committed source on MBP via fleet-build, install frozen dependencies in root/app/bridge as needed, then run app typecheck, `bun test app/src bridge/src shared`, and:

```sh
D41_SOURCE_SHA=<exact-committed-source-SHA> bun scripts/page-controls-proof.mjs
```

The proof uses an isolated registry-only React fixture, React StrictMode, a private headless Sway/pixman display and an owned browser profile. It never starts Dash, Metro, a device session or a live bridge. It exercises all mounted panes, active-page changes, route blur/refocus, callback freshness, and real Orchestra row actions/reset. Fetch `dist/d41/` for screenshots, bundled fixture, `results.json` (exact SHA and checks) and private Sway log. Unit tests additionally cover stale cleanup, stale row handles, metadata changes, filter projection, automatic default view and same-view switch reset. These receipts prove the prerequisite, not the parent-host integration or a phone.
