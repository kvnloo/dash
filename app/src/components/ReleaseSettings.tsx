import Constants, { ExecutionEnvironment } from "expo-constants";
import { useRef, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { authorizedBridgeFetch } from "../lib/bridge-request-auth";
import { developmentClientLink, endpointOrigin, metroOrigin, originPort, probeLaunchAsset, reloadBlockedBy, STUDIO_CHANNELS } from "../lib/live-update";
import { bundleOrigin } from "../lib/use-live-update";
import { store } from "../store/app";
import { flushDrafts } from "../store/composer-drafts";
import { colors, space, type } from "../theme";

function parseOffer(value: unknown) {
  if (typeof value !== "object" || value === null || !("sha" in value) || !("version" in value)) return null;
  return typeof value.sha === "string" && /^[a-f0-9]{40}$/.test(value.sha) &&
    typeof value.version === "number" && Number.isSafeInteger(value.version) && value.version > 0
    ? { sha: value.sha, version: value.version } : null;
}

export function ReleaseSettings() {
  const settings = store.use(s => s.settings);
  return <ReleaseControls key={settings?.address} />;
}

function ReleaseControls() {
  const settings = store.use(s => s.settings);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const [offer, setOffer] = useState<ReturnType<typeof parseOffer>>(null);
  const origin = Platform.OS === "android" && __DEV__ && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient ? bundleOrigin() ?? metroOrigin(Constants.expoConfig?.hostUri) : null;
  const port = origin ? originPort(origin) : null;
  const current = STUDIO_CHANNELS.find(channel => channel.port === port);
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try { await work(); }
    catch { setMessage("Could not complete the request. Try again."); }
    finally { lock.current = false; setBusy(false); }
  };
  const switchChannel = (targetPort: number) => void run(async () => {
    const target = origin && endpointOrigin(origin, targetPort);
    if (!target) return;
    const health = await probeLaunchAsset(target + "/status", fetch);
    if (!health.ok) { setMessage("That Metro server is unavailable. Nothing changed."); return; }
    if (reloadBlockedBy()) { setMessage("Finish the active interaction before switching."); return; }
    await flushDrafts();
    if (reloadBlockedBy()) { setMessage("Finish the active interaction before switching."); return; }
    await Linking.openURL(developmentClientLink("exp+" + (Constants.expoConfig?.slug ?? "dash"), target));
  });
  const request = (sha?: string) => void run(async () => {
    if (!settings) return;
    if (!sha) setOffer(null);
    else {
      if (reloadBlockedBy()) { setMessage("Finish the active interaction before installing."); return; }
      await flushDrafts();
      if (store.get().settings?.address !== settings.address || reloadBlockedBy()) return;
    }
    const result = await authorizedBridgeFetch(settings, "http://" + settings.address + "/android/update" + (sha ? "?sha=" + sha : ""), {
      method: sha ? "POST" : "GET", signal: AbortSignal.timeout(sha ? 200_000 : 8_000),
    });
    if (!result.ok) { setMessage("Could not authenticate with the bridge."); return; }
    const response = result.response;
    if (sha) {
      setOffer(null);
      setMessage(response.status === 204 ? "Install finished. Reopen Dash if needed." :
        response.status === 409 ? "Update changed or an install is running. Check again." : "Install refused or failed. Check the bridge log.");
    } else if (response.status === 404 || response.status === 204) setMessage("No Android update staged on this bridge.");
    else if (response.ok) {
      const next = parseOffer(await response.json());
      const installed = Number(Constants.nativeBuildVersion ?? "0");
      if (!next || next.version <= installed) setMessage("No newer Android update.");
      else setOffer(next);
    } else setMessage("Could not check for updates.");
  });
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>Release channel</Text>
      <Text style={styles.text}>{current ? "Running " + current.label : "Open the Android dev client on Stable or Preview Metro to switch channels."}</Text>
      {current && STUDIO_CHANNELS.map(channel => <Pressable
        key={channel.port} accessibilityRole="button" disabled={busy || port === channel.port}
        onPress={() => switchChannel(channel.port)} style={styles.action}>
        <Text style={styles.text}>{channel.label}{port === channel.port ? " (current)" : ""}</Text>
      </Pressable>)}
      {settings && (Platform.OS === "android" || Platform.OS === "web") && <Pressable accessibilityRole="button" disabled={busy} onPress={() => request()} style={styles.action}>
        <Text style={styles.text}>Check for Android update</Text>
      </Pressable>}
      {offer && <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>Update available</Text>
        <Text style={styles.text}>Android build {offer.version} · {offer.sha.slice(0, 7)}. Install on the phone configured on this bridge?</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => request(offer.sha)} style={styles.action}><Text style={styles.text}>Install via ADB</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => setOffer(null)} style={styles.action}><Text style={styles.text}>Not now</Text></Pressable>
      </View>}
      {message !== "" && <Text accessibilityLiveRegion="polite" style={styles.text}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  heading: { ...type.body, color: colors.text },
  text: { ...type.body, color: colors.textMuted },
  action: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.md, borderWidth: 1, borderColor: colors.border },
});
