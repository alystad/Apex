import { StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";
import { getInGameRatingColor } from "@/theme/colors";

export type PlayerSummaryItem = {
  key: string;
  label: string;
  value: string;
  tone?: "default" | "rating";
};

type PlayerProfileSummaryStripProps = {
  items: PlayerSummaryItem[];
  trendLabel?: string | null;
  trendValue?: string | null;
};

export default function PlayerProfileSummaryStrip({
  items,
  trendLabel,
  trendValue,
}: PlayerProfileSummaryStripProps) {
  const { tokens: theme } = useAppTheme();
  const styles = StyleSheet.create({
    wrap: {
      gap: theme.spacing[8],
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing[8],
    },
    cell: {
      minWidth: "30%",
      flexGrow: 1,
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[10],
      gap: theme.spacing[4],
    },
    label: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: theme.colors.textMuted,
    },
    value: {
      fontSize: 18,
      lineHeight: 22,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    trendRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[12],
      paddingVertical: theme.spacing[10],
    },
    trendLabelText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
    trendValueText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.accent,
    },
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {items.map((item) => {
          const ratingBg =
            item.tone === "rating"
              ? getInGameRatingColor(Number.parseFloat(item.value))
              : theme.colors.surfaceAlt;
          const valueColor = item.tone === "rating" ? "#08111d" : theme.colors.textPrimary;
          const labelColor =
            item.tone === "rating" ? "rgba(8,17,29,0.72)" : theme.colors.textMuted;
          return (
            <View
              key={item.key}
              style={[
                styles.cell,
                item.tone === "rating" ? { backgroundColor: ratingBg, borderColor: ratingBg } : null,
              ]}
            >
              <Text style={[styles.label, { color: labelColor }]}>{item.label}</Text>
              <Text style={[styles.value, { color: valueColor }]}>{item.value}</Text>
            </View>
          );
        })}
      </View>

      {trendLabel && trendValue ? (
        <View style={styles.trendRow}>
          <Text style={styles.trendLabelText}>{trendLabel}</Text>
          <Text style={styles.trendValueText}>{trendValue}</Text>
        </View>
      ) : null}
    </View>
  );
}
