// Read-only diagnostics for the installed Dash app and its paired bridge.
// Never print identity credentials, bearer tokens, broker secrets or microphone audio.
import Constants, { ExecutionEnvironment } from "expo-constants";
import { getRecordingPermissionsAsync } from "expo-audio";
import { requireOptionalNativeModule } from "expo-modules-core";
import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import { loadSkia } from "../components/annotate/skia-ready";
import { authorizedBridgeFetch } from "./bridge-request-auth";
import { voiceAccessToken } from "./bridge-auth";
import { voiceTarget } from "./voice-target";
import { currentSink } from "../store/annotate";
import { store } from "../store/app";

export type ProbeState = "ok" | "fail" | "info";
export interface DeviceProbe {
  id: string;
  label: string;
  state: ProbeState;
  detail: string;
  voiceBlocking: boolean;
}
export interface DeviceCheckReport {
  probes: readonly DeviceProbe[];
  text: string;
}
type Result = { state: ProbeState; detail: string };
type VoiceStatus = {
  stt: { ok: boolean; reason?: string };
  nativeVoice: boolean;
  identity: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseVoiceStatus(value: unknown): VoiceStatus | null {
  if (!isRecord(value) || !isRecord(value.stt) ||
      typeof value.stt.ok !== "boolean" || typeof value.nativeVoice !== "boolean" ||
      typeof value.identity !== "boolean") return null;
  return {
    stt: { ok: value.stt.ok, reason: typeof value.stt.reason === "string" ? value.stt.reason : undefined },
    nativeVoice: value.nativeVoice,
    identity: value.identity,
  };
}
function concise(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 240);
}
function nativeModule(name: string): boolean {
  return Platform.OS !== "web" && requireOptionalNativeModule(name) !== null;
}

export function firstFailingVoiceProbe(report: DeviceCheckReport): DeviceProbe | undefined {
  return report.probes.find(probe => probe.voiceBlocking && probe.state === "fail");
}

export async function runDeviceCheck(): Promise<DeviceCheckReport> {
  const rows: DeviceProbe[] = [];
  const settings = store.get().settings;
  const conversations = store.get().conversations;
  const activeId = store.get().activeId;
  // Every independent probe is isolated; a broken native module cannot hide bridge diagnostics.
  const inspect = async (id: string, label: string, run: () => Result | Promise<Result>, voiceBlocking = false) => {
    try {
      const result = await run();
      rows.push({ id, label, ...result, voiceBlocking });
    } catch {
      rows.push({ id, label, state: "fail", detail: "check failed", voiceBlocking });
    }
  };

  await inspect("platform", "Platform", () => {
    const variant = Platform.OS === "web" ? "web browser" :
      Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? "Expo Go" :
      __DEV__ ? "native development build" : "native build";
    const supported = Platform.OS === "android" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
    return {
      state: supported ? "ok" : "fail",
      detail: Platform.OS + " / " + variant + (supported ? "" : " - native Android voice unavailable"),
    };
  }, true);

  await inspect("identity", "z0bridge identity", () => ({
    state: settings?.identity ? "ok" : "fail",
    detail: settings?.identity ? "present" : "missing - enroll this device",
  }), true);

  await inspect("grant", "Voice grant z0live:voice", async () => {
    if (!settings?.identity) return { state: "fail", detail: "not enrolled" };
    try {
      await voiceAccessToken(settings);
      return { state: "ok", detail: "mintable" };
    } catch (error) {
      // IdentityTokens masks bodies and credentials; classify, never echo the raw exception.
      const message = error instanceof Error ? error.message : "";
      if (/HTTP 40[13]|scope was refused|requested scope|grant/i.test(message)) {
        return {
          state: "fail",
          detail: "denied - owner command: z0bridge grant " + settings.identity.credentialId + " --scope z0live:voice",
        };
      }
      if (/request failed|timed out|HTTP 5\d\d|unavailable|network/i.test(message)) {
        return { state: "fail", detail: "network - cannot reach the z0bridge identity service" };
      }
      return { state: "fail", detail: "credential unavailable - pair again" };
    }
  }, true);

  let status: VoiceStatus | undefined;
  let statusProblem = "not checked";
  await inspect("bridge", "Bridge /voice/status", async () => {
    if (!settings) {
      statusProblem = "not paired";
      return { state: "fail", detail: statusProblem };
    }
    let fetched: Awaited<ReturnType<typeof authorizedBridgeFetch>>;
    try {
      fetched = await authorizedBridgeFetch(settings, "http://" + settings.address + "/voice/status", {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(8000),
      });
    } catch {
      statusProblem = "network - cannot reach the bridge";
      return { state: "fail", detail: statusProblem };
    }
    if (!fetched.ok) {
      statusProblem = fetched.reason === "no-credential" ? "no bridge credential" : "bridge identity authorization failed";
      return { state: "fail", detail: statusProblem };
    }
    if (!fetched.response.ok) {
      statusProblem = fetched.response.status === 404 ? "endpoint missing - update bridge (TURBO-C07)" :
        fetched.response.status === 401 || fetched.response.status === 403 ? "bridge authorization denied" :
        "bridge HTTP " + fetched.response.status;
      return { state: "fail", detail: statusProblem };
    }
    let body: unknown;
    try {
      body = await fetched.response.json();
    } catch {
      statusProblem = "invalid JSON response";
      return { state: "fail", detail: statusProblem };
    }
    const parsed = parseVoiceStatus(body);
    if (!parsed) {
      statusProblem = "invalid status schema";
      return { state: "fail", detail: statusProblem };
    }
    status = parsed;
    statusProblem = "";
    return { state: "ok", detail: "reachable and authenticated" };
  }, true);
  await inspect("stt", "Bridge STT", () => status
    ? { state: status.stt.ok ? "ok" : "fail", detail: status.stt.ok ? "ok" : "unavailable - " + concise(status.stt.reason ?? "no model readiness reason") }
    : { state: "fail", detail: "unknown - " + statusProblem });
  await inspect("nativeVoice", "nativeVoice", () => status
    ? { state: status.nativeVoice ? "ok" : "fail", detail: status.nativeVoice ? "enabled" : "disabled on bridge" }
    : { state: "fail", detail: "unknown - " + statusProblem }, true);
  await inspect("bridgeIdentity", "Bridge identity", () => status
    ? { state: status.identity ? "ok" : "fail", detail: status.identity ? "configured" : "not configured" }
    : { state: "fail", detail: "unknown - " + statusProblem }, true);

  await inspect("webrtc", "WebRTCModule", () => {
    const present = Platform.OS === "android" && NativeModules.WebRTCModule != null;
    return { state: present ? "ok" : "fail", detail: present ? "present" : "missing - rebuild the APK" };
  }, true);
  const modules: readonly (readonly [string, string, string])[] = [
    ["stylus", "DashStylus", "DashStylus"],
    ["audioRoute", "DashAudioRoute", "DashAudioRoute"],
    ["share", "DashShare", "DashShareFiles"],
    ["cutout", "DashCutout", "DashDisplayCutout"],
  ];
  for (const [id, label, module] of modules) {
    await inspect(id, label, () => {
      const present = nativeModule(module);
      return { state: present ? "ok" : "fail", detail: present ? "present" : "missing - rebuild the APK" };
    });
  }

  await inspect("mic", "Microphone permission", async () => {
    if (Platform.OS === "web") return { state: "info", detail: "not applicable in browser" };
    if (Platform.OS === "android") {
      const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      return { state: granted ? "ok" : "fail", detail: granted ? "granted" : "not granted - enable in Android settings" };
    }
    const permission = await getRecordingPermissionsAsync();
    return { state: permission.granted ? "ok" : "fail", detail: permission.granted ? "granted" : "not granted - enable in system settings" };
  }, true);

  await inspect("skia", "Skia", async () => {
    await loadSkia();
    // Native loadSkia is a no-op; actually link the renderer to detect stale APKs.
    if (Platform.OS !== "web") {
      // A lazy require, not import(): a dynamic import can 404 in native Metro previews.
      const renderer: unknown = require("@shopify/react-native-skia");
      if (!isRecord(renderer) || !("Skia" in renderer)) {
        return { state: "fail", detail: "renderer missing - rebuild the APK" };
      }
    }
    return { state: "ok", detail: "ok" };
  });

  await inspect("target", "Voice target", () => {
    const target = voiceTarget(conversations, activeId);
    return target
      ? { state: "ok", detail: "attached - " + concise(target.title) }
      : { state: "fail", detail: "missing - open an attached Hermes chat" };
  }, true);
  await inspect("annotationSink", "Annotation sink", () => {
    const sink = currentSink();
    return sink
      ? { state: "ok", detail: "present - " + concise(sink.label) }
      : { state: "fail", detail: "missing - open a chat to send annotations" };
  });

  return { probes: rows, text: ["Dash device self-check", ...rows.map(probe => probe.label + ": " + probe.detail)].join("\n") };
}
