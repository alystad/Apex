import { useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import { useAppTheme } from "@/src/theme/useAppTheme";
import type { ThemeTokens } from "@/src/theme/tokens";

import {
  normalizeImageUri,
  previewSectionTitleStyle,
  type PreviewTeam,
} from "./previewShared";

export type MatchupMetricRow = {
  label: string;
  awayValue: string;
  homeValue: string;
  /** 0-100 share of the split bar that belongs to the away team. */
  awayShare: number;
};

type MatchupComparisonProps = {
  away: PreviewTeam | undefined;
  home: PreviewTeam | undefined;
  /** Away win probability (0-100), from the same source as the Odds Momentum. */
  awayWinPct: number | null;
  homeWinPct: number | null;
  metrics: MatchupMetricRow[];
};

function formatPct(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "-";
}

export default function MatchupComparison({
  away,
  home,
  awayWinPct,
  homeWinPct,
  metrics,
}: MatchupComparisonProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const winShareAway =
    typeof awayWinPct === "number" && Number.isFinite(awayWinPct)
      ? Math.max(0, Math.min(100, awayWinPct))
      : 50;

  return (
    <Card elevated>
      <Text style={styles.cardTitle}>Matchup</Text>

      <View style={styles.teamHeaderRow}>
        <View style={styles.teamHeaderCell}>
          <Image source={{ uri: normalizeImageUri(away?.logo) }} style={styles.teamLogo} />
        </View>
        <View style={styles.teamHeaderCellRight}>
          <Image source={{ uri: normalizeImageUri(home?.logo) }} style={styles.teamLogo} />
        </View>
      </View>

      {/* Headline stat: win probability gets its own emphasized row. */}
      <View style={styles.winRow}>
        <View style={styles.winValueRow}>
          <Text style={styles.winValue}>{formatPct(awayWinPct)}</Text>
          <Text style={styles.winLabel}>Win Probability</Text>
          <Text style={styles.winValue}>{formatPct(homeWinPct)}</Text>
        </View>
        <View style={styles.winTrack}>
          <View style={[styles.winFillAway, { width: `${winShareAway}%` }]} />
          <View style={[styles.winFillHome, { width: `${100 - winShareAway}%` }]} />
        </View>
      </View>

      <View style={styles.metricList}>
        {metrics.map((metric) => (
          <View key={metric.label} style={styles.metricRow}>
            <View style={styles.metricValueRow}>
              <View style={styles.metricSide}>
                <Text style={styles.metricValue}>{metric.awayValue}</Text>
              </View>
              <Text style={styles.metricLabel}>{metric.label}</Text>
              <View style={styles.metricSideRight}>
                <Text style={styles.metricValue}>{metric.homeValue}</Text>
              </View>
            </View>
            <View style={styles.splitTrack}>
              <View
                style={[
                  styles.splitFillAway,
                  { width: `${Math.max(0, Math.min(100, metric.awayShare))}%` },
                ]}
              />
              <View
                style={[
                  styles.splitFillHome,
                  { width: `${Math.max(0, Math.min(100, 100 - metric.awayShare))}%` },
                ]}
              />
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    cardTitle: previewSectionTitleStyle(theme),
    teamHeaderRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: theme.spacing[12],
    },
    teamHeaderCell: {
      flex: 1,
      alignItems: "flex-start",
    },
    teamHeaderCellRight: {
      flex: 1,
      alignItems: "flex-end",
    },
    teamLogo: {
      width: 28,
      height: 28,
      borderRadius: theme.radius.pill,
    },
    // Emphasized headline win-probability row.
    winRow: {
      marginTop: theme.spacing[12],
      gap: theme.spacing[8],
      borderRadius: theme.radius.lg,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.accentStrong,
      backgroundColor: "rgba(255,255,255,0.05)",
      paddingHorizontal: theme.spacing[12],
      paddingVertical: theme.spacing[12],
    },
    winValueRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    winValue: {
      ...theme.type.title,
      fontSize: 24,
      lineHeight: 28,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    winLabel: {
      ...theme.type.caption,
      color: theme.colors.accentStrong,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      flex: 1,
      textAlign: "center",
    },
    winTrack: {
      flexDirection: "row",
      width: "100%",
      height: 12,
      borderRadius: theme.radius.pill,
      overflow: "hidden",
      backgroundColor: theme.colors.surfaceAlt,
    },
    winFillAway: {
      height: "100%",
      backgroundColor: theme.colors.textMuted,
    },
    winFillHome: {
      height: "100%",
      backgroundColor: theme.colors.accentStrong,
    },
    metricList: {
      marginTop: theme.spacing[16],
      gap: theme.spacing[14],
    },
    metricRow: {
      gap: theme.spacing[8],
    },
    metricValueRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    metricSide: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
      flex: 1,
    },
    metricSideRight: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: theme.spacing[6],
      flex: 1,
    },
    metricValue: {
      ...theme.type.body,
      color: theme.colors.textPrimary,
      fontWeight: "800",
    },
    metricLabel: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      textAlign: "center",
      flex: 1,
    },
    splitTrack: {
      flexDirection: "row",
      width: "100%",
      height: 10,
      borderRadius: theme.radius.pill,
      overflow: "hidden",
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
    },
    splitFillAway: {
      height: "100%",
      backgroundColor: theme.colors.textMuted,
      borderTopLeftRadius: theme.radius.pill,
      borderBottomLeftRadius: theme.radius.pill,
    },
    splitFillHome: {
      height: "100%",
      backgroundColor: theme.colors.accentStrong,
      borderTopRightRadius: theme.radius.pill,
      borderBottomRightRadius: theme.radius.pill,
    },
  });
}
