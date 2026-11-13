/**
 * Smallest DOM that react-dom/client needs to mount, update and unmount plain
 * <div>/<span>/<button> trees in Bun. Lets lifecycle tests run real effects and
 * cleanups (react-dom/server never does) without adding a DOM package.
 */
type Listener = (event: unknown) => void;

class MiniNode {
  childNodes: MiniNode[] = [];
  parentNode: MiniNode | null = null;
  ownerDocument: MiniDocument | null = null;
  nodeValue: string | null = null;
  constructor(public nodeType: number, public nodeName: string) {}
  get firstChild(): MiniNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): MiniNode | null { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling(): MiniNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  appendChild(child: MiniNode) { child.parentNode?.removeChild(child); child.parentNode = this; this.childNodes.push(child); return child; }
  insertBefore(child: MiniNode, before: MiniNode | null) {
    if (!before) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    return child;
  }
  removeChild(child: MiniNode) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  get textContent(): string { return this.nodeType === 3 ? this.nodeValue ?? "" : this.childNodes.map(c => c.textContent).join(""); }
  set textContent(value: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value) { const text = new MiniNode(3, "#text"); text.nodeValue = value; text.ownerDocument = this.ownerDocument; this.appendChild(text); }
  }
  addEventListener(_type: string, _listener: Listener) {}
  removeEventListener(_type: string, _listener: Listener) {}
}

class MiniElement extends MiniNode {
  attributes = new Map<string, string>();
  style: Record<string, unknown> & { setProperty(name: string, value: unknown): void } = { setProperty(name, value) { this[name] = value; } };
  namespaceURI = "http://www.w3.org/1999/xhtml";
  constructor(public tagName: string) { super(1, tagName.toUpperCase()); }
  setAttribute(name: string, value: unknown) { this.attributes.set(name, String(value)); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  /** Every descendant element (depth first), for queries in tests. */
  all(): MiniElement[] {
    return this.childNodes.flatMap(c => c instanceof MiniElement ? [c, ...c.all()] : []);
  }
}

class MiniDocument extends MiniNode {
  body: MiniElement;
  documentElement: MiniElement;
  activeElement: MiniElement | null = null;
  defaultView: unknown = null;
  constructor() {
    super(9, "#document");
    this.ownerDocument = null;
    this.documentElement = this.createElement("html");
    this.body = this.createElement("body");
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string) { const el = new MiniElement(tag); el.ownerDocument = this; return el; }
  createElementNS(_ns: string, tag: string) { return this.createElement(tag); }
  createTextNode(value: string) { const text = new MiniNode(3, "#text"); text.nodeValue = value; text.ownerDocument = this; return text; }
  createComment(value: string) { const c = new MiniNode(8, "#comment"); c.nodeValue = value; c.ownerDocument = this; return c; }
}

export type { MiniElement };

/** Installs globals react-dom/client reads and returns a fresh container element. */
export function installMiniDom(): MiniElement {
  const document = new MiniDocument();
  class HTMLIFrameElement {}
  const window = { document, HTMLIFrameElement, event: undefined, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({}), navigator: { userAgent: "bun" } };
  document.defaultView = window;
  Object.assign(globalThis, { window, document, HTMLIFrameElement, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.appendChild(container);
  return container;
}
