import AsyncStorage from "@react-native-async-storage/async-storage";
import { CONVERSATION_INDEX_KEY, type ConversationFiles, type IndexStore } from "./conversation-persistence";

const prefix = (area: "durable" | "cache") => `dash.${area}.files.v2/`;
export const conversationFiles: ConversationFiles = {
  async list(area) { const base = prefix(area); return (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(base)).map(key => key.slice(base.length)); },
  read(area, name) { return AsyncStorage.getItem(prefix(area) + name); },
  write(area, name, value) { return AsyncStorage.setItem(prefix(area) + name, value); },
  remove(area, name) { return AsyncStorage.removeItem(prefix(area) + name); },
};

/** One key holding the light entries of every persisted conversation (read once at startup). */
export const conversationIndex: IndexStore = {
  read() { return AsyncStorage.getItem(CONVERSATION_INDEX_KEY); },
  write(value) { return AsyncStorage.setItem(CONVERSATION_INDEX_KEY, value); },
  remove() { return AsyncStorage.removeItem(CONVERSATION_INDEX_KEY); },
};
