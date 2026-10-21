import { createElement, useEffect, useRef } from "react";
import type { LiveIntent } from "../../../shared/live";

interface Props {
  html: string;
  version: number;
  height: number;
  onIntent: (intent: LiveIntent) => void;
  onPainted?: () => void;
  staticOnly?: boolean;
}

/**
 * Web: the fx0 document in a no-same-origin sandboxed iframe (scripts only), already wrapped in
 * fx0's embedded CSP by z0bridge. Its one channel out is postMessage({type:"fx-intent"}), and only
 * messages from this frame's own window are accepted.
 */
export function LiveArtifactFrame({ html, version, height, onIntent, onPainted, staticOnly = false }: Props) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (staticOnly || !ref.current || event.source !== ref.current.contentWindow) return;
      const data = event.data as { type?: unknown; controlId?: unknown; value?: unknown; label?: unknown };
      if (data?.type !== "fx-intent" || typeof data.controlId !== "string") return;
      const value = typeof data.value === "string" || typeof data.value === "number" || typeof data.value === "boolean" ? data.value : String(data.value ?? "");
      onIntent({ controlId: data.controlId.slice(0, 64), value, ...(typeof data.label === "string" ? { label: data.label.trim().slice(0, 120) } : {}), artifactVersion: version, surface: "dash-live-surface" });
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [onIntent, version, staticOnly]);
  return createElement("iframe", {
    ref,
    key: version,
    title: staticOnly ? "HTML preview" : `fx0 design v${version}`,
    sandbox: staticOnly ? "" : "allow-scripts",
    srcDoc: html,
    onLoad: onPainted,
    style: { width: "100%", height, border: "0", borderRadius: 14, background: "#0c0c0a", display: "block" },
  });
}
