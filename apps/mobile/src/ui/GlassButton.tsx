import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { appTheme } from "@/apps/mobile/src/design/theme";
import { tokens } from "@/apps/mobile/src/design/tokens";

type GlassButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type GlassButtonSize = "sm" | "md" | "lg";

type GlassButtonProps = Omit<PressableProps, "style"> & {
  label: string;
  variant?: GlassButtonVariant;
  size?: GlassButtonSize;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

function resolvePalette(variant: GlassButtonVariant) {
  if (variant === "danger") {
    return {
      label: appTheme.textPrimary,
      border: "rgba(255,255,255,0.2)",
    };
  }
  if (variant === "ghost") {
    return {
      label: appTheme.textPrimary,
      border: "transparent",
    };
  }
  return {
    label: appTheme.textPrimary,
    border: "rgba(255,255,255,0.2)",
  };
}

export default function GlassButton({
  label,
  variant = "secondary",
  size = "md",
  disabled = false,
  style,
  leftIcon,
  rightIcon,
  ...rest
}: GlassButtonProps) {
  const palette = resolvePalette(variant);
  const height = Math.max(tokens.minTap, tokens.buttonHeights[size]);
  const horizontal = tokens.buttonHPadding[size];
  const ghost = variant === "ghost";

  return (
    <Pressable
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [
        styles.buttonBase,
        {
          height,
          minHeight: tokens.minTap,
          borderRadius: tokens.radiusButton,
          transform: [{ scale: pressed ? tokens.pressedScale : 1 }],
          opacity: disabled ? 0.45 : 1,
          backgroundColor: ghost && pressed ? "#111111" : "#000000",
        },
        style,
      ]}
      {...rest}
    >
      {!ghost ? (
        <>
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "#000000", borderRadius: tokens.radiusButton }]} />
          <View style={[StyleSheet.absoluteFillObject, { borderRadius: tokens.radiusButton, borderWidth: 1, borderColor: palette.border }]} />
        </>
      ) : null}
      {ghost ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFillObject, { borderRadius: tokens.radiusButton, backgroundColor: "transparent" }]}
        />
      ) : null}
      <View style={[styles.content, { paddingHorizontal: horizontal }]}>
        {leftIcon ? <View style={styles.iconWrap}>{leftIcon}</View> : null}
        <Text style={[styles.label, { color: palette.label }]} numberOfLines={1}>
          {label}
        </Text>
        {rightIcon ? <View style={styles.iconWrap}>{rightIcon}</View> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  buttonBase: {
    overflow: "hidden",
    justifyContent: "center",
  },
  content: {
    minHeight: tokens.minTap,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.iconGap,
  },
  iconWrap: {
    width: tokens.iconSize,
    height: tokens.iconSize,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: tokens.labelSize,
    fontWeight: "700",
  },
});
