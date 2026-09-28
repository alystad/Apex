import { useMemo } from "react";
import { StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import LiquidGlassSurface from "@/components/ui/LiquidGlassSurface";
import { useAppTheme } from "@/src/theme/useAppTheme";

type LiquidGlassPillProps = {
  label: string;
  tone?: "neutral" | "live" | "success" | "warning" | "danger";
  style?: StyleProp<ViewStyle>;
  fillColor?: string;
};

export default function LiquidGlassPill({
  label,
  tone = "neutral",
  style,
  fillColor,
}: LiquidGlassPillProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        content: {
          paddingHorizontal: theme.spacing[12],
          paddingVertical: theme.spacing[6],
        },
        text: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "800",
          letterSpacing: 0.3,
        },
      }),
    [theme],
  );

  const resolvedTextColor = "#FFFFFF";
  const resolvedFillColor =
    fillColor ??
    tone === "success"
      ? "#16A34A"
      : tone === "danger"
        ? "#DC2626"
        : tone === "warning"
          ? "#D97706"
          : tone === "live"
            ? "#2563EB"
            : "#000000";

  return (
    <LiquidGlassSurface
      tone="pill"
      style={[{ alignSelf: "flex-start" }, style]}
      contentStyle={styles.content}
      radius={theme.radius.pill}
      blurIntensity={theme.blur.strong}
      elevated={false}
      fillColor={resolvedFillColor}
    >
      <Text style={[styles.text, { color: resolvedTextColor }]}>{label}</Text>
    </LiquidGlassSurface>
  );
}
