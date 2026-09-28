import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import Pill from "@/components/ui/Pill";
import { summarizeTrackedBets } from "@/src/features/betting/trackedBets";
import type { TrackedProEvBet } from "@/src/profile/profileTypes";
import { useAppTheme } from "@/src/theme/useAppTheme";

function formatCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export default function TrackedBetSummaryCard({
  bets,
  title = "Picked Bets",
  subtitle = "Projected and settled totals for the bets you marked.",
}: {
  bets: TrackedProEvBet[];
  title?: string;
  subtitle?: string;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        header: {
          flexDirection: "row",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: theme.spacing[12],
        },
        title: {
          ...theme.type.subtitle,
          color: theme.colors.textPrimary,
        },
        subtitle: {
          ...theme.type.caption,
          color: theme.colors.textSecondary,
          marginTop: theme.spacing[4],
        },
        grid: {
          marginTop: theme.spacing[12],
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing[10],
        },
        metricCard: {
          minWidth: 132,
          flexGrow: 1,
          borderRadius: theme.radius.lg,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.surfaceAlt,
          paddingHorizontal: theme.spacing[12],
          paddingVertical: theme.spacing[10],
        },
        metricLabel: {
          ...theme.type.micro,
          color: theme.colors.textMuted,
        },
        metricValue: {
          ...theme.type.body,
          color: theme.colors.textPrimary,
          marginTop: theme.spacing[4],
        },
        emptyText: {
          ...theme.type.caption,
          color: theme.colors.textSecondary,
          marginTop: theme.spacing[10],
        },
      }),
    [theme],
  );
  const summary = useMemo(() => summarizeTrackedBets(bets), [bets]);
  const metrics = [
    { label: "Total Staked", value: formatCurrency(summary.totalStaked) },
    { label: "Open To Win", value: formatCurrency(summary.openToWin) },
    { label: "Open Return", value: formatCurrency(summary.openReturn) },
    { label: "Settled Net", value: formatCurrency(summary.settledNet) },
    {
      label: "Combined Ceiling",
      value: formatCurrency(summary.combinedCeiling),
    },
  ];

  return (
    <Card>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <Pill
          label={`${bets.length} ${bets.length === 1 ? "Bet" : "Bets"}`}
          tone={bets.length > 0 ? "success" : "neutral"}
        />
      </View>
      <View style={styles.grid}>
        {metrics.map((metric) => (
          <View key={metric.label} style={styles.metricCard}>
            <Text style={styles.metricLabel}>{metric.label}</Text>
            <Text style={styles.metricValue}>{metric.value}</Text>
          </View>
        ))}
      </View>
      {bets.length === 0 ? (
        <Text style={styles.emptyText}>No picked bets in this Pro EV list yet.</Text>
      ) : null}
    </Card>
  );
}
