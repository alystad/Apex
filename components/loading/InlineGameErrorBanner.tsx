import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";

type InlineGameErrorBannerProps = {
  message: string;
  /** Absolute `top` (px) — positioned just below the sticky header/tab bar. */
  top: number;
  onRetry: () => void;
};

/**
 * Replaces the old full-screen blocking GameLoadingScreen for the ONE case
 * that still needs user-visible feedback: a fetch failed and there's no
 * data at all to fall back on. Every other loading state is handled by the
 * shell rendering instantly and individual tabs/sections showing their own
 * skeletons — this banner is deliberately small and non-blocking, sitting
 * below the header rather than covering the whole screen.
 */
export default function InlineGameErrorBanner({
  message,
  top,
  onRetry,
}: InlineGameErrorBannerProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top }]}>
      <View style={styles.card}>
        <Text style={styles.message} numberOfLines={2}>
          {message}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading this game"
          onPress={onRetry}
          style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
        >
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useAppTheme>["tokens"]) {
  return StyleSheet.create({
    wrap: {
      position: "absolute",
      left: 0,
      right: 0,
      zIndex: 500,
      elevation: 500,
      paddingHorizontal: theme.spacing[8],
      paddingTop: theme.spacing[8],
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
      borderRadius: theme.radius.lg,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.card,
      paddingHorizontal: theme.spacing[14],
      paddingVertical: theme.spacing[10],
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.24,
      shadowRadius: 10,
    },
    message: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      color: theme.colors.textSecondary,
    },
    button: {
      minHeight: 34,
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[12],
      alignItems: "center",
      justifyContent: "center",
    },
    buttonPressed: {
      opacity: theme.opacity.pressed,
    },
    buttonText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
  });
}
