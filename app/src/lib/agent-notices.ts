import { parseServerMessage, type ClientMessage, type NoticeMessage } from "../../../shared/protocol";
import { parseNotificationTarget, type DashNotice } from "./notification-policy";

/** Serialized hydration/receipts prevent two replay frames from racing the dedupe. */
export function createAgentNoticeInbox(options: {
  emit: (notice: DashNotice) => void;
  changed?: (items: readonly NoticeMessage[]) => void;
  storage?: { read(): Promise<string | null>; write(text: string): Promise<void> };
}) {
  let items: NoticeMessage[] = [];
  let hydrated = false;
  let work = Promise.resolve();
  async function hydrate() {
    if (hydrated) return;
    const text = await options.storage?.read();
    if (text) {
      try {
        const raw: unknown = JSON.parse(text);
        if (Array.isArray(raw)) for (const item of raw.slice(0, 50)) {
          const parsed = parseServerMessage(item);
          if (parsed?.type === "notice" && !items.some(n => n.id === parsed.id)) items.push(parsed);
        }
      } catch { /* A corrupt cache is recoverable from the bridge's bounded replay. */ }
    }
    hydrated = true; options.changed?.(items);
  }
  async function clear() { await options.storage?.write("[]"); items = []; hydrated = true; options.changed?.(items); }
  function enqueue(run: () => Promise<void>) {
    const next = work.then(run); work = next.catch(() => {}); return next;
  }
  return {
    list: (): readonly NoticeMessage[] => items,
    hydrate: () => enqueue(hydrate),
    receive: (notice: NoticeMessage) => enqueue(async () => {
      await hydrate();
      if (items.some(n => n.id === notice.id)) return;
      const next = [notice, ...items].slice(0, 50);
      await options.storage?.write(JSON.stringify(next));
      items = next; options.changed?.(items);
      options.emit({ key: `notice:${notice.id}`, title: notice.title, body: notice.body,
        target: parseNotificationTarget({ url: notice.url }) ?? { kind: "notices" }, report: true });
    }),
    clear: () => enqueue(clear),
    /** Forget everything: also drop the bridge ring, or the next pairing replays old reports. */
    forget: (send: (message: ClientMessage) => boolean) => enqueue(async () => { send({ type: "notices_clear" }); await clear(); }),
  };
}
