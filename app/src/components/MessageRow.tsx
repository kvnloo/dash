import { Feather } from "@expo/vector-icons";
import { memo, useState } from "react";
import { Alert, Platform, StyleSheet, Text, View } from "react-native";
import type { ChatAttachment } from "../../../shared/protocol";
import { baseName, fileRefs, formatSize, isImage, sendToPhone } from "../lib/attachments";
import type { AssistantMessage, AssistantState, Message } from "../model";
import { store } from "../store/app";
import { replyText, useKeyed } from "../store/text";
import { colors, fonts, glass, radius, space, type } from "../theme";
import { messageThinking, type Thinking } from "../lib/thinking";
import { splitThinking } from "../lib/message-details";
import { AgentOrb } from "./AgentOrb";
import { Markdown } from "./Markdown";
import { sendInlineIntent } from "../lib/inline-intent";
import { InlineImage } from "./genui/InlineImage";
import { isImageRef } from "../lib/genui";
import { ReplyBlocks } from "./ReplyBlocks";
import type { DetailMode } from "../lib/reply-details";
import { bridge } from "../net/bridge";
import { StageLinks } from "./artifact-stage/StageLinks";
import { PressScale } from "./PressScale";

export const MessageRow = memo(function MessageRow({
  message,
  harnessId,
  thinking,
  detailMode = "Compact",
}: {
  message: Message;
  harnessId?: string;
  thinking?: Thinking;
  detailMode?: DetailMode;
}) {
  if (message.role === "user") {
    return (
      <View style={styles.userRow}>
        <View style={styles.bubble}>
          {message.attachments?.length ? <SentFiles files={message.attachments} spaced={Boolean(message.text)} /> : null}
          {message.text ? (
            <Text selectable style={styles.userText}>
              {message.text}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.assistantRow}>
      <ReplyBlocks turnId={message.turnId} parts={message.parts} mode={detailMode} request={callId => {
        const chat = store.get().conversations.find(c => c.messages.some(m => m.id === message.id));
        const history = message.seq === 0 && chat?.harness === "hermes";
        bridge.send({ type: "tool_detail", id: message.turnId, callId, ...(history ? { messageId: message.id, sessionId: chat?.sessionId, profileId: chat?.profileId, hostId: chat?.targetHostId } : {}) });
      }} />
      <AssistantBody key={message.id} message={message} harnessId={harnessId} detailMode={detailMode} />
      {thinking && thinking.phase !== "idle" ? <View style={styles.statusRow}><AgentOrb size={20} thinking={thinking} /><Text style={styles.statusText}>working · {thinking.tool ?? "terminal"}</Text></View> : null}
      {!message.parts?.length && detailMode !== "Hide" && (message.activity?.length || (message.state === "done" && message.status)) ? <Disclosure key={`${message.id}:activity`} label={`Activity · ${message.activity?.length ?? 1} ${(message.activity?.length ?? 1) === 1 ? "update" : "updates"}`} text={(message.activity ?? [message.status ?? ""]).join("\n")} /> : null}
    </View>
  );
});

function Disclosure({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return <View style={styles.disclosure}>
    <PressScale accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setOpen(!open)} style={styles.disclosureButton}>
      <Feather name={open ? "chevron-down" : "chevron-right"} size={14} color={colors.textMuted} />
      <Text numberOfLines={1} style={styles.disclosureLabel}>{label} · {text.split("\n")[0]}</Text>
    </PressScale>
    {open ? <Text selectable style={styles.detailText}>{text}</Text> : null}
  </View>;
}
function Answer({ text, turnId, detailMode }: { text: string; turnId: string; detailMode: DetailMode }) {
  const parts = splitThinking(text);
  return <>{parts.thinking ? <ReplyBlocks turnId={turnId} parts={[{ kind: "reasoning", text: parts.thinking }]} mode={detailMode} /> : null}{parts.text ? <Markdown text={parts.text} onIntent={intent => sendInlineIntent(turnId, intent)} /> : null}</>;
}

function ThinkingMarker({ turnState, waiting = false }: { harnessId?: string; turnState: AssistantState; waiting?: boolean }) {
  // A reply held for a host handoff is not work in progress: faint, never gold.
  const color = waiting ? colors.textTertiary : turnState === "done" ? colors.ok : turnState === "error" ? colors.danger : colors.gold;
  return <View accessibilityLabel={waiting ? "queued" : turnState} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }} />;
}

function AssistantBody({ message, harnessId, detailMode }: { message: AssistantMessage; harnessId?: string; detailMode: DetailMode }) {
  const liveText = useKeyed(replyText, message.turnId);
  const connection = store.use(s => s.connection.status);
  switch (message.state) {
    case "pending":
      return (
        <View style={styles.statusRow}>
          <AgentOrb size={20} thinking={messageThinking(message, { connection })} />
          <Text style={styles.statusText} numberOfLines={1}>
            Queued…
          </Text>
        </View>
      );
    case "streaming":
      return (
        <>
          {liveText || message.text ? <Answer turnId={message.turnId} detailMode={detailMode} text={liveText || message.text} /> : null}
          <View style={styles.statusRow}>
            <AgentOrb size={20} thinking={messageThinking(message, { liveText, connection })} label={message.handoff === "queued" ? "queued" : "streaming"} />
            <Text style={styles.statusText} numberOfLines={1}>
              {message.status ?? "Working"}
            </Text>
          </View>
        </>
      );
    case "done":
      return <><Answer turnId={message.turnId} detailMode={detailMode} text={message.text} /><HostFiles text={message.text} /><StageLinks text={message.text} /></>;
    case "interrupted":
      return (
        <>
          {message.text ? <Answer turnId={message.turnId} detailMode={detailMode} text={message.text} /> : null}
          <View style={styles.statusRow}>
            <ThinkingMarker harnessId={harnessId} turnState={message.state} />
            <Text style={styles.noteText}>{message.status ?? "Connection to the bridge was lost mid-reply."}</Text>
          </View>
        </>
      );
    case "error":
      return (
        <>
          {message.text ? <Answer turnId={message.turnId} detailMode={detailMode} text={message.text} /> : null}
          <View style={styles.statusRow}>
            <ThinkingMarker harnessId={harnessId} turnState={message.state} />
            <Text selectable style={styles.errorText}>
              {message.error ?? "Something went wrong"}
            </Text>
          </View>
        </>
      );
    default: {
      const _exhaustive: never = message.state;
      return _exhaustive;
    }
  }
}

/** Files this message carried to the host: names only; the bytes live on the bridge. */
function SentFiles({ files, spaced }: { files: ChatAttachment[]; spaced: boolean }) {
  return <View style={[styles.sentFiles, spaced && styles.sentFilesSpaced]}>
    {files.map(f => <View key={f.id} style={styles.sentFile} accessibilityLabel={`Attached ${f.name}`}>
      <Feather name={isImage(f.mime) ? "image" : "file-text"} size={14} color={colors.textMuted} />
      <Text style={styles.sentName} numberOfLines={1}>{f.name}</Text>
      <Text style={styles.sentSize}>{formatSize(f.size)}</Text>
    </View>)}
  </View>;
}

/**
 * Host files a finished reply names. The phone cannot open a host path, so each one gets an
 * owner-initiated "Send to phone" that asks the bridge to push it with KDE Connect.
 */
function HostFiles({ text }: { text: string }) {
  const paths = fileRefs(text);
  const [busy, setBusy] = useState<string | null>(null);
  if (paths.length === 0) return null;
  const send = async (path: string) => {
    const settings = store.get().settings;
    if (!settings || busy) return;
    setBusy(path);
    const result = await sendToPhone(settings, path, fetch);
    setBusy(null);
    if (Platform.OS === "web") { globalThis.alert?.(result.message); return; }
    Alert.alert(result.ok ? "Sent to phone" : "Not sent", result.message);
  };
  const confirm = (path: string) => {
    if (Platform.OS === "web") { void send(path); return; }
    Alert.alert("Send to phone?", `${baseName(path)} will be pushed from the host with KDE Connect.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Send", onPress: () => void send(path) },
    ]);
  };
  return <><View>{paths.filter(path => isImageRef(path) && !text.includes(`](${path})`)).map(path => <InlineImage key={path} href={path} label={baseName(path)} />)}</View><View style={styles.hostFiles}>
    {paths.map(path => <PressScale key={path} accessibilityRole="button" accessibilityLabel={`Send ${baseName(path)} to phone`} onPress={() => confirm(path)} disabled={busy !== null} style={styles.hostFile}>
      <Feather name={busy === path ? "loader" : "smartphone"} size={13} color={colors.gold} />
      <Text style={styles.hostFileName} numberOfLines={1}>{baseName(path)}</Text>
      <Text style={styles.hostFileAction}>Send to phone</Text>
    </PressScale>)}
  </View></>;
}

const styles = StyleSheet.create({
  disclosure: { borderLeftWidth: 1, borderColor: colors.hair, marginTop: 2 },
  disclosureButton: { flexDirection: "row", alignItems: "center", minHeight: 44, gap: 6, paddingHorizontal: 6 },
  disclosureLabel: { ...type.small, color: colors.textMuted, flexShrink: 1 },
  detailText: { ...type.mono, color: colors.textMuted, padding: 8 },
  sentFiles: { gap: 6 },
  sentFilesSpaced: { marginBottom: 8 },
  sentFile: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 260 },
  sentName: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.text, flexShrink: 1 },
  sentSize: { ...type.mono, color: colors.textTertiary },
  hostFiles: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  hostFile: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, maxWidth: "100%", paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: glass.fillChip, borderWidth: 1, borderColor: glass.hair, borderTopColor: glass.highlight },
  hostFileName: { ...type.mono, color: colors.textMuted, flexShrink: 1 },
  hostFileAction: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: colors.gold },
  userRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: space.lg,
    paddingVertical: 6,
  },
  bubble: {
    maxWidth: "82%",
    backgroundColor: colors.bubble,
    borderRadius: radius.lg,
    borderBottomRightRadius: 8,
    borderWidth: 1,
    borderColor: colors.hair,
    borderTopColor: "rgba(255,255,255,.18)",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: { color: colors.text, ...type.body },
  assistantRow: { paddingHorizontal: space.lg, paddingVertical: 6 },
  assistantText: { color: colors.text, ...type.body },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, minHeight: 22 },
  statusText: { color: colors.textTertiary, ...type.mono, flexShrink: 1 },
  noteText: { color: colors.textMuted, ...type.small, flexShrink: 1 },
  errorText: { color: colors.danger, ...type.small, flexShrink: 1 },
});
