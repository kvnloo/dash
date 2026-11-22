import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { useEffect, useState } from "react";
import { createStore } from "./createStore";

const KEY = "dash.bedtime.v1";
type Schedule = { enabled: boolean; bedtime: string; wake: string };
const defaults: Schedule = { enabled: false, bedtime: "22:00", wake: "07:00" };
export const bedtimeSchedule = createStore<Schedule | null>(null);
export const validTime = (value: unknown): value is string => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const restored = AsyncStorage.getItem(KEY).then(raw => {
  const value: unknown = raw ? JSON.parse(raw) : null;
  if (value && typeof value === "object" && "enabled" in value && typeof value.enabled === "boolean"
      && "bedtime" in value && validTime(value.bedtime) && "wake" in value && validTime(value.wake) && value.bedtime !== value.wake) {
    bedtimeSchedule.set({ enabled: value.enabled, bedtime: value.bedtime, wake: value.wake });
  }
}).catch(() => {}).finally(() => { if (!bedtimeSchedule.get()) bedtimeSchedule.set(defaults); });

let pending: Promise<void> = restored;
function persist(task: () => Promise<void>) {
  const next = pending.then(task);
  pending = next.catch(() => {});
  return next;
}

export function setBedtimeSchedule(schedule: Schedule) {
  return persist(async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(schedule));
    bedtimeSchedule.set(schedule);
  });
}

export function clearBedtimeSchedule() {
  return persist(async () => {
    await AsyncStorage.removeItem(KEY);
    bedtimeSchedule.set(defaults);
  });
}

export function isBedtime(schedule: Schedule | null, now = new Date()): boolean {
  if (!schedule?.enabled) return false;
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return schedule.bedtime < schedule.wake ? clock >= schedule.bedtime && clock < schedule.wake
    : clock >= schedule.bedtime || clock < schedule.wake;
}

export function useBedtime() {
  const schedule = bedtimeSchedule.use(s => s);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    if (!schedule?.enabled) return;
    const update = () => setNow(Math.floor(Date.now() / 60_000));
    update();
    const timer = setInterval(update, 1000);
    const listener = AppState.addEventListener("change", update);
    return () => { clearInterval(timer); listener.remove(); };
  }, [schedule]);
  return isBedtime(schedule, new Date(now * 60_000));
}
