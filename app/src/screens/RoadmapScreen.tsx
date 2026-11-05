// The Roadmap: projects, features and tasks the repositories track in git (pm/events.jsonl, shared/pm.ts),
// in the Tern pane's minimal order and Dash's Living Night language: what waits on the owner first,
// then what runs now, then the projects. Gold is only the selection rail; colour is only status.
import { useMemo, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas } from "../components/Canvas";
import { ScreenHeader } from "../components/ScreenHeader";
import { screenBack } from "../lib/screen-back";
import type { ScreenProps } from "../navigation";
import { ancestors, byAttention, features, pmPrUrl, progressUnder, projects, tasksUnder, type PmIssue, type PmState } from "../../../shared/pm";
import { pm, refreshPm, usePmRefresh } from "../store/pm";
import { colors, controlMin, fonts, radius, space, type } from "../theme";

const STATE_LABEL: Record<PmState, string> = { running: "Running", blocked: "Blocked", review: "In review", todo: "To do", done: "Done" };
const STATE_TONE: Record<PmState, string> = { running: colors.information, blocked: colors.danger, review: colors.provenance, todo: colors.textTertiary, done: colors.ok };

function percentOf(issue: PmIssue): number { return issue.state === "done" ? 100 : issue.progress ?? 0; }

function Meter({ value, tone = colors.textMuted }: { value: number; tone?: string }) {
  return <View accessible={false} style={styles.meter}><View style={[styles.meterFill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: tone }]} /></View>;
}

function SectionHead({ title, count, hint }: { title: string; count: number; hint?: string }) {
  return <View style={styles.head} accessibilityRole="header" accessibilityLabel={`${title}, ${count}`}>
    <Text style={styles.label}>{title.toUpperCase()}</Text>
    <Text style={styles.count}>{count}</Text>
    {hint ? <Text style={styles.hint} numberOfLines={1}>{hint}</Text> : null}
  </View>;
}

function TaskRow({ issue, where, onPress }: { issue: PmIssue; where?: string; onPress(): void }) {
  const percent = percentOf(issue);
  const meta = [issue.priority, STATE_LABEL[issue.state], where, issue.kanban ? `Hermes ${issue.kanban.status}` : undefined].filter(Boolean).join(" · ");
  return <Pressable testID={`pm-task-${issue.id}`} accessibilityRole="button" accessibilityLabel={`${issue.title}, ${STATE_LABEL[issue.state]}${issue.attention === "you" ? ", waits on you" : ""}`}
    onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
    <View style={[styles.dot, { backgroundColor: issue.attention === "you" ? colors.warn : STATE_TONE[issue.state] }]} />
    <View style={styles.rowMain}>
      <Text style={styles.rowTitle} numberOfLines={2}>{issue.title}</Text>
      <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text>
    </View>
    <View style={styles.rowEnd}>
      <Text style={styles.pct}>{percent}%</Text>
      <Meter value={percent} tone={issue.state === "done" ? colors.ok : colors.textMuted} />
    </View>
  </Pressable>;
}

function Status() {
  const { doc, error, loading } = pm.use(s => s);
  if (error && !doc) return <Text accessibilityRole="alert" style={styles.error}>{error}</Text>;
  if (!doc) return <Text style={styles.help}>{loading ? "Loading the roadmap…" : "No roadmap yet."}</Text>;
  const skipped = doc.repos.reduce((n, r) => n + r.errors.length, 0);
  return <>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {skipped ? <Text testID="pm-ledger-errors" style={styles.help}>{skipped} ledger line{skipped === 1 ? "" : "s"} skipped: {doc.repos.flatMap(r => r.errors).slice(0, 3).join(" · ")}</Text> : null}
  </>;
}

/** Roadmap home: waiting on you, running now, projects. */
export function RoadmapScreen({ navigation }: ScreenProps<"Roadmap">) {
  usePmRefresh();
  const insets = useSafeAreaInsets();
  const { doc, loading } = pm.use(s => s);
  const issues = doc?.issues ?? [];
  const tasks = issues.filter(i => i.type === "task" || i.type === "defect");
  const you = tasks.filter(i => i.attention === "you" && i.state !== "done").sort(byAttention);
  const running = tasks.filter(i => i.state === "running" && i.attention !== "you").sort(byAttention);
  const list = projects(issues);
  const overall = tasks.length ? Math.round(tasks.reduce((n, t) => n + percentOf(t), 0) / tasks.length) : undefined;
  const open = (id: string) => navigation.navigate("RoadmapTask", { taskId: id });
  return <View style={[styles.screen, { paddingTop: insets.top }]}>
    <Canvas /><ScreenHeader title="Roadmap" onBack={() => screenBack(navigation)} onAction={() => void refreshPm()} action="Refresh roadmap" icon="refresh-cw" />
    <ScrollView testID="roadmap-screen" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refreshPm()} tintColor={colors.textMuted} />}>
      <View style={styles.top}>
        {overall !== undefined ? <Text style={styles.overall}>{overall}% proven</Text> : null}
        <Text style={styles.hint} numberOfLines={1}>{tasks.length} tasks · {doc?.kanban === "live" ? "Hermes live" : doc?.kanban === "unavailable" ? "Hermes unavailable" : "from git"}</Text>
      </View>
      <Status />
      {you.length ? <><SectionHead title="Waiting on you" count={you.length} hint="blocks progress" />{you.map(t => <TaskRow key={t.id} issue={t} where={t.next} onPress={() => open(t.id)} />)}</> : null}
      {running.length ? <><SectionHead title="Running now" count={running.length} />{running.map(t => <TaskRow key={t.id} issue={t} onPress={() => open(t.id)} />)}</> : null}
      <SectionHead title="Projects" count={list.length} />
      {list.map(project => {
        const p = progressUnder(issues, project.id);
        const n = features(issues, project.id).length;
        return <Pressable key={project.id} testID={`pm-project-${project.id}`} accessibilityRole="button" accessibilityLabel={`${project.title}, ${p.done} of ${p.total} tasks done`}
          onPress={() => navigation.navigate("RoadmapProject", { projectId: project.id })} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
          <View style={styles.rowMain}>
            <Text style={styles.projectTitle} numberOfLines={1}>{project.title}</Text>
            <Text style={styles.rowMeta} numberOfLines={1}>{n} feature{n === 1 ? "" : "s"} · {p.done}/{p.total} done · {project.repo}</Text>
          </View>
          <View style={styles.rowEnd}><Text style={styles.pct}>{p.percent}%</Text><Meter value={p.percent} /></View>
        </Pressable>;
      })}
      {doc && !list.length ? <Text style={styles.help}>No projects. Add them to a repository's pm/events.jsonl.</Text> : null}
    </ScrollView>
  </View>;
}

/** One project: feature filter, then every task in the chosen feature. */
export function RoadmapProjectScreen({ navigation, route }: ScreenProps<"RoadmapProject">) {
  usePmRefresh();
  const insets = useSafeAreaInsets();
  const doc = pm.use(s => s.doc);
  const [feature, setFeature] = useState<string | null>(route.params.feature ?? null);
  const issues = useMemo(() => doc?.issues ?? [], [doc]);
  const project = issues.find(i => i.id === route.params.projectId);
  const list = project ? features(issues, project.id) : [];
  const featureOf = (task: PmIssue) => list.find(f => tasksUnder(issues, f.id).some(t => t.id === task.id));
  const all = project ? tasksUnder(issues, project.id) : [];
  const shown = feature ? tasksUnder(issues, feature) : all;
  const chip = (id: string | null, label: string, count: number) => {
    const selected = feature === id;
    return <Pressable key={id ?? "all"} testID={`pm-feature-${id ?? "all"}`} accessibilityRole="button" accessibilityState={{ selected }} aria-selected={selected}
      accessibilityLabel={`${id ? `Feature ${label}` : "All features"}, ${count} tasks`} onPress={() => setFeature(id)}
      style={[styles.chip, selected && styles.chipOn]}>
      <Text style={[styles.chipText, selected && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
      <Text style={styles.chipCount}>{count}</Text>
    </Pressable>;
  };
  return <View style={[styles.screen, { paddingTop: insets.top }]}>
    <Canvas /><ScreenHeader title={project?.title ?? "Project"} onBack={() => screenBack(navigation)} onAction={() => void refreshPm()} action="Refresh roadmap" icon="refresh-cw" />
    <ScrollView testID="roadmap-project" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}>
      <Status />
      {project ? <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel="Filter by feature">
          {chip(null, "All", all.length)}
          {list.map(f => chip(f.id, f.title, tasksUnder(issues, f.id).length))}
        </ScrollView>
        <SectionHead title={feature ? list.find(f => f.id === feature)?.title ?? "Feature" : "All tasks"} count={shown.length} hint="running and blocked first" />
        {shown.map(t => <TaskRow key={t.id} issue={t} where={feature ? undefined : featureOf(t)?.title} onPress={() => navigation.navigate("RoadmapTask", { taskId: t.id })} />)}
        {!shown.length ? <Text style={styles.help}>No tasks in this feature yet.</Text> : null}
      </> : doc ? <Text style={styles.help}>This project is no longer in the roadmap.</Text> : null}
    </ScrollView>
  </View>;
}

function Fact({ id, label, value, tone }: { id: string; label: string; value: string; tone?: string }) {
  return <View testID={`pm-fact-${id}`} style={styles.fact} accessible accessibilityLabel={`${label}: ${value}`}>
    <Text style={styles.factLabel}>{label}</Text>
    <Text selectable style={[styles.factValue, tone ? { color: tone } : null]}>{value}</Text>
  </View>;
}

/** One task: status, progress, evidence, next, PR, assignee and its live Hermes card. */
export function RoadmapTaskScreen({ navigation, route }: ScreenProps<"RoadmapTask">) {
  usePmRefresh();
  const insets = useSafeAreaInsets();
  const doc = pm.use(s => s.doc);
  const issues = doc?.issues ?? [];
  const task = issues.find(i => i.id === route.params.taskId);
  const path = task ? ancestors(issues, task) : [];
  const url = task ? pmPrUrl(task) : undefined;
  return <View style={[styles.screen, { paddingTop: insets.top }]}>
    <Canvas /><ScreenHeader title="Task" compact onBack={() => screenBack(navigation)} onAction={() => void refreshPm()} action="Refresh roadmap" icon="refresh-cw" />
    <ScrollView testID="pm-task-detail" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}>
      <Status />
      {task ? <>
        <Text style={styles.crumbs} numberOfLines={2}>{path.map(p => p.title).join("  ›  ")}</Text>
        <Text selectable style={styles.taskTitle} accessibilityRole="header">{task.title}</Text>
        <View style={styles.pills}>
          <Text style={[styles.pill, { color: STATE_TONE[task.state], borderColor: STATE_TONE[task.state] }]}>{STATE_LABEL[task.state]}</Text>
          {task.priority ? <Text style={styles.pill}>{task.priority}</Text> : null}
          {task.attention === "you" ? <Text style={[styles.pill, { color: colors.warn, borderColor: colors.warn }]}>Waits on you</Text> : null}
        </View>
        <Fact id="status" label="Status" value={STATE_LABEL[task.state]} tone={STATE_TONE[task.state]} />
        <View testID="pm-fact-progress" style={styles.fact} accessible accessibilityLabel={`Progress: ${percentOf(task)}%`}>
          <Text style={styles.factLabel}>Progress</Text>
          <View style={styles.progressRow}><Text style={styles.factValue}>{percentOf(task)}%</Text><View style={styles.progressBar}><Meter value={percentOf(task)} tone={task.state === "done" ? colors.ok : colors.textMuted} /></View></View>
        </View>
        {task.evidence ? <Fact id="evidence" label="Evidence" value={task.evidence} /> : null}
        {task.next ? <Fact id="next" label="Next" value={task.next} /> : null}
        {task.detail ? <Fact id="detail" label="Detail" value={task.detail} /> : null}
        <Fact id="assignee" label="Assignee" value={task.assignee ?? task.kanban?.assignee ?? "Unassigned"} />
        {task.hermes ? <Fact id="hermes" label="Hermes kanban" value={task.kanban ? `${task.hermes} · ${task.kanban.status}${task.kanban.assignee ? ` · ${task.kanban.assignee}` : ""}` : `${task.hermes} · status ${doc?.kanban === "live" ? "not on the board" : "unavailable"}`} tone={task.kanban ? STATE_TONE[task.state] : undefined} /> : null}
        {url ? <Pressable testID="pm-fact-pr" accessibilityRole="link" accessibilityLabel={`Open pull request ${url}`} onPress={() => void Linking.openURL(url)} style={styles.fact}>
          <Text style={styles.factLabel}>Pull request</Text>
          <Text style={[styles.factValue, styles.link]} numberOfLines={1}>{url.replace("https://github.com/", "")}</Text>
        </Pressable> : null}
        <Fact id="source" label="Tracked in" value={`${task.repo} · pm/events.jsonl${task.live?.length ? ` · live: ${task.live.map(s => s === "hermes" ? "Hermes board" : s === "roadmap" ? "roadmap file" : s).join(", ")}` : ""}`} />
        {task.updatedAt ? <Fact id="updated" label="Updated" value={new Date(task.updatedAt).toLocaleString()} /> : null}
      </> : doc ? <Text style={styles.help}>This task is no longer in the roadmap.</Text> : null}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg, gap: space.xs },
  top: { flexDirection: "row", alignItems: "baseline", gap: space.sm, paddingVertical: space.sm },
  overall: { ...type.number, color: colors.text },
  hint: { ...type.small, color: colors.textTertiary, flexShrink: 1 },
  help: { ...type.small, color: colors.textMuted, paddingVertical: space.xs },
  error: { ...type.small, color: colors.danger, paddingVertical: space.xs },
  head: { flexDirection: "row", alignItems: "baseline", gap: space.sm, paddingTop: space.lg, paddingBottom: space.xs },
  label: { ...type.label, color: colors.textMuted },
  count: { ...type.label, color: colors.textTertiary, fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: controlMin + 12, paddingVertical: space.sm, paddingLeft: space.sm, borderLeftWidth: 2, borderLeftColor: "transparent", borderRadius: radius.sm },
  rowPressed: { borderLeftColor: colors.gold, backgroundColor: colors.surfaceRaised },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { ...type.body, color: colors.text },
  projectTitle: { ...type.cardTitle, color: colors.text },
  rowMeta: { ...type.small, color: colors.textTertiary },
  rowEnd: { width: 64, alignItems: "flex-end", gap: 4 },
  pct: { ...type.small, color: colors.textMuted, fontVariant: ["tabular-nums"] },
  meter: { alignSelf: "stretch", height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" },
  meterFill: { height: 4, borderRadius: 2 },
  chips: { gap: space.sm, paddingVertical: space.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: controlMin, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.gold },
  chipText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.textMuted, maxWidth: 220 },
  chipTextOn: { color: colors.text },
  chipCount: { ...type.small, color: colors.textTertiary, fontVariant: ["tabular-nums"] },
  crumbs: { ...type.small, color: colors.textTertiary, paddingTop: space.sm },
  taskTitle: { ...type.title, color: colors.text, paddingVertical: space.xs },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingBottom: space.sm },
  pill: { ...type.label, color: colors.textMuted, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  fact: { gap: 2, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  factLabel: { ...type.label, color: colors.textTertiary },
  factValue: { ...type.body, color: colors.text },
  link: { color: colors.information },
  progressRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  progressBar: { flex: 1 },
});
