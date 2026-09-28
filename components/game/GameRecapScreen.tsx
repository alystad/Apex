import { useCallback, useMemo } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";

import GameTabScreenScaffold from "@/components/GameTabScreenScaffold";
import BenchScoringCard from "@/components/game/BenchScoringCard";
import BiggestMomentsCard from "@/components/game/BiggestMomentsCard";
import BiggestSurpriseCard from "@/components/game/BiggestSurpriseCard";
import GameInsightsCard from "@/components/game/GameInsightsCard";
import KingOfCourtCard from "@/components/game/KingOfCourtCard";
import HighlightsCard from "@/components/game/HighlightsCard";
import PointDifferentialChart, {
  periodShortLabel,
} from "@/components/game/PointDifferentialChart";
import ScoreByHalfTable from "@/components/game/ScoreByHalfTable";
import TopPerformersStrip, {
  selectTopPerformers,
} from "@/components/game/TopPerformersStrip";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import type { LiveGameData, LiveGamePlayer } from "@/hooks/useLiveGame";
import { useAiGameSummary } from "@/src/features/summary/aiGameSummary";
import { buildRecapMoments } from "@/src/features/recap/recapMoments";
import {
  buildNotableStatLines,
  computeBenchScoring,
  computeBiggestSurprise,
  computeCompetitiveness,
  computeHowItWasWon,
} from "@/src/features/recap/recapStats";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { useInGamePlayerModal } from "@/src/ui/inGamePlayerModalContext";
import { useInGameTabNavigation } from "@/src/ui/inGameTabNavigationContext";

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const TOP_PERFORMER_COUNT = 4;

function normalizeHexColor(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const normalized = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : fallback;
}

/** Adds an alpha channel to a #RRGGBB hex, for tinted accents/backgrounds. */
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

/**
 * Fallback headline used until the AI recap resolves (or if it's
 * unavailable) — still a real, correct result line rather than a spinner or
 * empty space, just without the editorial hook.
 */
function buildFallbackHeadline(data: LiveGameData): string | null {
  const teams = data.teams ?? [];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];
  if (!away || !home) {
    return null;
  }
  const awayScore = Number.parseInt(away.score, 10) || 0;
  const homeScore = Number.parseInt(home.score, 10) || 0;
  const awayName = away.shortDisplayName || away.displayName;
  const homeName = home.shortDisplayName || home.displayName;
  if (awayScore === homeScore) {
    return `${awayName} and ${homeName} finish level, ${awayScore}-${homeScore}`;
  }
  const winnerName = awayScore > homeScore ? awayName : homeName;
  const loserName = awayScore > homeScore ? homeName : awayName;
  const high = Math.max(awayScore, homeScore);
  const low = Math.min(awayScore, homeScore);
  return `${winnerName} beat ${loserName}, ${high}-${low}`;
}

export type GameRecapScreenProps = {
  data: LiveGameData;
};

/**
 * Completed-game recap. Replaces the pregame Preview tab's content once a
 * game goes Final (same tab slot, relabelled "Recap" — see
 * app/(tabs)/preview.tsx and the tab-visibility logic in app/(tabs)/_layout.tsx).
 *
 * Layout is deliberately "story first, data second": an unboxed editorial
 * lede (headline + how-it-was-won badge + AI prose + quarter narrative)
 * sitting directly on the page, then the supporting data in the app's normal
 * cards below it. Every data section is a tap target into the tab that owns
 * the full version, and each of those is the SAME component that tab renders
 * rather than a reimplementation.
 */
export default function GameRecapScreen({ data }: GameRecapScreenProps) {
  const { tokens: theme } = useAppTheme();
  const { goToTab } = useInGameTabNavigation();
  const { openPlayerModal } = useInGamePlayerModal();
  const { recap, isGeneratingRecap, recapUnavailable } = useAiGameSummary();

  const teams = data.teams ?? [];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];

  const awayAbbr = away?.abbreviation || away?.shortDisplayName || "AWAY";
  const homeAbbr = home?.abbreviation || home?.shortDisplayName || "HOME";
  const awayColor = normalizeHexColor(away?.color, theme.colors.accent);
  const homeColor = normalizeHexColor(home?.color, theme.colors.success);

  const awayScore = Number.parseInt(away?.score ?? "", 10) || 0;
  const homeScore = Number.parseInt(home?.score ?? "", 10) || 0;
  // Accent the lede with the WINNING team's color so the hero block is tied
  // to the result rather than arbitrarily to the home side.
  const winnerColor =
    awayScore === homeScore
      ? normalizeHexColor(undefined, theme.colors.accent)
      : awayScore > homeScore
        ? awayColor
        : homeColor;

  const styles = useMemo(() => createStyles(theme, winnerColor), [theme, winnerColor]);

  const awayLinescores = away?.linescores ?? [];
  const homeLinescores = home?.linescores ?? [];
  const periodCount = Math.max(awayLinescores.length, homeLinescores.length);
  // Two linescore columns means halves (college), four-plus means quarters —
  // same convention the Stats tab uses.
  const regulationPeriods = periodCount <= 2 ? 2 : 4;
  const periodColumns = useMemo(
    () =>
      Array.from({ length: periodCount }, (_, index) =>
        periodShortLabel(index, regulationPeriods),
      ),
    [periodCount, regulationPeriods],
  );

  // Top performers across BOTH teams (not just the single King of the Court
  // winner), ranked by final rating with points as the tiebreak.
  const topPerformers = useMemo(
    () => selectTopPerformers(data, TOP_PERFORMER_COUNT),
    [data],
  );
  const kingOfCourt = topPerformers[0] ?? null;

  const moments = useMemo(() => buildRecapMoments(data), [data]);
  const competitiveness = useMemo(() => computeCompetitiveness(data), [data]);
  const notableLines = useMemo(() => buildNotableStatLines(data), [data]);
  const benchScoring = useMemo(() => computeBenchScoring(data), [data]);
  const howItWasWon = useMemo(() => computeHowItWasWon(data), [data]);
  const biggestSurprise = useMemo(() => computeBiggestSurprise(data), [data]);

  const headline = recap?.headline || buildFallbackHeadline(data);
  const story = recap?.story ?? null;

  // Only show quarter lines whose label actually matches a period this game
  // played, in the game's own period order — guards against the model
  // inventing a Q4 for a two-half college game.
  const quarterLines = useMemo(() => {
    const generated = recap?.quarters ?? [];
    if (generated.length === 0) {
      return [];
    }
    const byLabel = new Map(generated.map((entry) => [entry.label.toUpperCase(), entry]));
    return periodColumns
      .map((label) => {
        const match = byLabel.get(label.toUpperCase());
        return match ? { label, text: match.text } : null;
      })
      .filter((entry): entry is { label: string; text: string } => entry !== null);
  }, [periodColumns, recap?.quarters]);

  const goToStats = useCallback(() => {
    goToTab("team-stats");
  }, [goToTab]);

  const handlePlayerPress = useCallback(
    (player: LiveGamePlayer) => {
      openPlayerModal(player);
    },
    [openPlayerModal],
  );

  const hasCompetitiveness =
    competitiveness.leadChanges > 0 || competitiveness.ties > 0;

  return (
    <GameTabScreenScaffold>
      <View style={styles.stack}>
        {/* ---- HERO / LEDE -------------------------------------------------
            Carded like every other section on this tab. Its "lede" role is
            carried by type hierarchy INSIDE the card (a larger, heavier
            headline over lighter prose) rather than by sitting uncontained on
            the page, which read as inconsistent next to the other cards. */}
        <Card>
          <View style={styles.hero}>
            {/* Tier 1 — headline: largest, heaviest, first thing read. */}
            {headline ? <Text style={styles.headline}>{headline}</Text> : null}

            {/* "How it was won" sits UNDER the headline as an attribute of it,
                not above as a floating orphan tag. */}
            {howItWasWon ? (
              <View style={styles.howWonBadge}>
                <Text style={styles.howWonLabel}>{howItWasWon.label}</Text>
                <Text style={styles.howWonDetail}>{howItWasWon.detail}</Text>
              </View>
            ) : null}

            {/* Tier 2 — the prose recap: smaller and lighter than the headline. */}
            {story ? (
              <Text style={styles.story}>{story}</Text>
            ) : isGeneratingRecap ? (
              <View style={styles.storyLoading}>
                <ActivityIndicator size="small" color={theme.colors.textMuted} />
                <Text style={styles.storyLoadingText}>Writing the recap…</Text>
              </View>
            ) : recapUnavailable ? (
              <Text style={styles.storyMuted}>Recap unavailable right now.</Text>
            ) : null}

            {/* Tier 3 — quarter breakdown as its own labeled sub-section,
                divided off from the prose above so it reads as a timeline
                rather than a continuation of the paragraph. */}
            {quarterLines.length > 0 ? (
              <View style={styles.quarterSection}>
                <Text style={styles.quarterSectionLabel}>How it unfolded</Text>
                <View style={styles.quarterList}>
                  {quarterLines.map((entry) => (
                    <View key={entry.label} style={styles.quarterRow}>
                      <View style={styles.quarterChip}>
                        <Text style={styles.quarterChipText}>{entry.label}</Text>
                      </View>
                      <Text style={styles.quarterText}>{entry.text}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {hasCompetitiveness ? (
              <Text style={styles.competitiveness}>
                Lead changed {competitiveness.leadChanges}{" "}
                {competitiveness.leadChanges === 1 ? "time" : "times"} · Tied{" "}
                {competitiveness.ties} {competitiveness.ties === 1 ? "time" : "times"}
              </Text>
            ) : null}
          </View>
        </Card>

        {/* ---- SUPPORTING DATA --------------------------------------------- */}

        {/* Score by Half strip; taps through to the full Stats tab. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Score by half, open Stats"
          onPress={goToStats}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <Card>
            <SectionHeader title="Score by Half" />
            <ScoreByHalfTable
              away={{ logo: away?.logo ?? "", abbr: awayAbbr, linescores: awayLinescores }}
              home={{ logo: home?.logo ?? "", abbr: homeAbbr, linescores: homeLinescores }}
              periodColumns={periodColumns}
            />
          </Card>
        </Pressable>

        {/* Bench vs. starters, as a stacked bar per team. */}
        <BenchScoringCard comparison={benchScoring} data={data} />

        {/* King of the Court; opens that player's detail modal. */}
        {kingOfCourt ? (
          <KingOfCourtCard
            player={kingOfCourt}
            variant="detailed"
            onPress={handlePlayerPress}
          />
        ) : null}

        {/* Narrated highlight reel — the full game's moments in order. Sits
            directly after Biggest Moments, which is the same signal set in
            condensed form. */}
        <BiggestMomentsCard moments={moments} />
        <HighlightsCard data={data} />

        {/* 3 — Notable individual stat lines; tapping opens the player modal. */}
        {notableLines.length > 0 ? (
          <Card>
            <SectionHeader title="Notable Performances" />
            <View style={styles.rowList}>
              {notableLines.map((entry) => (
                <Pressable
                  key={entry.player.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${entry.player.name}: ${entry.statLine}, ${entry.badge}. Open player details.`}
                  onPress={() => handlePlayerPress(entry.player)}
                  style={({ pressed }) => [styles.listRow, pressed ? styles.pressed : null]}
                >
                  <Image
                    source={{ uri: entry.player.headshot || FALLBACK_IMAGE_URI }}
                    style={styles.notablePhoto}
                  />
                  <View style={styles.listBody}>
                    <Text style={styles.listTitle} numberOfLines={1}>
                      {entry.player.shortName || entry.player.name}
                    </Text>
                    <Text style={styles.listDetail} numberOfLines={1}>
                      {entry.statLine}
                    </Text>
                  </View>
                  <View style={styles.notableBadge}>
                    {/* No numberOfLines cap and no maxWidth: badge labels are
                        already short (see buildNotableStatLines), and letting
                        the pill size to its text is what stops "NEAR TRIPLE-D…"
                        style mid-word truncation. */}
                    <Text style={styles.notableBadgeText}>{entry.badge}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </Card>
        ) : null}

        {/* Biggest Surprise — final rating vs. season rating, deterministic
            (not AI prose), so it sits with the other computed stat cards. */}
        <BiggestSurpriseCard entries={biggestSurprise} onPlayerPress={handlePlayerPress} />

        {/* Top performers across both teams; each opens a player modal. */}
        <TopPerformersStrip players={topPerformers} data={data} />

        {/* Insights — retrospective for a finished game. Sits here to match
            the slot the Preview tab's own Insights card occupies (late in the
            stack, after the supporting data). Separate implementation from
            Preview's; that one is untouched. */}
        <GameInsightsCard data={data} phase="recap" />

        {/* Point Differential mini-chart; taps through to the Stats tab. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Point differential, open Stats"
          onPress={goToStats}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <Card>
            <SectionHeader title="Point Differential" />
            <PointDifferentialChart
              series={data.scoreMargin ?? []}
              regulationPeriods={regulationPeriods}
              awayColor={awayColor}
              homeColor={homeColor}
              awayAbbr={awayAbbr}
              homeAbbr={homeAbbr}
              compact
            />
          </Card>
        </Pressable>

        {/* The scaffold's scrolling content is shifted up by a collapsing-header
            transform, which the ScrollView's own content size doesn't account
            for — without this spacer the LAST card (the chart, whose axis
            labels sit right at its bottom edge) gets clipped off-screen. */}
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

    // ---- Hero / lede ----
    // Lives inside a Card (which supplies its own padding), so this only owns
    // the spacing BETWEEN the lede's tiers. Hierarchy comes from type
    // size/weight/color, not from decoration.
    hero: {
      gap: theme.spacing[12],
    },
    // Tier 1: the largest, heaviest text on the page.
    headline: {
      fontSize: 26,
      lineHeight: 32,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      letterSpacing: -0.4,
    },
    // Attribute of the headline, so it sits directly beneath it with tighter
    // spacing than the gap between tiers.
    howWonBadge: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
      marginTop: -theme.spacing[4],
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[4],
      borderRadius: theme.radius.pill,
      backgroundColor: withAlpha(accent, 0.16),
      borderWidth: theme.borderWidth.normal,
      borderColor: withAlpha(accent, 0.45),
    },
    howWonLabel: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    howWonDetail: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    // Tier 2: clearly subordinate to the headline — smaller, lighter weight,
    // muted color.
    story: {
      fontSize: 14,
      lineHeight: 22,
      fontWeight: "400",
      color: theme.colors.textSecondary,
    },
    storyMuted: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
    storyLoading: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    storyLoadingText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },

    // ---- Tier 3: quarter-by-quarter narrative ----
    // Its own labeled sub-section behind a divider, so it reads as a timeline
    // rather than more of the paragraph above it.
    quarterSection: {
      gap: theme.spacing[8],
      paddingTop: theme.spacing[12],
      borderTopWidth: theme.borderWidth.hairline,
      borderTopColor: theme.colors.borderSoft,
    },
    quarterSectionLabel: {
      fontSize: 10,
      lineHeight: 13,
      fontWeight: "800",
      color: theme.colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    quarterList: {
      gap: theme.spacing[8],
    },
    quarterRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing[10],
    },
    quarterChip: {
      minWidth: 32,
      paddingHorizontal: theme.spacing[6],
      paddingVertical: theme.spacing[2],
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceAlt,
      alignItems: "center",
    },
    quarterChipText: {
      fontSize: 10,
      lineHeight: 14,
      fontWeight: "800",
      color: theme.colors.textSecondary,
      letterSpacing: 0.4,
    },
    quarterText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: "500",
      color: theme.colors.textSecondary,
    },
    competitiveness: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },

    // ---- Notable Performances list rows ----
    rowList: {
      marginTop: theme.spacing[10],
      gap: theme.spacing[4],
    },
    listRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
      paddingVertical: theme.spacing[8],
    },
    listBody: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[2],
    },
    listTitle: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    listDetail: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },

    // ---- Notable performances ----
    notablePhoto: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.colors.surfaceAlt,
    },
    notableBadge: {
      // No maxWidth — the pill sizes to its (already short) label instead of
      // clipping it. flexShrink:0 keeps the row's flexible middle column from
      // squeezing it.
      flexShrink: 0,
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[4],
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: theme.borderWidth.hairline,
      borderColor: theme.colors.borderSoft,
    },
    notableBadgeText: {
      fontSize: 10,
      lineHeight: 13,
      fontWeight: "800",
      color: theme.colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },

  });
}
