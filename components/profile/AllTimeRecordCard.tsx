import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import type { PredictionStats } from "@/src/profile/profileTypes";
import { useAppTheme } from "@/src/theme/useAppTheme";

type AllTimeRecordCardProps = {
  stats: PredictionStats;
};

function formatRecord(correct: number, incorrect: number): string {
  return `${correct}-${incorrect}`;
}

export default function AllTimeRecordCard({ stats }: AllTimeRecordCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          gap: theme.spacing[14],
        },
        topRow: {
          flexDirection: "row",
          alignItems: "stretch",
          gap: theme.spacing[12],
        },
        heroCard: {
          flex: 1.05,
          borderRadius: theme.radius.xl,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.chip,
          paddingHorizontal: theme.spacing[14],
          paddingVertical: theme.spacing[16],
          gap: theme.spacing[4],
        },
        heroLabel: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "800",
          letterSpacing: 0.3,
          textTransform: "uppercase",
          color: theme.colors.textSecondary,
        },
        heroValue: {
          fontSize: 34,
          lineHeight: 38,
          fontWeight: "900",
          color: theme.colors.textPrimary,
        },
        heroMeta: {
          fontSize: 13,
          lineHeight: 18,
          fontWeight: "700",
          color: theme.colors.textSecondary,
        },
        sideGrid: {
          flex: 0.95,
          gap: theme.spacing[8],
        },
        metricTile: {
          flex: 1,
          borderRadius: theme.radius.lg,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.surfaceAlt,
          paddingHorizontal: theme.spacing[12],
          paddingVertical: theme.spacing[10],
          justifyContent: "center",
        },
        metricLabel: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "800",
          letterSpacing: 0.2,
          textTransform: "uppercase",
          color: theme.colors.textMuted,
          marginBottom: theme.spacing[2],
        },
        metricValue: {
          fontSize: 17,
          lineHeight: 20,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
        metricMeta: {
          fontSize: 12,
          lineHeight: 16,
          fontWeight: "600",
          color: theme.colors.textSecondary,
        },
        breakdownRow: {
          flexDirection: "row",
          gap: theme.spacing[8],
        },
        breakdownCard: {
          flex: 1,
          borderRadius: theme.radius.lg,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.surface,
          paddingHorizontal: theme.spacing[12],
          paddingVertical: theme.spacing[12],
          gap: theme.spacing[4],
        },
        breakdownTitle: {
          fontSize: 12,
          lineHeight: 16,
          fontWeight: "800",
          color: theme.colors.textSecondary,
        },
        breakdownValue: {
          fontSize: 18,
          lineHeight: 22,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
        breakdownDetail: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "700",
          color: theme.colors.textMuted,
        },
      }),
    [theme],
  );

  return (
    <Card elevated>
      <View style={styles.wrap}>
        <View style={styles.topRow}>
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>All-Time Record</Text>
            <Text style={styles.heroValue}>{stats.winPct.toFixed(1)}%</Text>
            <Text style={styles.heroMeta}>
              {stats.correct} correct | {stats.incorrect} incorrect
            </Text>
          </View>

          <View style={styles.sideGrid}>
            <View style={styles.metricTile}>
              <Text style={styles.metricLabel}>Total Picks</Text>
              <Text style={styles.metricValue}>{stats.total}</Text>
              <Text style={styles.metricMeta}>{stats.pending} pending</Text>
            </View>
            <View style={styles.metricTile}>
              <Text style={styles.metricLabel}>Streak</Text>
              <Text style={styles.metricValue}>{stats.currentStreak}</Text>
              <Text style={styles.metricMeta}>
                Best {stats.bestStreak}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.breakdownRow}>
          <View style={styles.breakdownCard}>
            <Text style={styles.breakdownTitle}>Home Picks</Text>
            <Text style={styles.breakdownValue}>
              {formatRecord(stats.homeCorrect, stats.homeIncorrect)}
            </Text>
            <Text style={styles.breakdownDetail}>
              {stats.homeCorrect + stats.homeIncorrect} resolved
            </Text>
          </View>
          <View style={styles.breakdownCard}>
            <Text style={styles.breakdownTitle}>Away Picks</Text>
            <Text style={styles.breakdownValue}>
              {formatRecord(stats.awayCorrect, stats.awayIncorrect)}
            </Text>
            <Text style={styles.breakdownDetail}>
              {stats.awayCorrect + stats.awayIncorrect} resolved
            </Text>
          </View>
        </View>
      </View>
    </Card>
  );
}
