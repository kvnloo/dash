import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { PageControlsFocusProvider, usePageControls, usePageRows, type SettingRow } from "../lib/settings-registry";
import { orchestraControlRows, useOrchestraController } from "../lib/orchestra-controls";
import type { OrchestraMap } from "../lib/orchestra-map";

const graph: OrchestraMap = { nodes: [
  { id: "host", hostId: "host", label: "Fixture host", kind: "host", state: "idle", thinking: { phase: "idle" } },
  { id: "chat", hostId: "host", label: "Fixture chat", kind: "chat", state: "live", thinking: { phase: "thinking" } },
], edges: [{ id: "hosted", from: "host", to: "chat", relation: "hosted", active: false }] };

function MountedPane({ page, version, onDispatch }: { page: string; version: number; onDispatch(value: string): void }) {
  usePageControls(page, [{ id: `${page}-action`, label: `${page} callback`, kind: "action", home: "composer", values: [], index: 0, select: () => onDispatch(`${page}:${version}`), run: () => onDispatch(`${page}:${version}`) }]);
  return <span data-testid={`mounted-${page}`}>{page} mounted</span>;
}
function OrchestraFixture() {
  const controller = useOrchestraController(graph);
  const state = controller.state.use(s => s);
  usePageControls("orchestra", orchestraControlRows(controller, graph));
  return <pre data-testid="orchestra-state">{JSON.stringify(state)}</pre>;
}
function Row({ row }: { row: SettingRow }) {
  return <div className="row" data-testid={row.id}>
    <label>{row.label}{row.kind === "action" ? <button onClick={() => row.run?.()}>Run</button> :
      <select aria-label={row.label} value={row.index} onChange={event => row.select(Number(event.target.value))}>
        {row.values.map((value, index) => <option key={index} value={index}>{value}</option>)}
      </select>}</label>
  </div>;
}
function Host({ screen }: { screen: string }) {
  const rows = usePageRows(screen);
  return <section aria-label="Registry rows" data-testid="registry-rows">
    {rows.length ? rows.map(row => <Row key={row.id} row={row} />) : <p>No page controls</p>}
  </section>;
}
function Fixture() {
  const [activeMainPage, setPage] = useState("chats");
  const [routeFocused, setFocused] = useState(true);
  const [version, setVersion] = useState(0);
  const [dispatch, setDispatch] = useState("none");
  return <PageControlsFocusProvider value={{ routeFocused, activeMainPage }}>
    <h1>Page-control registry fixture</h1>
    <p>Fixture only — not the app menu, navigation integration, or device acceptance.</p>
    <nav>{["bots", "chats", "orchestra"].map(page => <button key={page} aria-pressed={page === activeMainPage} onClick={() => setPage(page)}>{page}</button>)}</nav>
    <button onClick={() => setFocused(!routeFocused)}>{routeFocused ? "Blur route" : "Refocus route"}</button>
    <button onClick={() => setVersion(version + 1)}>Fresh callback</button>
    <p data-testid="focus-state">{routeFocused ? "focused" : "blurred"} · {activeMainPage} · callback {version}</p>
    <div className="mounted"><MountedPane page="bots" version={version} onDispatch={setDispatch} /><MountedPane page="chats" version={version} onDispatch={setDispatch} /><span data-testid="mounted-orchestra">orchestra mounted</span></div>
    <OrchestraFixture />
    <p data-testid="dispatch">{dispatch}</p>
    <Host screen={activeMainPage} />
  </PageControlsFocusProvider>;
}
const root = document.getElementById("root");
if (!root) throw new Error("Registry fixture requires #root");
createRoot(root).render(<StrictMode><Fixture /></StrictMode>);
