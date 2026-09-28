import { GlassView } from "expo-glass-effect";
import { useMemo } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
};

type SegmentedControlProps<T extends string> = {
  value: T | null;
  options: readonly SegmentedControlOption<T>[];
  onChange: (value: T) => void;
  size?: "xs" | "sm" | "md";
  equalWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * "glass" swaps the track's flat surfaceAlt fill for the same real
   * Liquid Glass treatment GlassPillButton uses (expo-glass-effect's
   * GlassView on iOS, a translucent tinted fallback elsewhere) — opt-in, so
   * every existing consumer (e.g. the Rating/Rank/Momentum toggle in the
   * player modal) keeps its current flat look unless it explicitly switches
   * over. The glass layer sits behind the row of segment Pressables as one
   * absolutely-positioned background piece spanning the whole track, so it
   * scales to however many segments `options` has (2, 3, 4+) automatically
   * — nothing here assumes a binary on/off control.
   */
  variant?: "default" | "glass";
};

export default function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  equalWidth = true,
  style,
  variant = "default",
}: SegmentedControlProps<T>) {
  const { tokens: theme } = useAppTheme();
  const isXs = size === "xs";
  const isSmall = size === "sm" || isXs;
  const isGlass = variant === "glass";
  // Matches the app's other pill segmented controls (e.g. the Rating/Rank/
  // Momentum toggle in the player modal): a bordered track with an
  // accent-tinted pill behind the active option, not just a text-color
  // change. Values (rgba tint, accent text) are the same ones the modal uses.
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrapContent: {
          flexDirection: "row",
          alignItems: "center",
          position: "relative",
          borderRadius: theme.radius.pill,
          borderWidth: theme.borderWidth.hairline,
          borderColor: theme.colors.borderSoft,
          // Glass variant: no flat fill here — the GlassView/fallback layer
          // below provides it, same split GlassPillButton uses.
          backgroundColor: isGlass ? "transparent" : theme.colors.surfaceAlt,
          padding: 2,
          gap: 2,
          overflow: "hidden",
        },
        glassMask: {
          ...StyleSheet.absoluteFillObject,
          borderRadius: theme.radius.pill,
          overflow: "hidden",
        },
        glass: {
          ...StyleSheet.absoluteFillObject,
          borderRadius: theme.radius.pill,
          overflow: "hidden",
        },
        fallbackGlass: {
          ...StyleSheet.absoluteFillObject,
          borderRadius: theme.radius.pill,
          backgroundColor: "rgba(255,255,255,0.14)",
        },
        segmentText: {
          fontSize: isSmall ? 12 : 13,
          lineHeight: isSmall ? 15 : 16,
          color: theme.colors.textMuted,
          fontWeight: "700",
          letterSpacing: 0.2,
        },
        segmentTextActive: {
          color: theme.colors.accent,
        },
        segmentButton: {
          minHeight: isXs
            ? theme.controlHeights.xs
            : isSmall
              ? theme.controlHeights.sm
              : theme.controlHeights.md,
          paddingHorizontal: isXs
            ? theme.spacing[10]
            : isSmall
              ? theme.spacing[12]
              : theme.spacing[14],
          paddingVertical: isXs ? theme.spacing[4] : undefined,
          borderRadius: theme.radius.pill,
          alignItems: "center",
          justifyContent: "center",
        },
        segmentButtonActive: {
          backgroundColor: "rgba(59,130,246,0.14)",
        },
      }),
    [isGlass, isSmall, isXs, theme],
  );

  return (
    <View style={[styles.wrapContent, style]}>
      {isGlass ? (
        Platform.OS === "ios" ? (
          <View pointerEvents="none" style={styles.glassMask}>
            <GlassView
              glassEffectStyle="regular"
              colorScheme="dark"
              isInteractive
              style={styles.glass}
            />
          </View>
        ) : (
          <View pointerEvents="none" style={styles.fallbackGlass} />
        )
      ) : null}
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[
              styles.segmentButton,
              equalWidth ? { flex: 1 } : null,
              active ? styles.segmentButtonActive : null,
            ]}
          >
            <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
