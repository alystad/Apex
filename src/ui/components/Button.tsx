import { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { PressableProps, StyleProp, ViewStyle } from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";
import Text from "@/src/ui/components/Text";
import { tokens } from "@/src/ui/tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

export type ButtonProps = Omit<PressableProps, "style"> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
};

const sizeStyles: Record<ButtonSize, ViewStyle> = {
  sm: {
    minHeight: tokens.spacing[32] + tokens.spacing[8],
    paddingHorizontal: tokens.spacing[12],
    paddingVertical: tokens.spacing[8],
  },
  md: {
    minHeight: tokens.spacing[32] + tokens.spacing[12],
    paddingHorizontal: tokens.spacing[14],
    paddingVertical: tokens.spacing[10],
  },
};

function palette(
  variant: ButtonVariant,
  colors: {
    accentStrong: string;
    bg: string;
    glassStrong: string;
    borderSoft: string;
    edgeHighlight: string;
    textPrimary: string;
    textSecondary: string;
  },
) {
  if (variant === "primary") {
    return {
      backgroundColor: colors.accentStrong,
      borderColor: colors.accentStrong,
      textTone: "primary" as const,
      textColor: colors.bg,
      spinnerColor: colors.bg,
    };
  }
  if (variant === "ghost") {
    return {
      backgroundColor: "transparent",
      borderColor: "transparent",
      textTone: "secondary" as const,
      textColor: colors.textSecondary,
      spinnerColor: colors.textSecondary,
    };
  }
  return {
    backgroundColor: colors.glassStrong,
    borderColor: colors.edgeHighlight,
    textTone: "primary" as const,
    textColor: colors.textPrimary,
    spinnerColor: colors.textPrimary,
  };
}

export default function Button({
  label,
  variant = "secondary",
  size = "md",
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  ...rest
}: ButtonProps) {
  const { tokens: theme } = useAppTheme();
  const colors = useMemo(() => palette(variant, theme.colors), [theme.colors, variant]);
  const isDisabled = disabled || loading;

  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        sizeStyles[size],
        {
          backgroundColor: colors.backgroundColor,
          borderColor: colors.borderColor,
          opacity: isDisabled
            ? tokens.opacity.disabled
            : pressed
              ? tokens.opacity.pressed
              : 1,
        },
        fullWidth ? styles.fullWidth : null,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.spinnerColor} />
        ) : (
          <Text
            variant="caption"
            tone={colors.textTone}
            style={[styles.label, { color: colors.textColor }]}
          >
            {label}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: tokens.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  fullWidth: {
    width: "100%",
  },
  content: {
    minHeight: tokens.spacing[24],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontWeight: "700",
  },
});
