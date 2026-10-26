// Host-executed native component fixture, not device timing evidence.
import { renderToStaticMarkup } from "react-dom/server";
import { GenerativeBlock } from "./GenerativeBlock";
const render = (code: string, language: string, streaming = false) => renderToStaticMarkup(<GenerativeBlock code={code} language={language} streaming={streaming} />);
console.log(JSON.stringify({
  ready: render('root = Roadmap("dash-roadmap")', "openui-lang"),
  partial: render('root = Roadmap("dash-', "openui-lang", true),
  invalid: render("SENTINEL_RAW_SOURCE", "openui-lang"),
  oversizedHtml: render("SENTINEL_RAW_SOURCE".repeat(12000), "html"),
  ordinary: render("const count = 1", "ts"),
  html: render("<p>safe</p>", "html"),
  pendingHtml: render('{"__dash_pending_generated_ui__":true}', "html"),
  streamingHtml: render("<p>partial", "html", true),
  widgets: render('{"version":1,"components":[{"type":"card","title":"WIDGET_MARKER","text":"body"}]}', "genui"),
  openui: render('{"version":1,"components":[{"type":"card","title":"OPENUI_MARKER","text":"body"}]}', "openui"),
  invalidWidgets: render("SENTINEL_RAW_SOURCE", "genui"),
  mermaid: render("flowchart LR\nA-->B", "mermaid"),
}));
