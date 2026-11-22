import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EphemeralCard } from "../components/genui/EphemeralCard";
import { ScreenHeader } from "../components/ScreenHeader";
import { glide, glidePalette, type GlideScheme } from "../lib/glide-theme";
import { catalogCards, catalogKindCount, catalogVersion } from "../lib/shared-card-catalog";
import type { ScreenProps } from "../navigation";
import { colors, controlMin, radius, space, type } from "../theme";

export function SharedThemeScreen({ navigation }: ScreenProps<"SharedTheme">) {
  const [scheme, setScheme] = useState<GlideScheme>("dark");
  const [expanded, setExpanded] = useState<string>();
  const preview = glidePalette(scheme);
  return <SafeAreaView style={styles.screen}>
    <ScreenHeader title={`${glide.brand.name} theme and cards`} onBack={navigation.goBack} />
    <View testID="shared-theme-preview" style={[styles.preview, { backgroundColor: preview.background, borderColor: preview.border }]}>
      <Text style={[type.heading, { color: preview.foreground }]}>{glide.name} theme {glide.version}</Text>
      <View style={styles.schemes}>
        {(["dark", "light"] as const).map(mode => <Pressable
          key={mode}
          accessibilityRole="button"
          accessibilityState={{ selected: scheme === mode }}
          onPress={() => setScheme(mode)}
          style={[styles.chip, { backgroundColor: scheme === mode ? preview.accent : preview.surface }]}
        >
          <Text style={[type.small, { color: scheme === mode ? preview.onAccent : preview.foreground }]}>{mode === "dark" ? "Dark tokens" : "Light tokens"}</Text>
        </Pressable>)}
      </View>
    </View>
    <FlatList
      testID="shared-card-list"
      data={catalogCards}
      keyExtractor={item => item.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={<Text style={styles.title}>Card catalog {catalogVersion} · {catalogKindCount} kinds · {catalogCards.length} fixtures</Text>}
      renderItem={({ item }) => <View testID={`catalog-fixture:${item.id}`} style={styles.cell}>
        <Text style={styles.title}>{item.label} · {item.card.app}</Text>
        <Text style={styles.meta}>{item.id} · {item.state === "unavailable" ? "Data unavailable" : item.state}</Text>
        {item.state !== "unavailable" && !item.cardPreview ? <Text style={styles.meta}>Interactive fixture not supported in Dash</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`Fixture details: ${item.id}`}
          accessibilityState={{ expanded: expanded === item.id }} style={styles.chip}
          onPress={() => setExpanded(current => current === item.id ? undefined : item.id)}>
          <Text style={styles.title}>Fixture details {expanded === item.id ? "−" : "+"}</Text>
        </Pressable>
        {expanded === item.id ? <>
          <Text selectable testID="catalog-fixture-props" style={[type.mono, { color: colors.text }]}>{JSON.stringify(item.props, null, 2)}</Text>
          {item.cardPreview ? <EphemeralCard spec={item.cardPreview} /> : null}
        </> : null}
      </View>}
    />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  preview: { marginHorizontal: space.lg, marginBottom: space.md, padding: space.md, gap: space.sm, borderWidth: 1, borderRadius: radius.lg },
  schemes: { flexDirection: "row", gap: space.sm },
  chip: { minHeight: controlMin, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: space.md, borderRadius: radius.pill },
  list: { padding: space.lg, gap: space.sm },
  cell: { padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surfaceRaised },
  title: { ...type.heading, color: colors.text },
  meta: { ...type.small, color: colors.textMuted },
});
