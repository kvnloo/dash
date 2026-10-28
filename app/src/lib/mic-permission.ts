import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import { PermissionsAndroid, Platform } from "react-native";

const PERMISSION_RESUME_GRACE_MS = 1_500;
let pending: Promise<boolean> | undefined;
let requesting = false;
let graceUntil = 0;

/** Android pauses MainActivity for the RECORD_AUDIO dialog; that pause is not user backgrounding. */
export function permissionRequestInFlight(): boolean {
  return requesting || Date.now() < graceUntil;
}

async function checkOrRequest(): Promise<boolean> {
  if (Platform.OS === "android") {
    const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    if (await PermissionsAndroid.check(permission)) return true;
    requesting = true;
    try {
      return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
    } finally {
      graceUntil = Date.now() + PERMISSION_RESUME_GRACE_MS;
      requesting = false;
    }
  }
  if ((await getRecordingPermissionsAsync()).granted) return true;
  requesting = true;
  try {
    return (await requestRecordingPermissionsAsync()).granted;
  } finally {
    graceUntil = Date.now() + PERMISSION_RESUME_GRACE_MS;
    requesting = false;
  }
}

/** Share one OS request across dictation and live voice; recheck after a settings change. */
export function ensureMicPermission(): Promise<boolean> {
  // The web tester-army's scripted voice peer (EXPO_PUBLIC_DASH_VOICE_FAKE) never opens a microphone, and
  // a headed browser would wait forever on a permission prompt nobody can answer.
  if (Platform.OS === "web" && process.env.EXPO_PUBLIC_DASH_VOICE_FAKE === "1") return Promise.resolve(true);
  if (pending) return pending;
  pending = (async () => {
    try { return await checkOrRequest(); }
    finally { pending = undefined; }
  })();
  return pending;
}
