import type { ReactNode, RefObject } from "react";
import { Platform, StyleSheet, View, type ViewProps } from "react-native";
import { GlassSurface } from "./GlassSurface";
import { colors } from "../theme";
import { COMPOSER_GLASS_RIM, composerGlassPolicy } from "../lib/composer-glass";

interface ComposerGlassDockProps {
  children: ReactNode;
  blurTarget?: RefObject<View | null>;
  borderRadius?: number;
  contentStyle?: ViewProps["style"];
}

/**
 * Input-safe glass: a true opaque inset shields glyphs, while the narrow rim
 * retains the raised, native-blurred glass. This also works when Android's
 * BlurTargetView is unavailable or the transcript target is unmounted.
 *
 * Drop-in replacement for the GlassSurface around Composer's field/chips.
 * Does not move the keyboard dock or change touch targets.
 */
export function ComposerGlassDock({
  children,
  blurTarget,
  borderRadius = 18,
  contentStyle,
}: ComposerGlassDockProps) {
  const policy = composerGlassPolicy(Platform.OS, Number(Platform.Version), Boolean(blurTarget));
  return (
    <View
      testID="composer-opaque-backing"
      pointerEvents="box-none"
      style={[styles.backing, { borderRadius, backgroundColor: policy.backingColor }]}
    >
      <GlassSurface
        blur={policy.blur}
        blurTarget={policy.blur ? blurTarget : undefined}
        variant="raised"
        borderRadius={borderRadius}
        contentStyle={styles.glassInset}
      >
        <View
          testID="composer-ink-shield"
          style={[styles.shield, { borderRadius: Math.max(0, borderRadius - COMPOSER_GLASS_RIM), backgroundColor: policy.shieldColor }, contentStyle]}
        >
          {children}
        </View>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  backing: { overflow: "hidden", backgroundColor: colors.surfaceRaised },
  glassInset: { padding: COMPOSER_GLASS_RIM },
  shield: { overflow: "hidden", backgroundColor: colors.surfaceRaised },
});
