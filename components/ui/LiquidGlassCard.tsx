import { useMemo, type ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import LiquidGlassSurface from "@/components/ui/LiquidGlassSurface";
import { CardContainer, CardContainerShell } from "@/src/theme/cardStyles";
import { useAppTheme } from "@/src/theme/useAppTheme";

type LiquidGlassCardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  elevated?: boolean;
  padded?: boolean;
};

export default function LiquidGlassCard({
  children,
  style,
  contentStyle,
  elevated = false,
  padded = true,
}: LiquidGlassCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        padded: {
          paddingHorizontal: CardContainer.padding as number,
          paddingVertical: CardContainer.padding as number,
        },
      }),
    [],
  );

  return (
    <LiquidGlassSurface
      tone="card"
      style={[
        CardContainerShell,
        {
          backgroundColor: theme.colors.card,
          borderColor: theme.colors.border,
          borderRadius: CardContainer.borderRadius as number,
        },
        style,
      ]}
      contentStyle={[padded ? styles.padded : null, contentStyle]}
      radius={CardContainer.borderRadius as number}
      blurIntensity={theme.blur.medium}
      elevated={elevated}
      fillColor={theme.colors.card}
      hideBorder
    >
      {children}
    </LiquidGlassSurface>
  );
}
