import type { PressableProps, StyleProp, ViewStyle } from "react-native";

import LiquidGlassButton from "@/components/ui/LiquidGlassButton";

type ButtonProps = Omit<PressableProps, "style" | "children"> & {
  label: string;
  style?: StyleProp<ViewStyle>;
};

export default function PrimaryButton({ label, style, ...rest }: ButtonProps) {
  return (
    <LiquidGlassButton {...rest} label={label} style={style} tone="accent" size="md" />
  );
}
