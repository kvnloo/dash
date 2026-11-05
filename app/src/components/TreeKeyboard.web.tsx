import type { TreeKeyboardProps } from "./TreeKeyboard";

export function TreeKeyboard({ children, label, onKey, inline }: TreeKeyboardProps) {
  return <div role="tree" aria-label={label} style={{ flex: inline ? undefined : 1, display: "flex", flexDirection: "column", minHeight: 0 }} onKeyDown={event => {
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest('[role="treeitem"]');
    const id = row?.getAttribute("data-testid")?.replace(/^tree-row-/, "");
    if (!id) return;
    event.preventDefault();
    const next = onKey(event.key, id);
    if (next) {
      const container = event.currentTarget;
      const focus = (attempt: number) => {
        if (!container.isConnected) return;
        for (const element of container.querySelectorAll('[role="treeitem"]')) {
          if (element instanceof HTMLElement && element.getAttribute("data-testid") === `tree-row-${next}`) { element.focus(); return; }
        }
        // FlashList mounts an offscreen keyboard target after scrollToIndex.
        if (attempt < 30) requestAnimationFrame(() => focus(attempt + 1));
      };
      requestAnimationFrame(() => focus(0));
    }
  }}>{children}</div>;
}
