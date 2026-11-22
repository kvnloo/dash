import { WebView } from "react-native-webview";

/** Explicitly opened HTML has no app message bridge, storage or file access. */
export function HTMLPrototype({ html }: { html: string }) {
  return <WebView
    accessibilityLabel="Interactive prototype"
    source={{ html }}
    originWhitelist={["*"]}
    onShouldStartLoadWithRequest={request => request.url === "about:blank"}
    allowFileAccess={false}
    allowFileAccessFromFileURLs={false}
    allowUniversalAccessFromFileURLs={false}
    setSupportMultipleWindows={false}
    javaScriptCanOpenWindowsAutomatically={false}
    thirdPartyCookiesEnabled={false}
    domStorageEnabled={false}
    mixedContentMode="never"
    incognito
    style={{ flex: 1, backgroundColor: "#0c0c0a" }}
  />;
}
