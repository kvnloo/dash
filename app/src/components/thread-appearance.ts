/** Presentation-only. The roster/store remains the authority for live and stale. */
export function threadAppearance({ stale = false, live = false }: { stale?: boolean; live?: boolean }) {
 return { stale, live: !stale && live, label: stale ? "ended" : undefined };
}
