import type { ReactNode } from "react";
import {
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { tokens } from "@/apps/mobile/src/design/tokens";
import GlassButton from "@/apps/mobile/src/ui/GlassButton";

type GlassIconButtonProps = Omit<PressableProps, "style"> & {
  icon?: ReactNode;
  label?: string;
  accessibilityLabel: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  style?: StyleProp<ViewStyle>;
};

export default function GlassIconButton({
  icon,
  label,
  accessibilityLabel,
  variant = "secondary",
  disabled,
  style,
  ...rest
}: GlassIconButtonProps) {
  if (label) {
    return (
      <GlassButton
        label={label}
        leftIcon={icon}
        variant={variant}
        size="md"
        disabled={disabled ?? undefined}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={style}
        {...rest}
      />
    );
  }

  return (
    <GlassButton
      label=" "
      variant={variant}
      size="md"
      disabled={disabled ?? undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={style}
      leftIcon={
        <View style={styles.iconOnlyWrap}>
          {icon ?? <Text style={styles.fallbackIcon}>*</Text>}
        </View>
      }
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  iconOnlyWrap: {
    width: tokens.iconSize,
    height: tokens.iconSize,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackIcon: {
    fontSize: 16,
    fontWeight: "700",
  },
});
