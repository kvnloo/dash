import { useState, useSyncExternalStore } from "react";
import type { UserMessage } from "../model";
import { store } from "../store/app";
import { deliveryOutbox, retryDelivery } from "../net/delivery";
import { messageDeliveryProps, retryKey } from "../lib/message-delivery-view";
import { DeliveryStatus } from "./DeliveryStatus";

/** Match the user row to its adjacent assistant turn, including restored conversations. */
export function MessageDelivery({ message }: { message: UserMessage }) {
  const records = useSyncExternalStore(deliveryOutbox.subscribe, deliveryOutbox.get, deliveryOutbox.get);
  const conversations = store.use(state => state.conversations);
  const [busy, setBusy] = useState(false);
  const chat = conversations.find(item => item.messages.some(row => row.id === message.id));
  const index = chat?.messages.findIndex(row => row.id === message.id) ?? -1;
  const assistant = index >= 0 ? chat?.messages[index + 1] : undefined;
  const record = assistant?.role === "assistant" ? records.find(item => item.turnId === assistant.turnId) : undefined;
  if (!record) return null;
  const props = messageDeliveryProps(message, record, { retryBusy: busy, now: Date.now() });
  if (!props) return null;
  return <DeliveryStatus key={retryKey(record)} {...props} onRetry={() => {
    setBusy(true);
    void retryDelivery(record.clientId).finally(() => setBusy(false));
  }} />;
}
