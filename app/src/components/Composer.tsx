import { Feather } from "@expo/vector-icons";
import { memo, useCallback, useState } from "react";
import { Alert, StyleSheet, TextInput, View } from "react-native";
import { colors, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { PressScale } from "./PressScale";
interface Props { disabled: boolean; streaming: boolean; placeholder: string; initialText?: string; onSend(text: string): void; onStop(): void; onVoice(): void }
export const Composer = memo(function Composer({ disabled, streaming, placeholder, initialText, onSend, onStop, onVoice }: Props) {
 const [text, setText] = useState(initialText ?? "");
 const canSend = text.trim().length > 0 && !disabled;
 const submit = useCallback(() => { const value = text.trim(); if (!value || disabled) return; setText(""); onSend(value); }, [text, disabled, onSend]);
 return <View style={styles.wrap}><GlassSurface blur borderRadius={18} contentStyle={styles.field}>
   <TextInput style={styles.input} value={text} onChangeText={setText} placeholder={placeholder} placeholderTextColor={colors.textFaint} multiline={false} numberOfLines={1} keyboardAppearance="dark" autoCapitalize="sentences" onSubmitEditing={submit} accessibilityLabel="Message" />
   <View style={styles.controls}>
     <PressScale accessibilityRole="button" accessibilityLabel="Attach file" onPress={() => Alert.alert("Attachments", "File attachments are not supported by this bridge yet.")} style={styles.hit}><Feather name="paperclip" size={18} color={colors.textMuted} /></PressScale>
     <PressScale accessibilityRole="button" accessibilityLabel="Voice input" onPress={onVoice} style={styles.hit}><Feather name="mic" size={18} color={colors.textMuted} /></PressScale>
     <PressScale accessibilityRole="button" accessibilityLabel={streaming ? "Stop" : "Send"} onPress={streaming ? onStop : submit} disabled={!streaming && !canSend} style={styles.hit}><View style={[styles.send, streaming && styles.stop, !streaming && !canSend && styles.disabled]}>{streaming ? <View style={styles.square} /> : <Feather name="arrow-up" size={20} color={colors.onAccent} />}</View></PressScale>
   </View>
 </GlassSurface></View>;
});
const styles = StyleSheet.create({ wrap: { paddingHorizontal: 12, paddingTop: 8 }, field: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, minHeight: 60 }, input: { flex: 1, minWidth: 0, ...type.body, color: colors.text, paddingLeft: 8, paddingVertical: 12 }, controls: { flexDirection: "row", alignItems: "center", flexShrink: 0 }, hit: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, send: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" }, stop: { backgroundColor: colors.text }, disabled: { opacity: .3 }, square: { width: 12, height: 12, borderRadius: 2, backgroundColor: colors.bg } });
