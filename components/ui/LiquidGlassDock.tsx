import { useMemo, type ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import LiquidGlassSurface from "@/components/ui/LiquidGlassSurface";
import { useAppTheme } from "@/src/theme/useAppTheme";

type LiquidGlassDockProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  capsule?: boolean;
  compact?: boolean;
  elevated?: boolean;
};

export default function LiquidGlassDock({
  children,
  style,
  contentStyle,
  capsule = false,
  compact = false,
  elevated = true,
}: LiquidGlassDockProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        content: {
          paddingHorizontal: compact ? theme.spacing[6] : theme.spacing[8],
          paddingVertical: compact ? theme.spacing[6] : theme.spacing[8],
        },
      }),
    [compact, theme],
  );

  return (
    <LiquidGlassSurface
      tone="dock"
      style={style}
      contentStyle={[styles.content, contentStyle]}
      radius={capsule ? theme.radius.pill : theme.radius.xl}
      blurIntensity={theme.blur.overlay}
      elevated={elevated}
    >
      {children}
    </LiquidGlassSurface>
  );
}
