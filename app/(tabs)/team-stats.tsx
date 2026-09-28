import { useMemo, type ReactNode } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import FireRingGlow, { isPlayerOnFire } from "@/components/ui/FireRingGlow";
import GameTabScreenScaffold from "@/components/GameTabScreenScaffold";
import TabContentSkeleton from "@/components/loading/TabContentSkeleton";
import PointDifferentialChart, {
  periodShortLabel,
} from "@/components/game/PointDifferentialChart";
import ScoreByHalfTable from "@/components/game/ScoreByHalfTable";
import SectionHeader from "@/components/ui/SectionHeader";
import {
  type LiveGamePlayer,
  type LiveGameScoreMarginPoint,
  type LiveGameTeam,
  useLiveGame,
} from "@/hooks/useLiveGame";
import { useSettingsState } from "@/src/settings/SettingsContext";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { resolveInGameSectionIds } from "@/src/ui/inGameSectionLayouts";
import { useInGameTabNavigation } from "@/src/ui/inGameTabNavigationContext";
import { useRegisterInGameSections } from "@/src/ui/useRegisterInGameSections";

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

type ComparisonRowData = {
  label: string;
  awayValue: number;
  homeValue: number;
  awayText: string;
  homeText: string;
  awaySub?: string;
  homeSub?: string;
  lowerIsBetter?: boolean;
};

const BIGGEST_LEADS = {
  away: { lead: 9, time: "5:20 Q2" },
  home: { lead: 13, time: "8:55 Q3" },
  leadChanges: 9,
};

type RunData = { teamKey: "away" | "home"; score: string; window: string };
const RUNS: RunData[] = [
  { teamKey: "home", score: "12-2", window: "9:42 Q1 – 6:03 Q1" },
  { teamKey: "away", score: "10-0", window: "2:11 Q2 – 0:38 Q2" },
  { teamKey: "home", score: "14-4", window: "8:55 Q3 – 4:20 Q3" },
];

const PLAYER_STREAKS = {
  away: { name: "J. Rivers", detail: "7 at 3:12 Q1" },
  home: { name: "K. Thornton", detail: "9 at 8:55 Q3" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeTeamColor(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const normalized = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : fallback;
}

function teamAbbr(team: LiveGameTeam | undefined, fallback: string): string {
  return team?.abbreviation || team?.shortDisplayName || fallback;
}

function pickTopPlayer(players: LiveGamePlayer[] | undefined): LiveGamePlayer | null {
  if (!players?.length) {
    return null;
  }
  return [...players].sort((a, b) => b.points - a.points)[0] ?? null;
}

// Pull a leading number out of an ESPN stat string (e.g. "48.5", "48.5%",
// "27-60" -> 48.5 / 48.5 / 27).
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


function percentText(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "-") {
    return "-";
  }
  return trimmed.endsWith("%") ? trimmed : `${trimmed}%`;
}

function madeAttemptedText(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "-") {
    return undefined;
  }
  return trimmed.replace("-", "/");
}

function countText(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return !trimmed || trimmed === "-" ? "0" : trimmed;
}

// Build the Team Comparison rows straight from the parsed ESPN boxscore team
// totals (the same `team.totals` used by the Box Score tab).
function buildComparisonRows(
  awayTotals: LiveGameTeam["totals"] | undefined,
  homeTotals: LiveGameTeam["totals"] | undefined,
): ComparisonRowData[] {
  const away = awayTotals;
  const home = homeTotals;
  return [
    {
      label: "FG%",
      awayValue: parseNumeric(away?.fgPct),
      homeValue: parseNumeric(home?.fgPct),
      awayText: percentText(away?.fgPct),
      homeText: percentText(home?.fgPct),
      awaySub: madeAttemptedText(away?.fg),
      homeSub: madeAttemptedText(home?.fg),
    },
    {
      label: "3FG%",
      awayValue: parseNumeric(away?.threePtPct),
      homeValue: parseNumeric(home?.threePtPct),
      awayText: percentText(away?.threePtPct),
      homeText: percentText(home?.threePtPct),
      awaySub: madeAttemptedText(away?.threePt),
      homeSub: madeAttemptedText(home?.threePt),
    },
    {
      label: "FT%",
      awayValue: parseNumeric(away?.ftPct),
      homeValue: parseNumeric(home?.ftPct),
      awayText: percentText(away?.ftPct),
      homeText: percentText(home?.ftPct),
      awaySub: madeAttemptedText(away?.ft),
      homeSub: madeAttemptedText(home?.ft),
    },
    {
      label: "Rebounds",
      awayValue: parseNumeric(away?.rebounds),
      homeValue: parseNumeric(home?.rebounds),
      awayText: countText(away?.rebounds),
      homeText: countText(home?.rebounds),
    },
    {
      label: "Assists",
      awayValue: parseNumeric(away?.assists),
      homeValue: parseNumeric(home?.assists),
      awayText: countText(away?.assists),
      homeText: countText(home?.assists),
    },
    {
      label: "Turnovers",
      awayValue: parseNumeric(away?.turnovers),
      homeValue: parseNumeric(home?.turnovers),
      awayText: countText(away?.turnovers),
      homeText: countText(home?.turnovers),
      lowerIsBetter: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Section: Team comparison row (bars + optional makes/attempts subtext)
// ---------------------------------------------------------------------------
function ComparisonRow({
  row,
  styles,
}: {
  row: ComparisonRowData;
  styles: ReturnType<typeof createStyles>;
}) {
  const safeAway = Number.isFinite(row.awayValue) ? row.awayValue : 0;
  const safeHome = Number.isFinite(row.homeValue) ? row.homeValue : 0;
  const total = Math.max(1, safeAway + safeHome);
  const awayPct = Math.max(6, Math.min(94, (safeAway / total) * 100));
  const homePct = Math.max(6, Math.min(94, (safeHome / total) * 100));
  const awayLead = row.lowerIsBetter ? safeAway < safeHome : safeAway > safeHome;
  const homeLead = row.lowerIsBetter ? safeHome < safeAway : safeHome > safeAway;

  return (
    <View style={styles.compRow}>
      <View style={styles.compTop}>
        <View style={styles.compValueSide}>
          <Text style={[styles.compValue, awayLead ? styles.compValueLead : null]}>
            {row.awayText}
          </Text>
          {row.awaySub ? <Text style={styles.compSub}>{row.awaySub}</Text> : null}
        </View>
        <Text style={styles.compLabel}>{row.label}</Text>
        <View style={[styles.compValueSide, styles.compValueSideRight]}>
          <Text style={[styles.compValue, homeLead ? styles.compValueLead : null]}>
            {row.homeText}
          </Text>
          {row.homeSub ? <Text style={styles.compSub}>{row.homeSub}</Text> : null}
        </View>
      </View>
      <View style={styles.compBars}>
        <View style={styles.compBarTrackLeft}>
          <View style={[styles.compBarAway, { width: `${awayPct}%` }]} />
        </View>
        <View style={styles.compBarTrackRight}>
          <View style={[styles.compBarHome, { width: `${homePct}%` }]} />
        </View>
      </View>
    </View>
  );
}


// ---------------------------------------------------------------------------
function createStyles(theme: AppThemeTokens, isDark: boolean) {
  return StyleSheet.create({
    screenStack: {
      gap: theme.spacing[12],
    },
    // Score by half table
    table: {
      marginTop: theme.spacing[12],
      gap: theme.spacing[6],
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
    // Point differential chart
    chartWrap: {
      marginTop: theme.spacing[12],
      gap: theme.spacing[8],
    },
    chartLegend: {
      flexDirection: "row",
      gap: theme.spacing[14],
    },
    chartLegendItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
    },
    chartLegendDot: {
      width: 8,
      height: 8,
      borderRadius: theme.radius.pill,
    },
    chartLegendText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    chartCanvas: {
      width: "100%",
      height: 168,
      borderRadius: theme.radius.md,
      overflow: "hidden",
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
    },
    chartAxis: {
      flexDirection: "row",
    },
    chartAxisLabel: {
      flex: 1,
      textAlign: "center",
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    chartTooltip: {
      position: "absolute",
      top: theme.spacing[6],
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[4],
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.bg,
      alignItems: "center",
      justifyContent: "center",
    },
    chartTooltipText: {
      fontSize: 12,
      lineHeight: 15,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      textAlign: "center",
    },
    // Team comparison
    compStack: {
      marginTop: theme.spacing[12],
      gap: theme.spacing[14],
    },
    compRow: {
      gap: theme.spacing[8],
    },
    compTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    compValueSide: {
      minWidth: 74,
      alignItems: "flex-start",
    },
    compValueSideRight: {
      alignItems: "flex-end",
    },
    compValue: {
      fontSize: 15,
      lineHeight: 19,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    compValueLead: {
      color: theme.colors.success,
    },
    compSub: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    compLabel: {
      flex: 1,
      textAlign: "center",
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textSecondary,
    },
    compBars: {
      flexDirection: "row",
      gap: theme.spacing[8],
    },
    compBarTrackLeft: {
      flex: 1,
      flexDirection: "row",
      justifyContent: "flex-end",
    },
    compBarTrackRight: {
      flex: 1,
      flexDirection: "row",
      justifyContent: "flex-start",
    },
    compBarAway: {
      height: 8,
      borderRadius: theme.radius.pill,
      backgroundColor: isDark ? "rgba(240, 244, 250, 0.9)" : "#a8b9d3",
    },
    compBarHome: {
      height: 8,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.accentStrong,
    },
    // Generic compact rows (leads, runs, streaks)
    rowList: {
      marginTop: theme.spacing[12],
      gap: theme.spacing[8],
    },
    infoRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[10],
    },
    infoLogo: {
      width: 26,
      height: 26,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
    },
    infoBody: {
      flex: 1,
      minWidth: 0,
    },
    infoTitle: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    infoDetail: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textSecondary,
      marginTop: theme.spacing[2],
    },
    infoTrailing: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    runScore: {
      minWidth: 52,
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      textAlign: "center",
    },
    footerNote: {
      marginTop: theme.spacing[10],
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    playerPhotoWrap: {
      position: "relative",
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
    },
    playerPhoto: {
      width: 34,
      height: 34,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
      // Explicit zIndex so the photo layers above FireRingGlow (zIndex 0).
      zIndex: 2,
    },
  });
}

export default function TeamStatsTab() {
  const { data, mode } = useLiveGame();
  const { state: settingsState } = useSettingsState();
  const { tokens: theme, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);

  const teams = data?.teams ?? [];
  const playersByTeam = data?.playersByTeam ?? {};
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];

  const awayColor = normalizeTeamColor(away?.color, theme.colors.textSecondary);
  const homeColor = normalizeTeamColor(home?.color, theme.colors.accentStrong);
  const awayAbbr = teamAbbr(away, "AWAY");
  const homeAbbr = teamAbbr(home, "HOME");
  const awayLogo = away?.logo || FALLBACK_IMAGE_URI;
  const homeLogo = home?.logo || FALLBACK_IMAGE_URI;

  // Real game data from the shared ESPN-backed live game feed.
  const regulationPeriods = mode === "nba" ? 4 : 2;
  const scoreMargin = data?.scoreMargin ?? [];
  const comparisonRows = useMemo(
    () => buildComparisonRows(away?.totals, home?.totals),
    [away?.totals, home?.totals],
  );
  const awayLinescores = away?.linescores ?? [];
  const homeLinescores = home?.linescores ?? [];
  const periodCount = Math.max(awayLinescores.length, homeLinescores.length);
  const periodColumns = useMemo(
    () =>
      Array.from({ length: periodCount }, (_, index) =>
        periodShortLabel(index, regulationPeriods),
      ),
    [periodCount, regulationPeriods],
  );

  const awayTop = pickTopPlayer(away?.id ? playersByTeam[away.id] : undefined);
  const homeTop = pickTopPlayer(home?.id ? playersByTeam[home.id] : undefined);

  const availableSectionIds = useMemo(
    () => [
      "point-differential",
      "score-by-half",
      "comparison",
      "biggest-leads",
      "runs",
      "player-streaks",
    ],
    [],
  );
  useRegisterInGameSections("team-stats", availableSectionIds);
  const visibleSectionIds = useMemo(() => {
    const resolved = resolveInGameSectionIds(
      "team-stats",
      settingsState.inGame.sectionLayoutsByTab,
      availableSectionIds,
    ).visibleIds;
    // Point Differential must render above Score by Half regardless of any
    // previously-saved custom section order (a saved layout from before this
    // pair was reordered would otherwise keep the old order forever, since
    // the settings layer only fills in ids that are missing, never reorders
    // ids that are already present).
    const pointDiffIndex = resolved.indexOf("point-differential");
    const scoreByHalfIndex = resolved.indexOf("score-by-half");
    if (
      pointDiffIndex !== -1 &&
      scoreByHalfIndex !== -1 &&
      pointDiffIndex > scoreByHalfIndex
    ) {
      const reordered = [...resolved];
      reordered.splice(pointDiffIndex, 1);
      reordered.splice(scoreByHalfIndex, 0, "point-differential");
      return reordered;
    }
    return resolved;
  }, [availableSectionIds, settingsState.inGame.sectionLayoutsByTab]);


  const runTeam = (key: "away" | "home") =>
    key === "home"
      ? { logo: homeLogo, abbr: homeAbbr }
      : { logo: awayLogo, abbr: awayAbbr };

  const sectionNodes = useMemo<Record<string, ReactNode>>(
    () => ({
      "score-by-half": (
        <Card key="score-by-half">
          <SectionHeader title="Score by Half" />
          <ScoreByHalfTable
            away={{ logo: awayLogo, abbr: awayAbbr, linescores: awayLinescores }}
            home={{ logo: homeLogo, abbr: homeAbbr, linescores: homeLinescores }}
            periodColumns={periodColumns}
          />
        </Card>
      ),
      "point-differential": (
        <Card key="point-differential">
          <SectionHeader title="Point Differential" />
          <PointDifferentialChart
            series={scoreMargin}
            regulationPeriods={regulationPeriods}
            awayColor={awayColor}
            homeColor={homeColor}
            awayAbbr={awayAbbr}
            homeAbbr={homeAbbr}
          />
        </Card>
      ),
      comparison: (
        <Card key="comparison">
          <SectionHeader title="Team Comparison" />
          <View style={styles.compStack}>
            {comparisonRows.map((row) => (
              <ComparisonRow key={row.label} row={row} styles={styles} />
            ))}
          </View>
        </Card>
      ),
      "biggest-leads": (
        <Card key="biggest-leads">
          <SectionHeader title="Biggest Leads" />
          <View style={styles.rowList}>
            {[
              { logo: awayLogo, abbr: awayAbbr, lead: BIGGEST_LEADS.away },
              { logo: homeLogo, abbr: homeAbbr, lead: BIGGEST_LEADS.home },
            ].map((entry) => (
              <View key={entry.abbr} style={styles.infoRow}>
                <Image source={{ uri: entry.logo }} style={styles.infoLogo} />
                <View style={styles.infoBody}>
                  <Text style={styles.infoTitle} numberOfLines={1}>
                    {entry.abbr}
                  </Text>
                  <Text style={styles.infoDetail} numberOfLines={1}>
                    Biggest lead: {entry.lead.lead} at {entry.lead.time}
                  </Text>
                </View>
                <Text style={styles.infoTrailing}>{entry.lead.lead}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.footerNote}>Lead changes: {BIGGEST_LEADS.leadChanges}</Text>
        </Card>
      ),
      runs: (
        <Card key="runs">
          <SectionHeader title="Runs" subtitle="Notable scoring runs" />
          <View style={styles.rowList}>
            {RUNS.map((run, index) => {
              const team = runTeam(run.teamKey);
              return (
                <View key={`${run.score}-${index}`} style={styles.infoRow}>
                  <Image source={{ uri: team.logo }} style={styles.infoLogo} />
                  <Text style={styles.runScore}>{run.score}</Text>
                  <View style={styles.infoBody}>
                    <Text style={styles.infoTitle} numberOfLines={1}>
                      {team.abbr}
                    </Text>
                    <Text style={styles.infoDetail} numberOfLines={1}>
                      {run.window}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </Card>
      ),
      "player-streaks": (
        <Card key="player-streaks">
          <SectionHeader title="Best Player Streaks" subtitle="Top scoring run per team" />
          <View style={styles.rowList}>
            {[
              { player: awayTop, name: awayTop?.name || PLAYER_STREAKS.away.name, detail: PLAYER_STREAKS.away.detail },
              { player: homeTop, name: homeTop?.name || PLAYER_STREAKS.home.name, detail: PLAYER_STREAKS.home.detail },
            ].map((entry) => (
              <View key={entry.name} style={styles.infoRow}>
                <View style={styles.playerPhotoWrap}>
                  {entry.player ? (
                    <FireRingGlow
                      active={isPlayerOnFire(entry.player)}
                      photoDiameter={34}
                      debugLabel="fire-ring:team-stats-streak"
                    />
                  ) : null}
                  <Image
                    source={{ uri: entry.player?.headshot || FALLBACK_IMAGE_URI }}
                    style={styles.playerPhoto}
                  />
                </View>
                <View style={styles.infoBody}>
                  <Text style={styles.infoTitle} numberOfLines={1}>
                    {entry.name}
                  </Text>
                  <Text style={styles.infoDetail} numberOfLines={1}>
                    {entry.detail}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </Card>
      ),
    }),
    [
      awayAbbr,
      awayColor,
      awayLogo,
      awayTop?.headshot,
      awayTop?.momentum,
      awayTop?.name,
      comparisonRows,
      homeAbbr,
      homeColor,
      homeLogo,
      homeTop?.headshot,
      homeTop?.momentum,
      homeTop?.name,
      awayLinescores,
      homeLinescores,
      periodColumns,
      periodCount,
      regulationPeriods,
      scoreMargin,
      styles,
      theme,
    ],
  );

  return (
    <GameTabScreenScaffold>
      <View style={styles.screenStack}>
        {data ? (
          visibleSectionIds.map((sectionId) => sectionNodes[sectionId] ?? null)
        ) : (
          // Brief window before any data has arrived — skeleton instead of
          // empty comparison rows/charts.
          <TabContentSkeleton cards={4} />
        )}
      </View>
    </GameTabScreenScaffold>
  );
}
