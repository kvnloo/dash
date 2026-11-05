"use dom";

/**
 * Expo DOM component (works in Expo Go): hosts the artifact-stage web canvas.
 * On native it runs inside a WebView that Expo manages; on web it is plain DOM.
 * The stage itself (three.js viewport, refinement, notes) is served by the
 * host: kvnloo/artifact-stage. This component only frames it. Absolute, not
 * fixed: on web the DOM component renders inline and must stay inside its View.
 */
import type { DOMProps } from "expo/dom";

export default function ArtifactStageDom({ url, title }: { url: string; title?: string; dom?: DOMProps }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#1e2030" }}>
      <iframe
        title={title ?? "artifact-stage"}
        src={url}
        allow="microphone; fullscreen; xr-spatial-tracking"
        style={{ border: 0, width: "100%", height: "100%", display: "block", background: "#1e2030" }}
      />
    </div>
  );
}
