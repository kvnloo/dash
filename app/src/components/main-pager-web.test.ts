import { expect, test } from "bun:test";

// Isolate the React Native platform boundary so hook/module substitutes cannot
// leak into the rest of the suite. Exercise the actual web pager's public ref.
test("web pager tab requests notify the controlled parent like native selection", async () => {
  const code = `
    import { mock } from "bun:test";
    const react = await import("react");
    mock.module("react", () => ({
      ...react,
      Children: { toArray: children => children },
      forwardRef: render => render,
      useEffect: () => {},
      useRef: value => ({current:value}),
      useState: value => [typeof value === "function" ? value() : value, () => {}],
      useImperativeHandle: (ref, create) => Object.assign(ref, create()),
    }));
    mock.module("react-native", () => ({ View: "div" }));
    mock.module("react-native-reanimated", () => ({
      default: {View:"div"}, ReduceMotion:{System:0}, cancelAnimation:()=>{},
      runOnJS:fn=>fn, useAnimatedStyle:fn=>fn(), useReducedMotion:()=>false,
      useSharedValue:value=>({value}), withTiming:(value, config, callback)=>{callback?.(true);return value},
    }));
    const gesture = new Proxy({}, {get:()=>()=>gesture});
    mock.module("react-native-gesture-handler", () => ({GestureDetector:"div", Gesture:{Pan:()=>gesture}}));
    const { MainPager } = await import("./MainPager.web.tsx");
    const selected = [];
    const ref = {};
    const view = MainPager({ page: 2, children: ["bots", "chats", "orchestra"],
      onPageSelected: event => selected.push(event.nativeEvent.position) }, ref);
    ref.setPage(1);
    ref.setPage(0);
    console.log(JSON.stringify({ selected, visible: view.props.children.props.children.props.testID }));
  `;
  const child = Bun.spawn([process.execPath, "-e", code], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  expect(JSON.parse(stdout)).toEqual({ selected: [1, 0], visible: "main-pager" });
});
