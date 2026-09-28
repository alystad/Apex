import { useMemo, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import LiquidGlassSurface from "@/components/ui/LiquidGlassSurface";
import { useAppTheme } from "@/src/theme/useAppTheme";

type LiquidGlassButtonProps = Omit<PressableProps, "style" | "children"> & {
  label?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  size?: "sm" | "md" | "lg" | "icon" | "fab";
  tone?: "neutral" | "accent" | "subtle";
  fillColor?: string;
};

function resolveMetrics(
  size: NonNullable<LiquidGlassButtonProps["size"]>,
  theme: ReturnType<typeof useAppTheme>["tokens"],
) {
  if (size === "sm") {
    return { height: theme.controlHeights.sm, paddingX: theme.spacing[14], fontSize: 12 };
  }
  if (size === "lg") {
    return { height: theme.controlHeights.lg, paddingX: theme.spacing[20], fontSize: 15 };
  }
  if (size === "icon") {
    return { height: 46, paddingX: 0, fontSize: 14 };
  }
  if (size === "fab") {
    return { height: theme.controlHeights.fab, paddingX: 0, fontSize: 16 };
  }
  return { height: theme.controlHeights.md, paddingX: theme.spacing[18], fontSize: 14 };
}

export default function LiquidGlassButton({
  label,
  leftIcon,
  rightIcon,
  children,
  style,
  contentStyle,
  textStyle,
  size = "md",
  tone = "neutral",
  fillColor,
  disabled = false,
  ...rest
}: LiquidGlassButtonProps) {
  const { tokens: theme } = useAppTheme();
  const metrics = resolveMetrics(size, theme);
  const iconOnly = size === "icon" || size === "fab";
  const surfaceTone =
    tone === "accent" ? "accent" : tone === "subtle" ? "pill" : "button";
  const styles = useMemo(
    () =>
      StyleSheet.create({
        content: {
          minHeight: metrics.height,
          width: iconOnly ? metrics.height : undefined,
          paddingHorizontal: iconOnly ? 0 : metrics.paddingX,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: theme.spacing[8],
        },
        text: {
          fontSize: metrics.fontSize,
          lineHeight: metrics.fontSize + 5,
          fontWeight: "800",
          color: "#FFFFFF",
          letterSpacing: 0.2,
        },
        pressed: {
          transform: [{ scale: 0.985 }],
          opacity: theme.opacity.pressed,
        },
        disabled: {
          opacity: theme.opacity.disabled,
        },
      }),
    [iconOnly, metrics, theme, tone],
  );

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      style={({ pressed }) => [
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <LiquidGlassSurface
        tone={surfaceTone}
        radius={theme.radius.pill}
        blurIntensity={size === "fab" ? theme.blur.overlay : theme.blur.strong}
        elevated={size === "fab" || tone === "accent"}
        fillColor={fillColor}
        contentStyle={[styles.content, contentStyle]}
      >
        {children ? (
          children
        ) : (
          <>
            {leftIcon ? <View>{leftIcon}</View> : null}
            {label ? <Text style={[styles.text, textStyle]}>{label}</Text> : null}
            {rightIcon ? <View>{rightIcon}</View> : null}
          </>
        )}
      </LiquidGlassSurface>
    </Pressable>
  );
}
