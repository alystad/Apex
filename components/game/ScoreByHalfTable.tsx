import { useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

// Local copy of the same lenient numeric parse the Stats tab uses on
// linescore strings (they arrive as strings, occasionally "-" or with a
// unicode minus).
function parseNumeric(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const match = value.replace(/−/g, "-").match(/-?\d+(\.\d+)?/);
  if (!match) {
    return 0;
  }
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type ScoreByHalfTeam = {
  logo: string;
  abbr: string;
  linescores: string[];
};

export type ScoreByHalfTableProps = {
  away: ScoreByHalfTeam;
  home: ScoreByHalfTeam;
  /** Column headers ("Q1".."Q4" / "1H","2H", plus OT) — one per period played. */
  periodColumns: string[];
  /** Compact spacing for the Recap tab's strip presentation. */
  compact?: boolean;
};

/**
 * Per-period scoring table (Q1-Q4 / 1H-2H + OT, plus Total), shared by the
 * Stats tab's "Score by Half" card and the Recap tab's compact strip.
 */
export default function ScoreByHalfTable({
  away,
  home,
  periodColumns,
  compact = false,
}: ScoreByHalfTableProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const periodCount = periodColumns.length;

  const rows = useMemo(
    () =>
      [
        { logo: away.logo, name: away.abbr, line: away.linescores, side: "away" as const },
        { logo: home.logo, name: home.abbr, line: home.linescores, side: "home" as const },
      ].map((teamRow) => ({
        logo: teamRow.logo,
        name: teamRow.name,
        side: teamRow.side,
        periods: Array.from({ length: periodCount }, (_, index) => teamRow.line[index] ?? "-"),
        total: teamRow.line.reduce((sum, value) => sum + parseNumeric(value), 0),
      })),
    [away, home, periodCount],
  );

  // Which side outscored the other in each individual quarter/half (computed
  // per-column from that period's linescore, not the running total).
  const periodWinners = useMemo<Array<"away" | "home" | "tie">>(
    () =>
      Array.from({ length: periodCount }, (_, index) => {
        const awayPts = parseNumeric(away.linescores[index]);
        const homePts = parseNumeric(home.linescores[index]);
        if (awayPts > homePts) return "away";
        if (homePts > awayPts) return "home";
        return "tie";
      }),
    [away.linescores, home.linescores, periodCount],
  );

  if (periodCount === 0) {
    return <Text style={styles.footerNote}>Scoring hasn&apos;t started yet.</Text>;
  }

  return (
    <View style={compact ? styles.tableCompact : styles.table}>
      <View style={styles.tableHeaderRow}>
        <View style={styles.tableTeamCell} />
        {periodColumns.map((label) => (
          <View key={label} style={styles.tableStatCell}>
            <Text style={styles.tableHeaderLabel}>{label}</Text>
          </View>
        ))}
        <View style={styles.tableStatCell}>
          <Text style={styles.tableHeaderLabel}>Total</Text>
        </View>
      </View>
      {rows.map((teamRow) => (
        <View key={teamRow.name} style={[styles.tableRow, styles.tableRowPadded]}>
          <View style={styles.tableTeamCell}>
            <Image
              source={{ uri: teamRow.logo || FALLBACK_IMAGE_URI }}
              style={styles.tableTeamLogo}
            />
            <Text style={styles.tableTeamName} numberOfLines={1}>
              {teamRow.name}
            </Text>
          </View>
          {teamRow.periods.map((value, index) => {
            const wonPeriod = periodWinners[index] === teamRow.side;
            return (
              <View key={`${teamRow.name}-${index}`} style={styles.tableStatCell}>
                <Text style={[styles.tableValue, wonPeriod ? styles.tableValueLead : null]}>
                  {value}
                </Text>
              </View>
            );
          })}
          <View style={styles.tableStatCell}>
            <Text style={styles.tableTotal}>{teamRow.total}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    table: {
      marginTop: theme.spacing[12],
      gap: theme.spacing[6],
    },
    tableCompact: {
      gap: theme.spacing[2],
    },
    tableRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    tableHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingBottom: theme.spacing[6],
      borderBottomWidth: theme.borderWidth.hairline,
      borderBottomColor: theme.colors.borderSoft,
    },
    tableTeamCell: {
      flex: 2.2,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
      minWidth: 0,
    },
    tableStatCell: {
      flex: 1,
      alignItems: "center",
    },
    tableTeamLogo: {
      width: 24,
      height: 24,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
    },
    tableTeamName: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    tableHeaderLabel: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    tableValue: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
    // Winner of an individual quarter/half: brighter + bolder than the opponent's
    // number for that same column.
    tableValueLead: {
      color: theme.colors.textPrimary,
      fontWeight: "800",
    },
    tableTotal: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    tableRowPadded: {
      paddingVertical: theme.spacing[6],
    },
    footerNote: {
      marginTop: theme.spacing[10],
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
  });
}
