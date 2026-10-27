import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NoticeMessage } from "../../../shared/protocol";
import { createAgentNoticeInbox } from "../lib/agent-notices";
import { postNativeNotice } from "../lib/native-notifications";
import { createStore } from "./createStore";
const KEY = "dash.notices.v1";
export const notices = createStore<{ items: readonly NoticeMessage[]; error: string }>({ items: [], error: "" });
export const agentNoticeInbox = createAgentNoticeInbox({
  storage: { read: () => AsyncStorage.getItem(KEY), write: text => AsyncStorage.setItem(KEY, text) },
  changed: items => notices.set({ items, error: "" }),
  emit: notice => { void postNativeNotice(notice); },
});
export function noticeFailure(): void { notices.set(s => ({ ...s, error: "Could not save reports. Reconnect to retry the bridge's last 50 notices." })); }
