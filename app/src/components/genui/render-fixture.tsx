// Build this fixture with the react-native -> react-native-web alias, then execute under Bun.
import { renderToStaticMarkup } from "react-dom/server";
import { GenUI } from "./GenUI";
import { parseGenUI } from "../../lib/genui";
const widgets = parseGenUI(JSON.stringify({ version: 1, components: [
  { type: "card", title: "Card title", text: "<script>not executable</script>", children: [{ type: "stat", title: "Count", value: 7 }] },
  { type: "table", title: "Table", columns: ["Key", "Value"], rows: [["A", "B"]] },
  { type: "progress", title: "Progress", value: 45 },
  { type: "choices", id: "pick", title: "Choice", items: [{ id: "yes", label: "Choose yes" }] },
  { type: "buttons", id: "go", title: "Buttons", items: [{ id: "next", label: "Next" }] },
  { type: "checklist", id: "tasks", title: "Checklist", items: [{ id: "done", label: "Reviewed", checked: true }] },
  { type: "timeline", title: "Timeline", items: [{ id: "start", label: "Started", detail: "Today" }] },
] }));
if (!widgets) throw new Error("Fixture rejected");
console.log(JSON.stringify({ enabled: renderToStaticMarkup(<GenUI widgets={widgets} onIntent={() => true} />), disabled: renderToStaticMarkup(<GenUI widgets={widgets} />) }));
