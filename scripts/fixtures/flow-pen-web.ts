import { attachClosedPenLoop } from "../../app/src/lib/annotate/io-core";
import { attachInkPersistence } from "../../app/src/lib/annotate/ink-persistence";
import { EMPTY_DRAWING, addStroke } from "../../app/src/lib/annotate/strokes";
import { createStore } from "../../app/src/store/createStore";
import { createFlowTrace } from "../../app/src/lib/flow-trace";
import type { ComposerDraft } from "../../app/src/store/composer-drafts";

const button = document.createElement("button");
button.textContent = "Close stylus loop";
document.body.append(button);
const chip = document.createElement("output");
chip.setAttribute("aria-label", "Circled screenshot");
document.body.append(chip);
const trace = createFlowTrace(true);
const store = createStore({ drawing: EMPTY_DRAWING, active: true });
const persistence = attachInkPersistence(store, {
  read: async () => localStorage.getItem("ink"),
  write: async raw => { localStorage.setItem("ink", raw); },
  onBackground: flush => { window.addEventListener("pagehide", flush); return () => window.removeEventListener("pagehide", flush); },
});
let draft: ComposerDraft = { text: "Existing typed question", attachments: [] };
button.onclick = async () => {
  await persistence.restored;
  const id = trace.begin();
  trace.mark("ink.up", id);
  const drawing = addStroke(store.get().drawing, {
    tool: "circle", color: "accent", pointer: "stylus",
    points: [{ x: 0.25, y: 0.25, p: 0.5, t: Date.now() }, { x: 0.75, y: 0.75, p: 0.5, t: Date.now() }],
  });
  store.set(state => ({ ...state, drawing }));
  const stroke = drawing.strokes.at(-1);
  if (!stroke) throw new Error("Committed stroke missing");
  const canvas = document.createElement("canvas");
  canvas.width = 400; canvas.height = 800;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.fillStyle = "black"; context.fillRect(0, 0, 400, 800);
  context.strokeStyle = "red"; context.strokeRect(100, 200, 200, 400);
  const png = new Uint8Array(await (await fetch(canvas.toDataURL())).arrayBuffer());
  const result = attachClosedPenLoop({
    stroke, screen: { id: "web", route: "Chat", width: 400, height: 800 }, createdAt: Date.now(), markedPng: png,
    updateDraft(change) {
      draft = change(draft);
      chip.textContent = draft.attachments[0]?.state ?? "";
      if (chip.textContent === "uploading") requestAnimationFrame(() => requestAnimationFrame(() => trace.mark("chip.paint", id)));
    },
    crop: async bytes => ({ bytes, dataUri: canvas.toDataURL() }),
    uploadPng: async (name, bytes) => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return { id: "0123456789abcdef0123456789abcdef", name, mime: "image/png", size: bytes.byteLength };
    },
  });
  await result;
  store.set(state => ({ ...state, active: false }));
  window.dispatchEvent(new Event("pagehide"));
  await persistence.flush();
  const restored = JSON.parse(localStorage.getItem("ink") ?? "null");
  Reflect.set(window, "flowResult", { trace: trace.dump(), draft, restored, active: store.get().active });
};
