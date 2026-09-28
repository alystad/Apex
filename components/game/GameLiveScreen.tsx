import { useCallback, useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import GameTabScreenScaffold from "@/components/GameTabScreenScaffold";
import BiggestMomentsCard from "@/components/game/BiggestMomentsCard";
import GameInsightsCard from "@/components/game/GameInsightsCard";
import KingOfCourtCard from "@/components/game/KingOfCourtCard";
import HighlightsCard from "@/components/game/HighlightsCard";
import { periodShortLabel } from "@/components/game/PointDifferentialChart";
import ScoreByHalfTable from "@/components/game/ScoreByHalfTable";
import { selectTopPerformers } from "@/components/game/TopPerformersStrip";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import type { LiveGameData, LiveGamePlayer } from "@/hooks/useLiveGame";
import { useAiGameSummary } from "@/src/features/summary/aiGameSummary";
import { buildRecapMoments } from "@/src/features/recap/recapMoments";
import { computeCompetitiveness } from "@/src/features/recap/recapStats";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { useInGamePlayerModal } from "@/src/ui/inGamePlayerModalContext";
import { useInGameTabNavigation } from "@/src/ui/inGameTabNavigationContext";

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];

const TOP_PERFORMER_COUNT = 4;

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

export type GameLiveScreenProps = {
  data: LiveGameData;
};

/**
 * In-progress state of the story tab (the merged Preview → Live → Recap tab).
 *
 * Every section here is the SAME component the Recap state renders, fed
 * in-progress data instead of final data — King of the Court, Biggest
 * Moments, and Score by Half are all shared, so the two states can't
 * visually drift apart. Top Performers is deliberately NOT shown here
 * (Recap-only). The only Live-specific pieces are the status line and the
 * win-probability pill, both of which are meaningless once a game is over.
 */
export default function GameLiveScreen({ data }: GameLiveScreenProps) {
  const { tokens: theme } = useAppTheme();
  const { goToTab } = useInGameTabNavigation();
  const { openPlayerModal } = useInGamePlayerModal();
  // The live summary already regenerates on its own cadence (rate-limited,
  // and re-triggered when ratings move enough) — see AiGameSummaryProvider.
  const { summary, isGenerating, unavailable } = useAiGameSummary();

  const teams = data.teams ?? [];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];

  const awayAbbr = away?.abbreviation || away?.shortDisplayName || "AWAY";
  const homeAbbr = home?.abbreviation || home?.shortDisplayName || "HOME";
  const awayScore = Number.parseInt(away?.score ?? "", 10) || 0;
  const homeScore = Number.parseInt(home?.score ?? "", 10) || 0;

  const awayColor = normalizeHexColor(away?.color, theme.colors.accent);
  const homeColor = normalizeHexColor(home?.color, theme.colors.success);
  // Accent tracks whoever is currently ahead, so the hero re-tints as the
  // lead changes hands.
  const leaderColor =
    awayScore === homeScore
      ? theme.colors.accent
      : awayScore > homeScore
        ? awayColor
        : homeColor;

  const styles = useMemo(() => createStyles(theme, leaderColor), [theme, leaderColor]);

  const clockText = useMemo(() => {
    const period = data.status?.periodLabel || `Period ${data.status?.period ?? ""}`.trim();
    const clock = data.status?.displayClock || "";
    return [period, clock].filter(Boolean).join(" · ");
  }, [data.status?.displayClock, data.status?.period, data.status?.periodLabel]);

  // Score by Half shows every REGULATION period up front, with dashes for the
  // ones not played yet, so the table doesn't grow a column at a time as the
  // game progresses. Overtime columns append once they actually exist.
  const playedPeriods = Math.max(
    away?.linescores?.length ?? 0,
    home?.linescores?.length ?? 0,
  );
  const regulationPeriods = playedPeriods > 4 ? 4 : playedPeriods <= 2 ? 2 : 4;
  const periodColumns = useMemo(() => {
    const total = Math.max(regulationPeriods, playedPeriods);
    return Array.from({ length: total }, (_, index) =>
      periodShortLabel(index, regulationPeriods),
    );
  }, [playedPeriods, regulationPeriods]);

  const topPerformers = useMemo(
    () => selectTopPerformers(data, TOP_PERFORMER_COUNT),
    [data],
  );
  const kingOfCourt = topPerformers[0] ?? null;

  // No "lead for good" mid-game: there's no eventual winner yet, so it would
  // just label whoever is ahead right now as having sealed it.
  const moments = useMemo(
    () => buildRecapMoments(data, { includeDecider: false }),
    [data],
  );
  const competitiveness = useMemo(() => computeCompetitiveness(data), [data]);

  // Latest win-probability sample. Stored home-relative; flip for the away
  // side so the pill always describes whoever it names.
  const winProbability = useMemo(() => {
    const series = data.winProbability ?? [];
    const latest = series[series.length - 1];
    if (!latest || typeof latest.homeWinProb !== "number") {
      return null;
    }
    const homePct = Math.round(latest.homeWinProb * 100);
    const clamped = Math.max(0, Math.min(100, homePct));
    const favorHome = clamped >= 50;
    return {
      abbr: favorHome ? homeAbbr : awayAbbr,
      percent: favorHome ? clamped : 100 - clamped,
      color: favorHome ? homeColor : awayColor,
    };
  }, [awayAbbr, awayColor, data.winProbability, homeAbbr, homeColor]);

  const goToStats = useCallback(() => {
    goToTab("team-stats");
  }, [goToTab]);

  const handlePlayerPress = useCallback(
    (player: LiveGamePlayer) => {
      openPlayerModal(player);
    },
    [openPlayerModal],
  );

  const hasCompetitiveness = competitiveness.leadChanges > 0 || competitiveness.ties > 0;

  return (
    <GameTabScreenScaffold>
      <View style={styles.stack}>
        {/* ---- LIVE STATUS LEDE ----
            Same unboxed editorial treatment as the Recap state's hero, so the
            tab keeps a consistent shape as the game moves Preview → Live →
            Recap. */}
        <View style={styles.hero}>
          <View style={styles.heroAccentRule} />
          <View style={styles.heroBody}>
            <View style={styles.statusRow}>
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={styles.livePillText}>LIVE</Text>
              </View>
              {clockText ? <Text style={styles.clockText}>{clockText}</Text> : null}
            </View>

            <Text style={styles.scoreLine}>
              {awayAbbr} {awayScore} · {homeAbbr} {homeScore}
            </Text>

            {/* 4 — Live win probability pill. */}
            {winProbability ? (
              <View
                style={[
                  styles.winProbPill,
                  {
                    backgroundColor: withAlpha(winProbability.color, 0.16),
                    borderColor: withAlpha(winProbability.color, 0.45),
                  },
                ]}
              >
                <Text style={styles.winProbLabel}>Win probability</Text>
                <Text style={styles.winProbValue}>
                  {winProbability.abbr} {winProbability.percent}%
                </Text>
              </View>
            ) : null}

            {/* 1 — AI blurb on what's happening right now. */}
            {summary ? (
              <Text style={styles.blurb}>{summary}</Text>
            ) : isGenerating ? (
              <View style={styles.blurbLoading}>
                <ActivityIndicator size="small" color={theme.colors.textMuted} />
                <Text style={styles.blurbLoadingText}>Reading the game…</Text>
              </View>
            ) : unavailable ? (
              <Text style={styles.blurbMuted}>Live analysis unavailable right now.</Text>
            ) : null}

            {hasCompetitiveness ? (
              <Text style={styles.competitiveness}>
                Lead changed {competitiveness.leadChanges}{" "}
                {competitiveness.leadChanges === 1 ? "time" : "times"} · Tied{" "}
                {competitiveness.ties} {competitiveness.ties === 1 ? "time" : "times"}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Insights — real-time for a game in progress. Sits directly below
            the hero (headline + AI blurb), matching the slot the Preview
            tab's own Insights card occupies relative to ITS top content —
            early in the stack rather than after the supporting data below.
            Separate implementation from Preview's; that one is untouched. */}
        <GameInsightsCard data={data} phase="live" />

        {/* ---- SUPPORTING DATA (all shared with the Recap state) ---- */}

        {/* 5 — Score by Half, partial: dashes for periods not yet played. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Score by half, open Stats"
          onPress={goToStats}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <Card>
            <SectionHeader title="Score by Half" />
            <ScoreByHalfTable
              away={{
                logo: away?.logo ?? "",
                abbr: awayAbbr,
                linescores: away?.linescores ?? [],
              }}
              home={{
                logo: home?.logo ?? "",
                abbr: homeAbbr,
                linescores: home?.linescores ?? [],
              }}
              periodColumns={periodColumns}
            />
          </Card>
        </Pressable>

        {/* 2 — Current King of the Court, live-updating. */}
        {kingOfCourt ? (
          <KingOfCourtCard
            player={kingOfCourt}
            variant="detailed"
            onPress={handlePlayerPress}
          />
        ) : null}

        {/* 3 — Biggest moments so far. */}
        <BiggestMomentsCard moments={moments} title="Biggest Moments So Far" />

        {/* Narrated highlight reel, appended to as the game unfolds. Same
            position as the Recap state's, directly after Biggest Moments. */}
        <HighlightsCard data={data} title="Highlights So Far" />

        {/* The scaffold shifts scrolling content up via a collapsing-header
            transform the ScrollView's content size doesn't account for —
            without this spacer the last card gets clipped off-screen. */}
        <View style={styles.bottomSpacer} />
      </View>
    </GameTabScreenScaffold>
  );
}

function createStyles(theme: AppThemeTokens, accent: string) {
  return StyleSheet.create({
    stack: {
      gap: theme.spacing[12],
    },
    pressed: {
      opacity: 0.85,
    },
    bottomSpacer: {
      height: theme.spacing[40],
    },

    // ---- Hero / live status ----
    hero: {
      flexDirection: "row",
      gap: theme.spacing[12],
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[6],
    },
    heroAccentRule: {
      width: 3,
      borderRadius: theme.radius.pill,
      backgroundColor: accent,
    },
    heroBody: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[10],
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    livePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[2],
      borderRadius: theme.radius.pill,
      backgroundColor: withAlpha(theme.colors.danger, 0.16),
    },
    liveDot: {
      width: 6,
      height: 6,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.danger,
    },
    livePillText: {
      fontSize: 10,
      lineHeight: 13,
      fontWeight: "800",
      color: theme.colors.danger,
      letterSpacing: 0.8,
    },
    clockText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    scoreLine: {
      fontSize: 23,
      lineHeight: 29,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      letterSpacing: -0.3,
    },
    winProbPill: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[4],
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
    },
    winProbLabel: {
      fontSize: 10,
      lineHeight: 14,
      fontWeight: "800",
      color: theme.colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    winProbValue: {
      fontSize: 12,
      lineHeight: 15,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    blurb: {
      fontSize: 15,
      lineHeight: 23,
      fontWeight: "500",
      color: theme.colors.textSecondary,
    },
    blurbMuted: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
    blurbLoading: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    blurbLoadingText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
    competitiveness: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
  });
}
