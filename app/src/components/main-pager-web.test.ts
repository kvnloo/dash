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
      useImperativeHandle: (ref, create) => Object.assign(ref, create()),
    }));
    mock.module("react-native", () => ({ View: "div" }));
    const { MainPager } = await import("./MainPager.web.tsx");
    const selected = [];
    const ref = {};
    const view = MainPager({ page: 2, children: ["bots", "chats", "orchestra"],
      onPageSelected: event => selected.push(event.nativeEvent.position) }, ref);
    ref.setPage(1);
    ref.setPage(0);
    console.log(JSON.stringify({ selected, visible: view.props.children }));
  `;
  const child = Bun.spawn([process.execPath, "-e", code], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  expect(JSON.parse(stdout)).toEqual({ selected: [1, 0], visible: "orchestra" });
});
