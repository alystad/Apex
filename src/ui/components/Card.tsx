import type { StyleProp, ViewStyle } from "react-native";

import LiquidGlassSurface, { type LiquidGlassTone } from "@/components/ui/LiquidGlassSurface";
import { CardContainer, CardContainerShell } from "@/src/theme/cardStyles";
import { useAppTheme } from "@/src/theme/useAppTheme";

export type CardVariant = "default" | "soft" | "tinted";

export type CardProps = {
  children: React.ReactNode;
  variant?: CardVariant;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
};

function resolveVariant(variant: CardVariant): {
  tone: LiquidGlassTone;
  elevated: boolean;
} {
  if (variant === "soft") {
    return {
      tone: "dock",
      elevated: true,
    };
  }
  if (variant === "tinted") {
    return {
      tone: "button",
      elevated: false,
    };
  }
  return {
    tone: "card",
    elevated: false,
  };
}

export default function Card({
  children,
  variant = "default",
  padded = true,
  style,
}: CardProps) {
  const { tokens: theme } = useAppTheme();
  const variantStyle = resolveVariant(variant);

  return (
    <LiquidGlassSurface
      tone={variantStyle.tone}
      style={[
        CardContainerShell,
        {
          backgroundColor: theme.colors.card,
          borderColor: theme.colors.border,
          borderRadius: CardContainer.borderRadius as number,
        },
        style,
      ]}
      contentStyle={
        padded
          ? {
              paddingHorizontal: CardContainer.padding as number,
              paddingVertical: CardContainer.padding as number,
            }
          : undefined
      }
      radius={CardContainer.borderRadius as number}
      blurIntensity={theme.blur.medium}
      elevated={variantStyle.elevated}
      fillColor={theme.colors.card}
      hideBorder
    >
      {children}
    </LiquidGlassSurface>
  );
}
