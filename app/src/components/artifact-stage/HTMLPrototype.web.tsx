/** Opaque origin, no top navigation, popups, forms or app message bridge. */
export function HTMLPrototype({ html }: { html: string }) {
  return <iframe
    title="Interactive prototype"
    sandbox="allow-scripts"
    referrerPolicy="no-referrer"
    srcDoc={html}
    style={{ flex: 1, width: "100%", border: 0 }}
  />;
}
