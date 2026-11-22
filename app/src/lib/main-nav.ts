import { StackActions, type StackActionType } from "@react-navigation/routers";

/** Anything that can dispatch a navigation action (screen or nav-bar navigation prop). */
export type MainReturn = { dispatch: (action: StackActionType) => void };

/**
 * Return to the one Main screen already in the stack. React Navigation 7's
 * `navigate("Main")` pushes a second Main instead, which remounts the pager on its
 * default tab (Orchestra) and slides a fresh nav bar in. `popTo` pops back to the
 * existing Main and keeps the tab the user left from unless a tab is asked for.
 */
export function toMain(navigation: MainReturn, tab?: number): void {
  navigation.dispatch(StackActions.popTo("Main", tab === undefined ? undefined : { tab }));
}

/** Return to Main showing the dogfood home (the self-development loop). */
export function toDogfood(navigation: MainReturn): void {
  navigation.dispatch(StackActions.popTo("Main", { home: true }));
}
