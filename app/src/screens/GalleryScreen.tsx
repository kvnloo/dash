import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { EphemeralCard } from "../components/genui/EphemeralCard";
import { ScreenHeader } from "../components/ScreenHeader";
import { haptic } from "../haptics";
import type { EphemeralCardSpec } from "../lib/ephemeral-card";
import { catalogLabel, ephemeralCatalog, type CatalogFixture } from "../lib/ephemeral-catalog";
import { galleryPageOf, GALLERY_PAGE_SIZE, galleryPages, propsDiff, type GalleryResult } from "../lib/gallery";
import type { ScreenProps } from "../navigation";
import { colors, fonts, radius, space, type } from "../theme";

/**
 * Card gallery: every fixture of every kind in the shared kvnloo/ephemeral-ui catalog, drawn by the vendored kit,
 * a page at a time. Each cell says whether the card mounted and whether its props equal the catalog's.
 */
export function GalleryScreen({ navigation, route }: ScreenProps<"Gallery">) {
  const catalog = useMemo(() => ephemeralCatalog(), []);
  const pages = galleryPages(catalog.fixtures.length);
  const [page, setPage] = useState(() => Math.min(pages, Math.max(1, Math.trunc(Number(route.params?.page ?? 1)) || 1)));
  const [results, setResults] = useState<Record<string, GalleryResult>>({});
  const scroll = useRef<ScrollView>(null);
  const start = (page - 1) * GALLERY_PAGE_SIZE;
  const cells = catalog.fixtures.slice(start, start + GALLERY_PAGE_SIZE);
  const go = useCallback((next: number) => {
    const p = Math.min(pages, Math.max(1, next));
    haptic.select();
    setPage(p);
    navigation.setParams({ page: p });
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [navigation, pages]);
  const onResult = useCallback((id: string, result: GalleryResult) => setResults(r => ({ ...r, [id]: result })), []);
  const groups = useMemo(() => [...new Set(catalog.kinds.map(k => k.group))], [catalog]);
  const done = cells.filter(f => results[f.id]).length;
  const matched = cells.filter(f => results[f.id]?.match).length;
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScreenHeader title="Card gallery" compact onBack={() => navigation.goBack()} />
      <ScrollView ref={scroll} contentContainerStyle={styles.scroll} testID="gallery-scroll">
        <Text style={styles.version} testID="gallery-version">{catalogLabel(catalog)} · {catalog.kinds.length} kinds · {catalog.fixtures.length} fixtures</Text>
        <Pager page={page} pages={pages} go={go} where="top" />
        <Text style={styles.meta} role="status" testID="gallery-page-status">
          Fixtures {start + 1}–{start + cells.length} of {catalog.fixtures.length} · {done}/{cells.length} drawn · {matched}/{cells.length} props match catalog
        </Text>
        {cells.map(fixture => <GalleryCell key={fixture.id} fixture={fixture} at={catalog.generatedAt} result={results[fixture.id]} onResult={onResult} />)}
        <Pager page={page} pages={pages} go={go} where="bottom" />
        <Text style={styles.heading} accessibilityRole="header">Every kind</Text>
        {groups.map(group => (
          <View key={group} style={styles.group} testID={`gallery-group-${group}`}>
            <Text style={styles.label}>{group}</Text>
            <View style={styles.chips}>
              {catalog.kinds.filter(k => k.group === group).map(k => {
                const first = k.fixtures[0];
                const at = first ? galleryPageOf(catalog.fixtures.indexOf(first)) : 1;
                return <Pressable key={k.kind} accessibilityRole="button" accessibilityLabel={`${k.kind}, ${k.fixtures.length} ${k.fixtures.length === 1 ? "fixture" : "fixtures"}, page ${at}`}
                  testID={`gallery-kind-${k.kind}`} onPress={() => go(at)} style={({ pressed }) => [styles.chip, at === page && styles.chipOn, pressed && styles.pressed]}>
                  <Text style={[styles.chipText, at === page && styles.chipTextOn]}>{k.kind} · {k.fixtures.length}</Text>
                </Pressable>;
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Pager({ page, pages, go, where }: { page: number; pages: number; go: (p: number) => void; where: string }) {
  return <View style={styles.pager} testID={`gallery-pager-${where}`}>
    <Pressable accessibilityRole="button" accessibilityLabel="Previous gallery page" accessibilityState={{ disabled: page <= 1 }} disabled={page <= 1} onPress={() => go(page - 1)} style={[styles.pageButton, page <= 1 && styles.disabled]}>
      <Text style={styles.pageText}>Prev</Text>
    </Pressable>
    <Text style={styles.pageOf}>Page {page} of {pages}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Next gallery page" accessibilityState={{ disabled: page >= pages }} disabled={page >= pages} onPress={() => go(page + 1)} style={[styles.pageButton, page >= pages && styles.disabled]}>
      <Text style={styles.pageText}>Next</Text>
    </Pressable>
  </View>;
}

const GalleryCell = memo(function GalleryCell({ fixture, at, result, onResult }: { fixture: CatalogFixture; at: string; result?: GalleryResult; onResult: (id: string, r: GalleryResult) => void }) {
  const spec = useMemo<EphemeralCardSpec>(() => ({ kind: fixture.kind, app: fixture.app, fixture: { id: fixture.id, seed: fixture.seed, input: fixture.input, at } }), [fixture, at]);
  const onDrawn = useCallback(({ ok, props }: { ok: boolean; props: string | null }) => {
    onResult(fixture.id, { ok, match: ok && props === fixture.props, diff: ok && props !== null ? propsDiff(fixture.props, props) : [] });
  }, [fixture, onResult]);
  const status = !result ? "Drawing…" : !result.ok ? "Could not be drawn" : result.match ? "Mounted · props match catalog" : `Mounted · props differ from catalog: ${result.diff.join(", ") || "?"}`;
  return <View style={styles.cell} testID={`gallery-cell-${fixture.id}`}>
    <View style={styles.cellHead}>
      <Text style={styles.cellId} numberOfLines={1}>{fixture.id}</Text>
      <Text style={[styles.badge, fixture.state === "unavailable" && styles.badgeWarn]}>{fixture.state}</Text>
    </View>
    <EphemeralCard spec={spec} title={`fixture ${fixture.id}`} source={`catalog fixture ${fixture.id} · ${fixture.state}`} onDrawn={onDrawn} />
    <Text testID={`gallery-status-${fixture.id}`} style={[styles.meta, result?.ok === false || (result && !result.match) ? styles.bad : result?.match ? styles.good : null]}>{status}</Text>
  </View>;
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: space.lg, paddingBottom: 120, gap: space.md },
  version: { fontFamily: fonts.mono, fontSize: 12, color: colors.textMuted },
  meta: { ...type.small, color: colors.textMuted },
  good: { color: colors.ok },
  bad: { color: colors.danger },
  heading: { ...type.heading, color: colors.text, marginTop: space.lg },
  label: { ...type.label, color: colors.textTertiary, textTransform: "uppercase" },
  group: { gap: space.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  chip: { minHeight: 32, justifyContent: "center", paddingHorizontal: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.gold },
  chipText: { ...type.small, color: colors.textMuted },
  chipTextOn: { color: colors.gold },
  pressed: { opacity: 0.7 },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  pageButton: { minHeight: 44, minWidth: 72, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.gold },
  pageText: { ...type.body, color: colors.gold },
  pageOf: { ...type.body, color: colors.text },
  disabled: { opacity: 0.35 },
  cell: { gap: space.xs, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  cellHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  cellId: { flex: 1, fontFamily: fonts.mono, fontSize: 12, color: colors.text },
  badge: { ...type.label, color: colors.textMuted },
  badgeWarn: { color: colors.warn },
});
