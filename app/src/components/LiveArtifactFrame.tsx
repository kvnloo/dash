import { WebView } from "react-native-webview";
import type { LiveIntent } from "../../../shared/live";

interface Props {
  html: string;
  version: number;
  height: number;
  onIntent: (intent: LiveIntent) => void;
  onPainted?: () => void;
  staticOnly?: boolean;
}

// In a WebView the document is the top window, so fx0's parent.postMessage lands on itself.
// Forward only fx-intent messages to the native side; nothing else leaves the page.
const FORWARD = `window.addEventListener("message",function(e){var d=e.data;if(d&&d.type==="fx-intent"&&window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify(d))}});true;`;

/** Native: the fx0 document in a WebView with no navigation, no file access and no third-party cookies. */
export function LiveArtifactFrame({ html, version, height, onIntent, onPainted, staticOnly = false }: Props) {
  return (
    <WebView
      key={version}
      source={{ html }}
      originWhitelist={["about:blank"]}
      style={{ height, borderRadius: 14, backgroundColor: "#0c0c0a" }}
      injectedJavaScriptBeforeContentLoaded={FORWARD}
      javaScriptEnabled={!staticOnly}
      allowFileAccess={false}
      thirdPartyCookiesEnabled={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(request) => request.url === "about:blank" || (!staticOnly && request.url.startsWith("data:"))}
      onLoadEnd={onPainted}
      onMessage={(event) => {
        if (staticOnly) return;
        try {
          const data = JSON.parse(event.nativeEvent.data) as { controlId?: unknown; value?: unknown; label?: unknown };
          if (typeof data.controlId !== "string") return;
          const value = typeof data.value === "string" || typeof data.value === "number" || typeof data.value === "boolean" ? data.value : String(data.value ?? "");
          onIntent({ controlId: data.controlId.slice(0, 64), value, ...(typeof data.label === "string" ? { label: data.label.trim().slice(0, 120) } : {}), artifactVersion: version, surface: "dash-live-surface" });
        } catch { /* not ours */ }
      }}
    />
  );
}
