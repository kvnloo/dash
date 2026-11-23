import AsyncStorage from "@react-native-async-storage/async-storage";
import { createStore } from "./createStore";

export type CardStyle = "dash" | "app";
const KEY = "dash.card.style";
export const cardStyle = createStore<CardStyle>("dash");
let loading: Promise<void> | undefined;
let changed = false;

export function loadCardStyle() {
  return loading ??= AsyncStorage.getItem(KEY).then(value => {
    if (!changed && value === "app") cardStyle.set(value);
  }).catch(() => {});
}

export function setCardStyle(value: CardStyle) {
  changed = true;
  cardStyle.set(value);
  void AsyncStorage.setItem(KEY, value).catch(() => {});
}
