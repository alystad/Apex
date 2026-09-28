import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";

export default function AppLoader({
  title = "Loading",
  subtitle = "Preparing the latest view.",
}: {
  title?: string;
  subtitle?: string;
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
          gap: theme.spacing[10],
        },
        title: {
          fontSize: 18,
          lineHeight: 22,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
        subtitle: {
          fontSize: 13,
          lineHeight: 18,
          fontWeight: "600",
          color: theme.colors.textSecondary,
          textAlign: "center",
          maxWidth: 260,
        },
      }),
    [theme],
  );

  return (
    <View style={styles.screen}>
      <ActivityIndicator color={theme.colors.accentStrong} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}
