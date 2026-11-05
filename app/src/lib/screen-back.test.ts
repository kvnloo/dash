import { expect, test } from "bun:test";
import { screenBack } from "./screen-back";
import { createStageLinkRouter } from "./stage-router";

test("screen Back returns to its caller and cold routes have a Main fallback", () => {
  const actions: string[] = [];
  const nav = { canGoBack: () => true, goBack: () => { actions.push("back"); }, dispatch: () => { actions.push("main"); } };
  screenBack(nav);
  screenBack({ ...nav, canGoBack: () => false });
  expect(actions).toEqual(["back", "main"]);
});
test("Expo stage link is retained across cold fonts/hydration and flushed once", () => {
  let ready = false;
  const opened: string[] = [];
  const router = createStageLinkRouter({ isReady: () => ready, openStage: url => { opened.push(url); } });
  const stage = "http://127.0.0.1:41873/#t=0123456789abcdef";
  expect(router.handle(`exp://100.100.100.100:8097/--/stage?url=${encodeURIComponent(stage)}`)).toBe(true);
  router.flush();
  expect(opened).toEqual([]);
  ready = true;
  router.flush(); router.flush();
  expect(opened).toEqual([stage]);
  expect(router.handle("dash://stage?url=javascript:alert(1)")).toBe(false);
});
