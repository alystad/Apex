import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import LiquidGlassCard from "@/components/ui/LiquidGlassCard";

type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
  padded?: boolean;
};

export default function Card({
  children,
  style,
  elevated = false,
  padded = true,
}: CardProps) {
  return (
    <LiquidGlassCard style={style} elevated={elevated} padded={padded}>
      {children}
    </LiquidGlassCard>
  );
}
