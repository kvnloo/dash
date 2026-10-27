import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ConversationFiles } from "./conversation-persistence";

const prefix = (area: "durable" | "cache") => `dash.${area}.files.v2/`;
export const conversationFiles: ConversationFiles = {
  async list(area) { const base = prefix(area); return (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(base)).map(key => key.slice(base.length)); },
  read(area, name) { return AsyncStorage.getItem(prefix(area) + name); },
  write(area, name, value) { return AsyncStorage.setItem(prefix(area) + name, value); },
  remove(area, name) { return AsyncStorage.removeItem(prefix(area) + name); },
};
