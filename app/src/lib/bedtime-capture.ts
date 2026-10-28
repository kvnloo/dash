import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { DEFAULT_POSTURE_CONFIG, evaluateHumanPosture, fmt } from "../../../shared/human-posture";
import { policy } from "../../../shared/interaction-policy";

/**
 * Bedtime capture window from this phone's clock (#374/#417): the CIRCADIAN-SPEC quiet phases
 * (wind-down, pre-sleep, sleep) with the default anchors in the phone's own time zone. The host's
 * private anchors never cross the bridge (R4), and the composer must decide offline too.
 */
export function deviceTimeZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}

export function bedtimeNow(now: number, tz = deviceTimeZone()): boolean {
  const iso = fmt(now);
  try {
    return policy(evaluateHumanPosture({}, iso, tz ? { tz } : {}), iso).captureMode;
  } catch {
    return policy(evaluateHumanPosture({}, iso), iso).captureMode; // unknown zone: the spec default
  }
}

const hhmm = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};
const toMin = (clock: string) => { const [h = 0, m = 0] = clock.split(":").map(Number); return h * 60 + m; };
/** "9:30 pm to 7:30 am": wind-down starts 3 h before the default bed time; capture ends at wake. */
export const BEDTIME_WINDOW = `${hhmm(toMin(DEFAULT_POSTURE_CONFIG.bedTarget) - 180)} to ${hhmm(toMin(DEFAULT_POSTURE_CONFIG.wakeTarget))}`;

/** True while the phone's clock is in the bedtime window; re-checked every 30 s and on foreground. */
export function useBedtime(): boolean {
  const [bedtime, setBedtime] = useState(() => bedtimeNow(Date.now()));
  useEffect(() => {
    const check = () => setBedtime(bedtimeNow(Date.now()));
    const timer = setInterval(check, 30_000);
    const sub = AppState.addEventListener("change", state => { if (state === "active") check(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, []);
  return bedtime;
}
