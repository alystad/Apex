import { useMemo, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  // When provided, renders in place of the text title (e.g. a brand logo).
  // `title` is still used for the accessibility label.
  titleNode?: ReactNode;
};

export default function SectionHeader({
  title,
  subtitle,
  right,
  titleNode,
}: SectionHeaderProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: theme.spacing[12],
        },
        textWrap: {
          flex: 1,
          gap: theme.spacing[4],
        },
        title: {
          fontSize: 14,
          lineHeight: 17,
          fontWeight: "800",
          color: theme.colors.textPrimary,
          letterSpacing: 0.2,
        },
        subtitle: {
          fontSize: 12,
          lineHeight: 17,
          fontWeight: "600",
          color: theme.colors.textMuted,
        },
      }),
    [theme],
  );

  return (
    <View style={styles.row}>
      <View style={styles.textWrap}>
        {titleNode ? (
          <View accessibilityRole="header" accessibilityLabel={title}>
            {titleNode}
          </View>
        ) : (
          <Text style={styles.title}>{title}</Text>
        )}
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}
