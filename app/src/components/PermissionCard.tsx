import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  canChoosePermissionOption,
  dispatchPermissionChoice,
  formatPermissionDeadline,
  groupPermissionOptions,
  permissionStatus,
  type PermissionCardOption,
  type PermissionCardPhase,
} from "../lib/permission-card";
import { colors, glass, radius, space } from "../theme";

export type PermissionCardProps = Readonly<{
  requestId: string;
  turnId: string;
  /** Host-sanitized, bounded display context; do not pass raw credentials. */
  displayContext?: string;
  options: readonly PermissionCardOption[];
  deadlineAt: number;
  phase: PermissionCardPhase;
  /** An exact ACP optionId. Rejection or a false send receipt unlocks retry. */
  onChoose: (optionId: string) => void | Promise<unknown>;
}>;

/**
 * Inline Needs OK blocker. Not mounted into the chat surface here: Hermes owns
 * MessageRow/ChatScreen and binds these props to the permission store.
 * No store, socket, or implicit approval path exists inside this component.
 */
export function PermissionCard({
  requestId,
  turnId,
  displayContext,
  options,
  deadlineAt,
  phase,
  onChoose,
}: PermissionCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const key = JSON.stringify([turnId, requestId]);

  useEffect(() => {
    setNow(Date.now());
    if (phase !== "pending") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadlineAt, phase, requestId, turnId]);

  useEffect(() => {
    busyRef.current = null;
    setBusyKey(null);
    setFailedKey(null);
  }, [key]);

  useEffect(() => {
    if (phase !== "pending") {
      busyRef.current = null;
      setBusyKey(null);
      setFailedKey(null);
    }
  }, [phase]);

  const groups = groupPermissionOptions(options);
  const noChoices = !groups.valid || (groups.approve.length === 0 && groups.deny.length === 0);
  const expired = !Number.isFinite(deadlineAt) || now >= deadlineAt;
  const locallyBusy = busyKey === key;
  const status = failedKey === key && phase === "pending"
    ? "Decision not sent · try again"
    : locallyBusy && phase === "pending"
      ? "Submitting decision · awaiting host confirmation"
      : permissionStatus(phase, deadlineAt, now);

  function onPressOption(optionId: string): void {
    if (busyRef.current === key) return;

    const failed = () => {
      if (busyRef.current !== key) return;
      busyRef.current = null;
      setBusyKey(null);
      setFailedKey(key);
    };

    dispatchPermissionChoice(options, phase, deadlineAt, Date.now(), optionId, exactId => {
      busyRef.current = key;
      setBusyKey(key);
      setFailedKey(null);
      try {
        const sending = onChoose(exactId);
        void Promise.resolve(sending).then(result => { if (result === false) failed(); }, failed);
      } catch {
        failed();
      }
    });
  }

  function choice(option: PermissionCardOption, group: "Approve" | "Deny") {
    const disabled = locallyBusy
      || !canChoosePermissionOption(options, phase, deadlineAt, now, option.optionId);
    return (
      <Pressable
        key={option.optionId}
        testID={"permission-choice-" + option.optionId}
        accessibilityRole="button"
        accessibilityLabel={group + " · " + option.name}
        accessibilityHint="Send this exact choice. Permission is not granted until the host confirms."
        accessibilityState={{ disabled, busy: locallyBusy || phase === "deciding" }}
        disabled={disabled}
        onPress={() => onPressOption(option.optionId)}
        style={({ pressed }) => [
          styles.choice,
          group === "Deny" && styles.denyChoice,
          disabled && styles.choiceDisabled,
          pressed && !disabled && styles.choicePressed,
        ]}
      >
        <Text style={[styles.choiceText, group === "Deny" && styles.denyText]}>{option.name}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.card} testID={"permission-card-" + requestId}>
      <Text accessibilityRole="header" style={styles.heading}>Needs OK</Text>
      <Text style={styles.context} selectable>
        {displayContext?.trim() || "The agent requests permission to continue."}
      </Text>
      <View style={styles.statusRow}>
        <Text
          testID="permission-status"
          accessibilityLiveRegion="polite"
          style={[styles.status, phase === "allowed" && styles.allowed, (phase === "denied" || phase === "timeout") && styles.denied]}
        >
          {status}
        </Text>
        {(phase === "pending" || phase === "deciding" || phase === "expired") ? (
          <Text style={styles.deadline} testID="permission-deadline">
            {formatPermissionDeadline(deadlineAt, now)}
          </Text>
        ) : null}
      </View>

      {groups.approve.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Approve</Text>
          <View style={styles.actions}>{groups.approve.map(option => choice(option, "Approve"))}</View>
        </View>
      ) : null}
      {groups.deny.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Deny</Text>
          <View style={styles.actions}>{groups.deny.map(option => choice(option, "Deny"))}</View>
        </View>
      ) : null}

      {noChoices ? (
        <Text style={styles.caution} accessibilityRole="alert">
          No supported choices. The host must deny this request.
        </Text>
      ) : groups.unsupported.length > 0 ? (
        <Text style={styles.caution}>
          Some offered choices are unsupported and cannot be selected.
        </Text>
      ) : null}
      {expired && phase === "pending" ? (
        <Text style={styles.caution}>
          No further choice can be sent. Await host resolution.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginVertical: space.sm,
    padding: space.lg,
    gap: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.hair2,
    borderTopColor: glass.highlight,
    backgroundColor: glass.fillRaised,
  },
  heading: { color: colors.text, fontSize: 17, lineHeight: 23, fontWeight: "600" },
  context: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  statusRow: { gap: space.xs },
  status: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  allowed: { color: colors.ok },
  denied: { color: colors.danger },
  deadline: { color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
  group: { gap: space.sm },
  groupLabel: { color: colors.textMuted, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  // Static pressed-color feedback has no animation, including with reduced motion.
  choice: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.hair2,
    backgroundColor: glass.fillChip,
  },
  denyChoice: { borderColor: glass.hair },
  choicePressed: { backgroundColor: glass.fillChipOn },
  choiceDisabled: { opacity: 0.45 },
  choiceText: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  denyText: { color: colors.danger },
  caution: { color: colors.warn, fontSize: 12, lineHeight: 18 },
});
