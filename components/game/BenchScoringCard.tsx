import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import type { LiveGameData } from "@/hooks/useLiveGame";
import type { BenchScoringComparison } from "@/src/features/recap/recapStats";
import { useAppTheme } from "@/src/theme/useAppTheme";

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];

function normalizeHexColor(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const normalized = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : fallback;
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  if ([r, g, b].some((channel) => !Number.isFinite(channel))) {
    return hex;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type BenchScoringCardProps = {
  comparison: BenchScoringComparison;
  data: LiveGameData;
  title?: string;
};

/**
 * Bench vs. starters scoring, as a stacked bar per team rather than a flat
 * text block — each team's bar is split into a starters segment and a bench
 * segment, with every bar scaled against the same maximum so the two teams
 * are directly comparable by width.
 */
export default function BenchScoringCard({
  comparison,
  data,
  title = "Bench vs. Starters",
}: BenchScoringCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Shared denominator across both teams: the largest single-team total. A
  // per-team denominator would make a 40-point team's bar look identical to a
  // 100-point team's.
  const maxTotal = useMemo(
    () =>
      Math.max(
        1,
        ...comparison.splits.map((split) => split.benchPoints + split.starterPoints),
      ),
    [comparison.splits],
  );

  if (comparison.splits.length === 0) {
    return null;
  }

  return (
    <Card>
      <SectionHeader title={title} />
      {comparison.summary ? (
        <Text style={styles.summary}>{comparison.summary}</Text>
      ) : null}

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.legendStarters]} />
          <Text style={styles.legendText}>Starters</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.legendBench]} />
          <Text style={styles.legendText}>Bench</Text>
        </View>
      </View>

      <View style={styles.barList}>
        {comparison.splits.map((split) => {
          const teamColor = normalizeHexColor(
            data.teams?.find((team) => team.id === split.teamId)?.color,
            theme.colors.accent,
          );
          const total = split.benchPoints + split.starterPoints;
          const starterFlex = Math.max(0, split.starterPoints);
          const benchFlex = Math.max(0, split.benchPoints);
          // Track width proportional to this team's total vs. the game max.
          const trackPercent = `${Math.max(6, (total / maxTotal) * 100)}%` as const;

          return (
            <View key={split.teamId} style={styles.barRow}>
              <View style={styles.barHeader}>
                <Text style={styles.barTeam} numberOfLines={1}>
                  {split.teamName}
                </Text>
                <Text style={styles.barTotals}>
                  <Text style={styles.barBenchValue}>{split.benchPoints}</Text>
                  <Text style={styles.barTotalsMuted}> bench · </Text>
                  {split.starterPoints}
                  <Text style={styles.barTotalsMuted}> starters</Text>
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: trackPercent }]}>
                  {starterFlex > 0 ? (
                    <View
                      style={[
                        styles.barSegment,
                        styles.barSegmentLeading,
                        { flex: starterFlex, backgroundColor: teamColor },
                      ]}
                    />
                  ) : null}
                  {benchFlex > 0 ? (
                    <View
                      style={[
                        styles.barSegment,
                        styles.barSegmentTrailing,
                        { flex: benchFlex, backgroundColor: withAlpha(teamColor, 0.4) },
                      ]}
                    />
                  ) : null}
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    summary: {
      marginTop: theme.spacing[10],
      fontSize: 14,
      lineHeight: 19,
      fontWeight: "700",
      color: theme.colors.textPrimary,
    },
    legend: {
      marginTop: theme.spacing[10],
      flexDirection: "row",
      gap: theme.spacing[14],
    },
    legendItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
    },
    legendSwatch: {
      width: 10,
      height: 10,
      borderRadius: theme.radius.sm,
    },
    legendStarters: {
      backgroundColor: theme.colors.textSecondary,
    },
    legendBench: {
      backgroundColor: theme.colors.borderSoft,
    },
    legendText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    barList: {
      marginTop: theme.spacing[12],
      gap: theme.spacing[12],
    },
    barRow: {
      gap: theme.spacing[6],
    },
    barHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[10],
    },
    barTeam: {
      flex: 1,
      minWidth: 0,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    barTotals: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "800",
      color: theme.colors.textSecondary,
    },
    barBenchValue: {
      color: theme.colors.textPrimary,
    },
    barTotalsMuted: {
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
    barTrack: {
      width: "100%",
      height: 10,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
      overflow: "hidden",
    },
    barFill: {
      flexDirection: "row",
      height: "100%",
      borderRadius: theme.radius.pill,
      overflow: "hidden",
    },
    barSegment: {
      height: "100%",
    },
    barSegmentLeading: {
      borderTopLeftRadius: theme.radius.pill,
      borderBottomLeftRadius: theme.radius.pill,
    },
    barSegmentTrailing: {
      borderTopRightRadius: theme.radius.pill,
      borderBottomRightRadius: theme.radius.pill,
    },
  });
}
