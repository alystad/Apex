import { useMemo, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";

export type LiquidGlassTone = "card" | "dock" | "button" | "pill" | "accent";

type LiquidGlassSurfaceProps = {
  children?: ReactNode;
  tone?: LiquidGlassTone;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  radius?: number;
  blurIntensity?: number;
  elevated?: boolean;
  fillColor?: string;
  hideBorder?: boolean;
};

export default function LiquidGlassSurface({
  children,
  style,
  contentStyle,
  radius,
  elevated = false,
  fillColor,
  hideBorder = false,
}: LiquidGlassSurfaceProps) {
  const { tokens: theme } = useAppTheme();
  const resolvedRadius = radius ?? theme.radius.xl;
  const shadowStyle = elevated ? theme.shadows.floating : theme.shadows.card;
  const backgroundColor = fillColor ?? "#000000";
  const styles = useMemo(
    () =>
      StyleSheet.create({
        outer: {
          borderRadius: resolvedRadius,
          shadowColor: "#000000",
        },
        shell: {
          borderRadius: resolvedRadius,
          overflow: "hidden",
          position: "relative",
          backgroundColor,
        },
        outerBorder: {
          ...StyleSheet.absoluteFillObject,
          borderRadius: resolvedRadius,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.border,
        },
        content: {
          position: "relative",
          zIndex: 1,
        },
      }),
    [backgroundColor, resolvedRadius, theme],
  );

  return (
    <View style={[styles.outer, shadowStyle, style]}>
      <View style={styles.shell}>
        {!hideBorder ? <View pointerEvents="none" style={styles.outerBorder} /> : null}
        <View style={[styles.content, contentStyle]}>{children}</View>
      </View>
    </View>
  );
}
