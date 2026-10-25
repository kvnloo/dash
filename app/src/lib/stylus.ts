export interface StylusButton { pressed: boolean }
export function observeStylus(_button: (event: StylusButton) => void, _selection: (text: string) => void): () => void { return () => {}; }
/** Web fallback reads painted text only, never hidden transcript data or offscreen nodes. */
export async function regionText(x: number, y: number, width: number, height: number): Promise<string> {
  if (typeof document === "undefined") return "";
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const result: string[] = [];
  let visited = 0;
  for (let node = walker.nextNode(); node && visited < 12000; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest('[data-testid="annotation-overlay"]') || !node.textContent?.trim()) continue;
    const style = getComputedStyle(parent);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const bounds = range.getBoundingClientRect();
    if (bounds.right < x || bounds.left > x+width || bounds.bottom < y || bounds.top > y+height) continue;
    let text = "";
    for (let i=0; i<node.textContent.length && visited++ < 12000; i++) {
      range.setStart(node,i); range.setEnd(node,i+1);
      const b=range.getBoundingClientRect();
      if (b.left >= x && b.right <= x+width && b.top >= y && b.bottom <= y+height) text+=node.textContent[i];
    }
    if (text.trim()) result.push(text.trim());
  }
  return result.join("\n");
}
