import { useEffect, useRef, type ReactNode } from "react";
import type { SharedValue } from "react-native-reanimated";

/** Allow browser scroll before activation, reserve both axes only after the hold has armed. */
export function TileTouch({ holding, children, onOpen, onPrimary, onSecondary }: { holding: SharedValue<boolean>; children: ReactNode; onOpen(): void; onPrimary(): void; onSecondary(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const move = (event: TouchEvent) => { if (holding.value && event.cancelable) event.preventDefault(); };
    node.addEventListener("touchmove", move, { passive: false });
    return () => node.removeEventListener("touchmove", move);
  }, [holding]);
  return <div ref={ref} style={{ display: "contents" }} onKeyDown={event => {
    if (event.target !== ref.current?.firstElementChild || event.ctrlKey || event.altKey || event.metaKey) return;
    const action = event.key === "Enter" || event.key === " " ? onOpen : event.key.toLowerCase() === "p" ? onPrimary : event.key.toLowerCase() === "c" ? onSecondary : null;
    if (action) { event.preventDefault(); event.stopPropagation(); action(); }
  }}>{children}</div>;
}
