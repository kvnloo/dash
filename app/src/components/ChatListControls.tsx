import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { CHAT_DATES, CHAT_SORTS, DEFAULT_CHAT_FILTERS, type ChatFilters } from "../lib/chat-filters";
import type { BottomActionOption } from "../lib/bottom-action-sheet";
import { colors, radius, space, type } from "../theme";
import { BottomActionSheet } from "./BottomActionSheet";
import { PressScale } from "./PressScale";

type FilterMenu = "harness" | "project" | "date" | "sort";
const TITLES: Record<FilterMenu, string> = { harness: "Harness", project: "Project", date: "Updated date", sort: "Sort chats" };
const SORT_LABELS: Record<ChatFilters["sort"], string> = { recent: "Recent", oldest: "Oldest", priority: "Priority" };

export function ChatListControls({ filters, harnesses, projects, onChange, onProjectsOpen, loading, count }: {
  filters: ChatFilters;
  harnesses: readonly { id: string; label: string }[];
  projects: readonly string[];
  onChange(filters: ChatFilters): void;
  onProjectsOpen(open: boolean): void;
  loading: boolean;
  count: number;
}) {
  const [menu, setMenu] = useState<FilterMenu | null>(null);
  const harnessLabel = harnesses.find(h => h.id === filters.harness)?.label ?? filters.harness;
  const projectLabel = filters.project?.split("/").filter(Boolean).at(-1) ?? filters.project;
  const dateLabel = CHAT_DATES.find(d => d.id === filters.date)?.label ?? "Any date";
  const changed = filters.harness !== null || filters.project !== null || filters.date !== "all" || filters.sort !== "recent";
  const controls: { id: FilterMenu; label: string; value: string; active: boolean }[] = [
    { id: "harness", label: harnessLabel ?? "Harness", value: harnessLabel ?? "All harnesses", active: filters.harness !== null },
    { id: "project", label: projectLabel ?? "Project", value: filters.project ?? "All projects", active: filters.project !== null },
    { id: "date", label: filters.date === "all" ? "Dates" : dateLabel, value: dateLabel, active: filters.date !== "all" },
    { id: "sort", label: SORT_LABELS[filters.sort], value: SORT_LABELS[filters.sort], active: filters.sort !== "recent" },
  ];
  const values = menu === "harness" ? [{ id: "", label: "All harnesses" }, ...harnesses]
    : menu === "project" ? [{ id: "", label: "All projects" }, ...projects.map(path => ({ id: path, label: path }))]
    : menu === "date" ? CHAT_DATES : CHAT_SORTS;
  const selected = menu === "harness" ? filters.harness ?? "" : menu === "project" ? filters.project ?? "" : menu === "date" ? filters.date : filters.sort;
  const options: BottomActionOption[] = values.map(value => ({
    id: value.id, label: `${value.label}${value.id === selected ? " · Selected" : ""}`,
    accessibilityLabel: `${value.label}${value.id === selected ? ", selected" : ""}`, destructive: false,
  }));
  const close = () => { setMenu(null); onProjectsOpen(false); };
  const select = (id: string) => {
    if (menu === "harness") onChange({ ...filters, harness: id === "" ? null : id });
    else if (menu === "project") onChange({ ...filters, project: id === "" ? null : id });
    else if (menu === "date") {
      const date = CHAT_DATES.find(value => value.id === id);
      if (date) onChange({ ...filters, date: date.id });
    } else if (menu === "sort") {
      const sort = CHAT_SORTS.find(value => value.id === id);
      if (sort) onChange({ ...filters, sort: sort.id });
    }
    close();
  };
  return <View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.controls}>
      {controls.map(control => <PressScale
        key={control.id} testID={`chat-filter-${control.id}`} accessibilityRole="button"
        accessibilityLabel={`${TITLES[control.id]}, ${control.value}`}
        accessibilityState={{ expanded: menu === control.id }}
        onPress={() => { setMenu(control.id); onProjectsOpen(control.id === "project"); }}
        style={[styles.control, control.active && styles.selected]}
      >
        <Text numberOfLines={1} style={[styles.controlText, control.active && styles.selectedText]}>{control.label}</Text>
        <Feather name={control.id === "sort" ? "arrow-down" : "chevron-down"} size={12} color={control.active ? colors.text : colors.textMuted} />
      </PressScale>)}
    </ScrollView>
    {(changed || loading) && <View style={styles.summary}>
      <Text style={styles.summaryText} accessibilityLiveRegion="polite">{count} chat{count === 1 ? "" : "s"}{loading ? " · Searching history…" : ""}</Text>
      {changed && <PressScale testID="chat-filters-reset" accessibilityRole="button" accessibilityLabel="Reset chat filters and sort" onPress={() => onChange(DEFAULT_CHAT_FILTERS)} style={styles.reset}>
        <Text style={styles.resetText}>Reset</Text>
      </PressScale>}
    </View>}
    {filters.sort === "priority" && <Text style={styles.explanation}>Needs attention, then running, then recent. Ended chats last.</Text>}
    <BottomActionSheet open={menu !== null} title={menu ? `${TITLES[menu]}${menu === "project" && loading ? " · Loading…" : ""}` : "Filters"} options={options} onSelect={select} onClose={close} />
  </View>;
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: space.lg, gap: space.sm, paddingVertical: space.xs },
  control: { minHeight: 44, maxWidth: 160, paddingHorizontal: space.sm, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hair, flexDirection: "row", alignItems: "center", gap: space.xs },
  selected: { backgroundColor: colors.surfaceRaised, borderColor: colors.textMuted },
  controlText: { ...type.small, color: colors.textMuted, flexShrink: 1 },
  selectedText: { color: colors.text },
  summary: { paddingLeft: space.lg, paddingRight: space.sm, flexDirection: "row", alignItems: "center", minHeight: 44 },
  summaryText: { ...type.small, color: colors.textMuted, flex: 1 },
  reset: { minHeight: 44, minWidth: 60, alignItems: "center", justifyContent: "center" },
  resetText: { ...type.small, color: colors.text },
  explanation: { ...type.small, color: colors.textMuted, paddingHorizontal: space.lg, paddingBottom: space.sm },
});
