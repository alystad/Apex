import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";

export default function ScreenErrorState({
  title = "Could not load this screen",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        screen: {
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.bg,
          paddingHorizontal: theme.spacing[24],
          gap: theme.spacing[12],
        },
        card: {
          width: "100%",
          maxWidth: 360,
          borderRadius: theme.radius.xl,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.card,
          paddingHorizontal: theme.spacing[16],
          paddingVertical: 18,
          gap: theme.spacing[10],
        },
        title: {
          fontSize: 20,
          lineHeight: 24,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
        message: {
          fontSize: 13,
          lineHeight: 18,
          fontWeight: "600",
          color: theme.colors.textSecondary,
        },
        button: {
          alignSelf: "flex-start",
          minHeight: 42,
          borderRadius: theme.radius.lg,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceAlt,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: theme.spacing[14],
        },
        buttonText: {
          fontSize: 14,
          lineHeight: 20,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
      }),
    [theme],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <Pressable style={styles.button} onPress={onRetry}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    </View>
  );
}
