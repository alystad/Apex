import { GlassView } from "expo-glass-effect";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { SymbolView } from "expo-symbols";
import { type ReactNode, useMemo } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";

type GlassPillButtonProps = Omit<PressableProps, "style" | "children"> & {
  title?: string;
  icon?: "search";
  shape?: "pill" | "circle";
  size?: number;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export default function GlassPillButton({
  title,
  icon,
  shape = "pill",
  size,
  children,
  style,
  textStyle,
  disabled = false,
  ...rest
}: GlassPillButtonProps) {
  const { tokens: theme } = useAppTheme();
  const isCircle = shape === "circle";
  const circleSize = size ?? 60;
  const pillHeight = size ?? 46;
  const styles = useMemo(
    () =>
      StyleSheet.create({
        pressable: {
          minHeight: isCircle ? circleSize : pillHeight,
          minWidth: isCircle ? circleSize : undefined,
          borderRadius: 999,
          overflow: "hidden",
          justifyContent: "center",
        },
        pressed: {
          transform: [{ scale: 0.985 }],
          opacity: theme.opacity.pressed,
        },
        disabled: {
          opacity: theme.opacity.disabled,
        },
        glassMask: {
          ...StyleSheet.absoluteFillObject,
          borderRadius: 999,
          overflow: "hidden",
        },
        glass: {
          ...StyleSheet.absoluteFillObject,
          borderRadius: 999,
          overflow: "hidden",
        },
        fallbackGlass: {
          ...StyleSheet.absoluteFillObject,
          borderRadius: 999,
          backgroundColor: "rgba(255,255,255,0.14)",
          borderWidth: theme.borderWidth.normal,
          borderColor: "rgba(255,255,255,0.12)",
        },
        content: {
          minHeight: isCircle ? circleSize : pillHeight,
          minWidth: isCircle ? circleSize : undefined,
          paddingHorizontal: isCircle ? 0 : theme.spacing[18],
          alignItems: "center",
          justifyContent: "center",
        },
        text: {
          color: theme.colors.textPrimary,
          fontSize: theme.fontSizes.body,
          lineHeight: 20,
          fontWeight: "600",
          letterSpacing: 0.1,
        },
      }),
    [circleSize, isCircle, pillHeight, theme],
  );

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      style={({ pressed }) => [
        styles.pressable,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {Platform.OS === "ios" ? (
        <View pointerEvents="none" style={styles.glassMask}>
          <GlassView
            glassEffectStyle="regular"
            colorScheme="dark"
            isInteractive
            style={styles.glass}
          />
        </View>
      ) : (
        <View pointerEvents="none" style={styles.fallbackGlass} />
      )}
      <View pointerEvents="none" style={styles.content}>
        {children ?? (icon === "search" ? (
          Platform.OS === "ios" ? (
            <SymbolView
              name="magnifyingglass"
              size={theme.iconSizes.lg + 4}
              tintColor={theme.colors.textPrimary}
              weight="semibold"
              type="monochrome"
            />
          ) : (
            <FontAwesome
              name="search"
              size={theme.iconSizes.lg + 4}
              color={theme.colors.textPrimary}
            />
          )
        ) : (
          <Text style={[styles.text, textStyle]}>{title}</Text>
        ))}
      </View>
    </Pressable>
  );
}
