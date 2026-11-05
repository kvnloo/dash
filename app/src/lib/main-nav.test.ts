import { describe, expect, test } from "bun:test";
import { CommonActions, StackActions, StackRouter, type StackNavigationState } from "@react-navigation/routers";
import { toMain } from "./main-nav";

type Params = Record<string, object | undefined>;
const router = StackRouter({});
const options = { routeNames: ["Main", "Chat", "Settings"], routeParamList: {} as Params, routeGetIdList: {} };

function stack(): StackNavigationState<Params> {
  let state = router.getInitialState(options);
  state = router.getStateForAction(state, StackActions.push("Chat"), options) as StackNavigationState<Params>;
  return state;
}

/** Drive the real StackRouter with whatever action toMain dispatches. */
function back(state: StackNavigationState<Params>, tab?: number): StackNavigationState<Params> {
  let next = state;
  toMain({ dispatch: (action) => { next = router.getStateForAction(next, action, options) as StackNavigationState<Params>; } }, tab);
  return next;
}

describe("toMain", () => {
  test("returns to the existing Main instead of stacking a second one", () => {
    const before = stack();
    const mainKey = before.routes[0]!.key;
    const after = back(before);
    expect(after.routes.map(r => r.name)).toEqual(["Main"]);
    expect(after.routes[0]!.key).toBe(mainKey);
  });

  test("plain back keeps the tab the user left from (no tab param)", () => {
    expect(back(stack()).routes[0]!.params).toBeUndefined();
  });

  test("a nav tab tap asks Main for that tab", () => {
    expect(back(stack(), 0).routes[0]!.params).toEqual({ tab: 0 });
  });

  test("navigate(\"Main\") is the bug: it pushes a second Main", () => {
    const pushed = router.getStateForAction(stack(), CommonActions.navigate("Main", { tab: 1 }), options) as StackNavigationState<Params>;
    expect(pushed.routes.map(r => r.name)).toEqual(["Main", "Chat", "Main"]);
  });

  test("repeated open/back cycles never grow the stack", () => {
    let state = stack();
    for (let i = 0; i < 5; i++) {
      state = back(state);
      state = router.getStateForAction(state, StackActions.push("Chat"), options) as StackNavigationState<Params>;
    }
    expect(back(state).routes).toHaveLength(1);
  });
});
