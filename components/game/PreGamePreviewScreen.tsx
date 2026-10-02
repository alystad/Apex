import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

import GameTabScreenScaffold from "@/components/GameTabScreenScaffold";
import CompactVoteStrip from "@/components/game/preview/CompactVoteStrip";
import H2HCard, { type H2HData, type H2HMeeting } from "@/components/game/preview/H2HCard";
import MatchupComparison, {
  type MatchupMetricRow,
} from "@/components/game/preview/MatchupComparison";
import TeamLeadersCard, {
  EMPTY_LEADER,
  EMPTY_LEADERS,
  type LeaderEntry,
  type LeaderStatLine,
  type TeamLeadersData,
} from "@/components/game/preview/TeamLeadersCard";
import {
  previewSectionTitleStyle,
  teamShortLabel,
} from "@/components/game/preview/previewShared";
import Card from "@/components/ui/Card";
import {
  useLiveGame,
  type LiveGameData,
  type LiveGamePlayer,
  type LiveGameTeam,
} from "@/hooks/useLiveGame";
import {
  getTeamGames,
  getTeamPlayerStats,
  type TeamGame,
  type TeamPlayerStats,
} from "@/src/features/basketball/teamApi";
import type { ProBasketballLeague } from "@/src/features/nba/proBasketballLeague";
import type { GamePrediction, PredictionGameSnapshot } from "@/src/profile/profileTypes";
import { useAppTheme } from "@/src/theme/useAppTheme";
import type { ThemeTokens } from "@/src/theme/tokens";

// Team Leaders cards are always pre-game content (this whole screen only
// renders before tip-off — see app/(tabs)/preview.tsx), so unlike the Court
// tab's isPreGame branch in app/(tabs)/live.tsx, tapping a leader always
// goes straight to their profile rather than ever opening the in-game modal.
function handleLeaderPress(player: LiveGamePlayer): void {
  if (!player.id) {
    return;
  }
  router.push(`/player/${player.id}` as never);
}

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const INSIGHTS_SYSTEM_PROMPT =
  "You are a sharp basketball analyst writing a pre-game preview. Respond with strict JSON only. " +
  "Each insight is ONE concise factual sentence and must add NEW information the app does not already " +
  "display elsewhere (never restate PPG, points allowed, 3PT%, win probability, statistical leaders, " +
  "recent win-loss form, or the head-to-head series record).";
const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
// How many seasons of game logs to scan when building the all-time series.
const H2H_SEASON_LOOKBACK = 10;

type TeamInsights = { away: string[]; home: string[] };

type PreviewState = {
  teamForm: Record<string, TeamGame[]>;
  matchupMetrics: MatchupMetricRow[];
  teamLeaders: TeamLeadersData;
  h2h: H2HData;
  insights: TeamInsights;
  insightsUnavailable: boolean;
  apexArticle: string | null;
};

const EMPTY_H2H: H2HData = { awayWins: 0, homeWins: 0, meetings: [] };
const EMPTY_INSIGHTS: TeamInsights = { away: [], home: [] };

type PreGamePreviewScreenProps = {
  data: LiveGameData;
  predictionSnapshot: PredictionGameSnapshot;
  prediction?: GamePrediction | null;
  onSavePrediction: (pickedTeamId: string) => void;
  onMeetingPress?: (gameId: string) => void;
};

export default function PreGamePreviewScreen({
  data,
  prediction,
  onSavePrediction,
  onMeetingPress,
}: PreGamePreviewScreenProps) {
  const { proLeague } = useLiveGame();
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const teams = data.teams ?? [];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];
  const [previewState, setPreviewState] = useState<PreviewState>({
    teamForm: {},
    matchupMetrics: [],
    teamLeaders: EMPTY_LEADERS,
    h2h: EMPTY_H2H,
    insights: EMPTY_INSIGHTS,
    insightsUnavailable: false,
    apexArticle: null,
  });
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [apexModalOpen, setApexModalOpen] = useState(false);
  const loadedPreviewKeyRef = useRef<string | null>(null);

  // Win probability comes from the SAME source that powers the Odds tab's
  // Momentum chart (data.winProbability) so the numbers can never drift apart.
  const winProbPoints = data.winProbability ?? [];
  const latestWinProb =
    winProbPoints.length > 0 ? winProbPoints[winProbPoints.length - 1] : null;
  const homeWinPct = latestWinProb
    ? Math.round(clamp01(latestWinProb.homeWinProb) * 100)
    : null;
  const awayWinPct = latestWinProb
    ? Math.round((1 - clamp01(latestWinProb.homeWinProb)) * 100)
    : null;

  const newsHeadline = useMemo(() => buildNewsHeadline(data, away, home), [data, away, home]);

  useEffect(() => {
    let cancelled = false;
    const previewKey = `${data.mode === "nba" ? `${data.mode}:${proLeague}` : data.mode}:${data.eventId}`;

    if (loadedPreviewKeyRef.current === previewKey) {
      setLoadingPreview(false);
      return;
    }

    const loadPreview = async () => {
      setLoadingPreview(true);
      const season = resolveSeason(data.meta.startDateTime);
      const emptyPage = { rows: [] as TeamGame[], page: 0, hasMore: false, total: 0 };

      const [awayGamesR, homeGamesR, awayStatsR, homeStatsR, h2hR] =
        await Promise.allSettled([
          away?.id
            ? getTeamGames(data.mode, away.id, season, 0, 50, "all", "", proLeague)
            : Promise.resolve(emptyPage),
          home?.id
            ? getTeamGames(data.mode, home.id, season, 0, 50, "all", "", proLeague)
            : Promise.resolve(emptyPage),
          away?.id
            ? getTeamPlayerStats(data.mode, away.id, season, proLeague)
            : Promise.resolve([] as TeamPlayerStats[]),
          home?.id
            ? getTeamPlayerStats(data.mode, home.id, season, proLeague)
            : Promise.resolve([] as TeamPlayerStats[]),
          buildH2H(data.mode, proLeague, away, home, season),
        ]);

      if (cancelled) {
        return;
      }

      const awayGames = awayGamesR.status === "fulfilled" ? awayGamesR.value.rows : [];
      const homeGames = homeGamesR.status === "fulfilled" ? homeGamesR.value.rows : [];
      let awayStats = awayStatsR.status === "fulfilled" ? awayStatsR.value : [];
      let homeStats = homeStatsR.status === "fulfilled" ? homeStatsR.value : [];
      const h2h = h2hR.status === "fulfilled" ? h2hR.value : EMPTY_H2H;

      // Try the prior season for any team that returned empty stats. College sports
      // seasons span two calendar years (e.g. 2025-26), so a January 2026 game
      // resolves to season=2026 but the API stores the data under season=2025.
      if ((awayStats.length === 0 || homeStats.length === 0) && (away?.id || home?.id)) {
        const [awayFallback, homeFallback] = await Promise.all([
          awayStats.length === 0 && away?.id
            ? getTeamPlayerStats(data.mode, away.id, season - 1, proLeague).catch(() => [] as TeamPlayerStats[])
            : Promise.resolve(awayStats),
          homeStats.length === 0 && home?.id
            ? getTeamPlayerStats(data.mode, home.id, season - 1, proLeague).catch(() => [] as TeamPlayerStats[])
            : Promise.resolve(homeStats),
        ]);
        awayStats = awayFallback;
        homeStats = homeFallback;
      }

      if (cancelled) {
        return;
      }

      const teamForm: Record<string, TeamGame[]> = {};
      if (away?.id) {
        teamForm[away.id] = getPastGamesBeforeCurrentGame(
          awayGames,
          data.eventId,
          data.meta.startDateTime,
        );
      }
      if (home?.id) {
        teamForm[home.id] = getPastGamesBeforeCurrentGame(
          homeGames,
          data.eventId,
          data.meta.startDateTime,
        );
      }

      const matchupMetrics = buildMatchupMetrics(awayGames, homeGames, away, home);
      const teamLeaders = buildTeamLeaders(awayStats, homeStats, away?.id ?? "", home?.id ?? "");

      // Patch the leader from live game player data when API stats aren't available.
      const livePlayers = data.playersByTeam ?? {};
      if (teamLeaders.away.value === "-" && away?.id && (livePlayers[away.id]?.length ?? 0) > 0) {
        teamLeaders.away = buildRatingLeaderFromLivePlayers(livePlayers[away.id]);
      }
      if (teamLeaders.home.value === "-" && home?.id && (livePlayers[home.id]?.length ?? 0) > 0) {
        teamLeaders.home = buildRatingLeaderFromLivePlayers(livePlayers[home.id]);
      }

      const [insightsResult, apexArticle] = await Promise.all([
        generateInsights({ away, home, teamForm, leaders: teamLeaders }),
        generateApexArticle({ away, home, teamForm, leaders: teamLeaders }),
      ]);

      if (cancelled) {
        return;
      }

      setPreviewState({
        teamForm,
        matchupMetrics,
        teamLeaders,
        h2h,
        insights: insightsResult.insights,
        insightsUnavailable: insightsResult.unavailable,
        apexArticle,
      });
      loadedPreviewKeyRef.current = previewKey;
      setLoadingPreview(false);
    };

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [away, data.eventId, data.meta.startDateTime, data.mode, home, proLeague]);

  const insightGroups = [
    { team: away, list: previewState.insights.away },
    { team: home, list: previewState.insights.home },
  ];

  return (
    <GameTabScreenScaffold>
      <CompactVoteStrip
        title="Who Will Win"
        options={[
          { key: away?.id ?? "away", logoUri: away?.logo, label: teamShortLabel(away) },
          { key: home?.id ?? "home", logoUri: home?.logo, label: teamShortLabel(home) },
        ]}
        selectedKey={prediction?.pickedTeamId ?? null}
        onSelect={(key) => onSavePrediction(key)}
      />

      <MatchupComparison
        away={away}
        home={home}
        awayWinPct={awayWinPct}
        homeWinPct={homeWinPct}
        metrics={previewState.matchupMetrics}
      />
      <TeamLeadersCard
        away={away}
        home={home}
        leaders={previewState.teamLeaders}
        onPlayerPress={handleLeaderPress}
      />

      <Card elevated>
        <Text style={styles.cardTitle}>Insights</Text>
        {loadingPreview ? (
          <Text style={styles.mutedText}>Loading preview insights...</Text>
        ) : previewState.insightsUnavailable ? (
          <Text style={styles.mutedText}>Insights unavailable</Text>
        ) : (
          <View style={styles.insightsGroups}>
            {insightGroups.map(({ team, list }, groupIndex) => (
              <View key={team?.id ?? groupIndex} style={styles.insightTeamBlock}>
                <View style={styles.insightTeamHeader}>
                  <Image
                    source={{ uri: normalizeImageUri(team?.logo) }}
                    style={styles.insightTeamLogo}
                  />
                  <Text style={styles.insightTeamLabel}>{teamShortLabel(team)}</Text>
                </View>
                {list.length === 0 ? (
                  <Text style={styles.mutedText}>No insights available.</Text>
                ) : (
                  list.map((text, index) => (
                    <View key={index} style={styles.insightRow}>
                      <View style={styles.insightBullet} />
                      <Text style={styles.insightText}>{text}</Text>
                    </View>
                  ))
                )}
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card elevated>
        <Text style={styles.cardTitle}>Past 5 Games</Text>
        <View style={styles.twoColumnRow}>
          {[away, home].filter(Boolean).map((team) => (
            <View key={team.id} style={styles.formColumn}>
              <View style={styles.formList}>
                {(previewState.teamForm[team.id] ?? []).map((game) => (
                  <View key={game.gameId} style={styles.formItem}>
                    <View
                      style={[
                        styles.formLogoBubble,
                        didTeamWin(game) ? styles.formWinnerBubble : null,
                      ]}
                    >
                      <Image
                        source={{ uri: normalizeImageUri(team.logo) }}
                        style={[
                          styles.formOpponentLogo,
                          didTeamWin(game) ? null : styles.formLoserLogo,
                        ]}
                      />
                    </View>
                    <Text style={styles.formScore}>
                      {formatTeamPerspectiveScore(game)}
                    </Text>
                    <View
                      style={[
                        styles.formLogoBubble,
                        didTeamWin(game) ? null : styles.formWinnerBubble,
                      ]}
                    >
                      <Image
                        source={{ uri: normalizeImageUri(game.opponentLogo) }}
                        style={[
                          styles.formOpponentLogo,
                          didTeamWin(game) ? styles.formLoserLogo : null,
                        ]}
                      />
                    </View>
                  </View>
                ))}
                {(previewState.teamForm[team.id] ?? []).length === 0 ? (
                  <Text style={styles.emptyText}>Recent form unavailable</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </Card>

      {previewState.h2h.meetings.length > 0 ? (
        <H2HCard
          away={away}
          home={home}
          h2h={previewState.h2h}
          onMeetingPress={onMeetingPress}
        />
      ) : null}
      {previewState.apexArticle ? (
        <Card elevated>
          <Pressable
            onPress={() => setApexModalOpen(true)}
            style={({ pressed }) => [styles.apexButton, pressed ? styles.apexButtonPressed : null]}
          >
            <View style={styles.apexButtonTag}>
              <Text style={styles.apexButtonTagText}>Apex AI</Text>
            </View>
            <Text style={styles.apexButtonLabel}>Read Apex Preview</Text>
          </Pressable>
        </Card>
      ) : null}

      <Modal
        visible={apexModalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setApexModalOpen(false)}
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Apex Preview</Text>
            <Pressable
              onPress={() => setApexModalOpen(false)}
              style={styles.modalCloseButton}
              accessibilityLabel="Close article"
            >
              <Text style={styles.modalCloseText}>Done</Text>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.modalContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.articleText}>{previewState.apexArticle}</Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </GameTabScreenScaffold>
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, value));
}

function buildNewsHeadline(
  data: LiveGameData,
  away: LiveGameTeam | undefined,
  home: LiveGameTeam | undefined,
): string {
  const awayName = away?.shortDisplayName || away?.displayName || "Away";
  const homeName = home?.shortDisplayName || home?.displayName || "Home";
  const venue = data.meta?.venue?.trim();
  if (venue) {
    return `${awayName} visit ${homeName} at ${venue}`;
  }
  return `${awayName} take on ${homeName}`;
}

// --- Matchup metrics -------------------------------------------------------

function averageScore(rows: TeamGame[], which: "team" | "opp"): number | null {
  const values = rows
    .filter(
      (row) =>
        row.completed &&
        typeof row.teamScore === "number" &&
        typeof row.opponentScore === "number",
    )
    .map((row) => (which === "team" ? (row.teamScore as number) : (row.opponentScore as number)));
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parsePctNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = value.replace(/−/g, "-").match(/-?\d+(\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildMetricRow(
  label: string,
  awayNum: number | null,
  homeNum: number | null,
  lowerIsBetter: boolean,
  suffix: string,
): MatchupMetricRow {
  const format = (value: number | null) =>
    value === null ? "-" : `${value.toFixed(1)}${suffix}`;
  const awayValue = awayNum ?? 0;
  const homeValue = homeNum ?? 0;
  const total = awayValue + homeValue;
  let awayShare = 50;
  if (total > 0) {
    const rawAwayShare = (awayValue / total) * 100;
    awayShare = lowerIsBetter ? 100 - rawAwayShare : rawAwayShare;
  }
  return {
    label,
    awayValue: format(awayNum),
    homeValue: format(homeNum),
    awayShare,
  };
}

function buildMatchupMetrics(
  awayGames: TeamGame[],
  homeGames: TeamGame[],
  awayTeam: LiveGameTeam | undefined,
  homeTeam: LiveGameTeam | undefined,
): MatchupMetricRow[] {
  return [
    buildMetricRow("PPG", averageScore(awayGames, "team"), averageScore(homeGames, "team"), false, ""),
    buildMetricRow(
      "Points Allowed",
      averageScore(awayGames, "opp"),
      averageScore(homeGames, "opp"),
      true,
      "",
    ),
    buildMetricRow(
      "3PT%",
      parsePctNumber(awayTeam?.totals?.threePtPct),
      parsePctNumber(homeTeam?.totals?.threePtPct),
      false,
      "%",
    ),
  ];
}

// --- Team leaders ----------------------------------------------------------

// Builds a LiveGamePlayer-shaped stand-in from SEASON stats so tapping a
// leader card can reuse the existing PlayerModal (which expects a live-game
// player) even before this game has any live box score. Fields the modal
// doesn't have a season equivalent for (rating timeline, momentum, on-court
// status, etc.) get safe empty/zero defaults rather than being omitted —
// PlayerModal always expects the full shape.
function buildModalPlayerFromTeamStats(
  player: TeamPlayerStats,
  teamId: string,
): LiveGamePlayer {
  const games = Math.max(1, player.games || 1);
  const fgmPerGame = player.fgm / games;
  const fgaPerGame = player.fga / games;
  const tpmPerGame = player.tpm / games;
  const tpaPerGame = player.tpa / games;
  const ftmPerGame = player.ftm / games;
  const ftaPerGame = player.fta / games;
  return {
    id: player.playerId,
    teamId,
    name: player.name,
    shortName: player.shortName || player.name,
    lastName: player.name.trim().split(/\s+/).pop() || player.name,
    jersey: player.jersey,
    position: player.position,
    headshot: player.headshot,
    starter: false,
    active: true,
    didNotPlay: false,
    minutes: player.perGame.minutes,
    minutesDisplay: player.perGame.minutes.toFixed(1),
    points: player.perGame.points,
    rebounds: player.perGame.rebounds,
    assists: player.perGame.assists,
    turnovers: player.perGame.turnovers,
    steals: player.perGame.steals,
    blocks: player.perGame.blocks,
    fouls: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    fg: `${fgmPerGame.toFixed(1)}-${fgaPerGame.toFixed(1)}`,
    threePt: `${tpmPerGame.toFixed(1)}-${tpaPerGame.toFixed(1)}`,
    ft: `${ftmPerGame.toFixed(1)}-${ftaPerGame.toFixed(1)}`,
    plusMinus: "-",
    plusMinusValue: 0,
    liveEffPerMin: 0,
    seasonEffPerMin: player.efficiency ?? null,
    seasonImpactRaw: null,
    inGameImpactRaw: null,
    liveRawBase: null,
    liveRaw: null,
    liveDisplay: "-",
    seasonRating10: player.seasonRating10,
    inGameRating10: player.seasonRating10,
    lowSample: false,
    gameRating: null,
    seasonRating: player.seasonRating10,
    gameRank: null,
    seasonRank: null,
    minutesIncreasing: false,
    onCourt: false,
    minuteDelta: 0,
    ratingTimelinePoints: [],
    momentum: null,
    momentumTimelinePoints: [],
    fgm: player.fgm,
    fga: player.fga,
    ftm: player.ftm,
    fta: player.fta,
    sport: player.sport,
    baseball: player.baseball ?? null,
  };
}

function statLineFromTeamStats(player: TeamPlayerStats): LeaderStatLine {
  return {
    points: player.perGame.points,
    rebounds: player.perGame.rebounds,
    assists: player.perGame.assists,
    steals: player.perGame.steals,
    blocks: player.perGame.blocks,
    fgPct: player.fga > 0 ? (player.fgm / player.fga) * 100 : null,
  };
}

function statLineFromLivePlayer(player: LiveGamePlayer): LeaderStatLine {
  return {
    points: player.points,
    rebounds: player.rebounds,
    assists: player.assists,
    steals: player.steals,
    blocks: player.blocks,
    fgPct: player.fga > 0 ? (player.fgm / player.fga) * 100 : null,
  };
}

function leaderFor(
  players: TeamPlayerStats[],
  teamId: string,
  selector: (player: TeamPlayerStats) => number | null | undefined,
  format: (value: number) => string,
): LeaderEntry {
  let best: TeamPlayerStats | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const player of players) {
    const value = selector(player);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    if (value > bestValue) {
      bestValue = value;
      best = player;
    }
  }
  if (!best) {
    return EMPTY_LEADER;
  }
  return {
    name: best.shortName || best.name || "-",
    value: format(bestValue),
    photo: best.headshot,
    jersey: best.jersey,
    position: best.position,
    rating: best.seasonRating10,
    stats: statLineFromTeamStats(best),
    modalPlayer: buildModalPlayerFromTeamStats(best, teamId),
  };
}

// Each team's single top-rated player — the Points/Rebounds category toggle
// is gone, so this always picks by season rating regardless of what the
// comparison rows below end up displaying.
function buildTeamLeaders(
  awayStats: TeamPlayerStats[],
  homeStats: TeamPlayerStats[],
  awayTeamId: string,
  homeTeamId: string,
): TeamLeadersData {
  const oneDecimal = (value: number) => value.toFixed(1);
  return {
    away: leaderFor(awayStats, awayTeamId, (player) => player.seasonRating10, oneDecimal),
    home: leaderFor(homeStats, homeTeamId, (player) => player.seasonRating10, oneDecimal),
  };
}

function buildRatingLeaderFromLivePlayers(players: LiveGamePlayer[]): LeaderEntry {
  let best: LiveGamePlayer | null = null;
  let bestRating = Number.NEGATIVE_INFINITY;
  for (const player of players) {
    const rating = player.seasonRating10;
    if (typeof rating !== "number" || !Number.isFinite(rating)) continue;
    if (rating > bestRating) {
      bestRating = rating;
      best = player;
    }
  }
  if (!best) return EMPTY_LEADER;
  return {
    name: best.shortName || best.name || "-",
    value: bestRating.toFixed(1),
    photo: best.headshot,
    jersey: best.jersey,
    position: best.position,
    rating: bestRating,
    stats: statLineFromLivePlayer(best),
    // Already the exact shape PlayerModal expects — no mapping needed.
    modalPlayer: best,
  };
}

// --- Head-to-head ----------------------------------------------------------

async function buildH2H(
  mode: LiveGameData["mode"],
  proLeague: ProBasketballLeague,
  awayTeam: LiveGameTeam | undefined,
  homeTeam: LiveGameTeam | undefined,
  currentSeason: number,
): Promise<H2HData> {
  if (!awayTeam?.id || !homeTeam?.id) {
    return EMPTY_H2H;
  }

  const seasons = Array.from(
    { length: H2H_SEASON_LOOKBACK },
    (_, index) => currentSeason - index,
  );
  const results = await Promise.allSettled(
    seasons.map((season) =>
      getTeamGames(mode, awayTeam.id, season, 0, 100, "all", "", proLeague),
    ),
  );

  // Games are from the AWAY team's log, so teamScore = away pts, opponentScore =
  // home pts. Dedupe by gameId in case a game shows up in two season fetches.
  const byGameId = new Map<string, TeamGame>();
  for (const result of results) {
    if (result.status !== "fulfilled") {
      continue;
    }
    for (const game of result.value.rows) {
      if (
        game.opponentTeamId === homeTeam.id &&
        game.completed &&
        typeof game.teamScore === "number" &&
        typeof game.opponentScore === "number"
      ) {
        byGameId.set(game.gameId, game);
      }
    }
  }

  const games = [...byGameId.values()].sort(
    (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime(),
  );

  let awayWins = 0;
  let homeWins = 0;
  const meetings: H2HMeeting[] = games.map((game) => {
    const awayScore = game.teamScore as number;
    const homeScore = game.opponentScore as number;
    const awayWon =
      game.result === "W" || (game.result !== "L" && awayScore > homeScore);
    if (awayWon) {
      awayWins += 1;
    } else {
      homeWins += 1;
    }
    return {
      gameId: game.gameId,
      dateLabel: formatMeetingDate(game.date),
      awayScore,
      homeScore,
      awayWon,
    };
  });

  return { awayWins, homeWins, meetings };
}

function formatMeetingDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// --- Insights (AI) ---------------------------------------------------------

async function generateInsights({
  away,
  home,
  teamForm,
  leaders,
}: {
  away: LiveGameTeam | undefined;
  home: LiveGameTeam | undefined;
  teamForm: Record<string, TeamGame[]>;
  leaders: TeamLeadersData;
}): Promise<{ insights: TeamInsights; unavailable: boolean }> {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();
  if (!apiKey || !away || !home) {
    return { insights: EMPTY_INSIGHTS, unavailable: true };
  }

  try {
    const context = [
      `Matchup: ${away.displayName} (${away.record || "0-0"}) at ${home.displayName} (${home.record || "0-0"}).`,
      `${away.displayName} recent form: ${formatFormPrompt(teamForm[away.id] ?? [])}`,
      `${home.displayName} recent form: ${formatFormPrompt(teamForm[home.id] ?? [])}`,
      `Already displayed to the user (DO NOT repeat any of these): win probability; PPG; points allowed; 3PT%; ` +
        `${away.displayName} leaders — ${formatLeaderNames(leaders, "away")}; ` +
        `${home.displayName} leaders — ${formatLeaderNames(leaders, "home")}; recent win-loss form; all-time head-to-head series record.`,
      `Return ONLY JSON of the form {"away":["...","...","..."],"home":["...","...","..."]} with EXACTLY 3 insights per team. ` +
        `Each insight must reveal something NOT in the "already displayed" list — for example injuries/availability, rest or ` +
        `schedule spots (back-to-backs, long road trips), stylistic matchup edges (pace, rebounding battle, turnovers forced), ` +
        `bench depth, coaching/tactical angles, or home/road and clutch situational trends.`,
    ].join("\n");

    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 500,
        temperature: 0.7,
        messages: [
          { role: "system", content: INSIGHTS_SYSTEM_PROMPT },
          { role: "user", content: context },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Insights request failed with ${response.status}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    const parsed = content ? parseInsightsJson(content) : null;
    if (!parsed) {
      throw new Error("Insights response could not be parsed");
    }

    return { insights: parsed, unavailable: false };
  } catch (error) {
    console.warn("[PreGamePreview] insights unavailable", error);
    return { insights: EMPTY_INSIGHTS, unavailable: true };
  }
}

async function generateApexArticle({
  away,
  home,
  teamForm,
  leaders,
}: {
  away: LiveGameTeam | undefined;
  home: LiveGameTeam | undefined;
  teamForm: Record<string, TeamGame[]>;
  leaders: TeamLeadersData;
}): Promise<string | null> {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();
  if (!apiKey || !away || !home) {
    return null;
  }

  try {
    const context = [
      `Matchup: ${away.displayName} (${away.record || "0-0"}) at ${home.displayName} (${home.record || "0-0"}).`,
      `${away.displayName} recent form: ${formatFormPrompt(teamForm[away.id] ?? [])}`,
      `${home.displayName} recent form: ${formatFormPrompt(teamForm[home.id] ?? [])}`,
      `Key players — ${away.displayName}: ${formatLeaderNames(leaders, "away")}; ${home.displayName}: ${formatLeaderNames(leaders, "home")}.`,
      `Write a 3-paragraph preview article in the voice of a sharp sports journalist. Cover: (1) the key narrative or storyline entering this game, (2) a specific player matchup or tactical edge to watch, (3) a prediction or X-factor that could decide the outcome. Write compelling prose—no bullet points, no lists. Each paragraph should be 2–3 tight sentences.`,
    ].join("\n");

    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 600,
        temperature: 0.8,
        messages: [
          {
            role: "system",
            content:
              "You are a sharp basketball analyst writing compelling pre-game preview articles. Write in flowing journalistic prose—no bullet points, no headers, no lists. Three paragraphs only.",
          },
          { role: "user", content: context },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch {
    return null;
  }
}

function parseInsightsJson(content: string): TeamInsights | null {
  const cleaned = content
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const takeThree = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.replace(/^\s*[-*•\d.]+\s*/, "").trim())
          .slice(0, 3)
      : [];

  try {
    const parsed = JSON.parse(cleaned) as { away?: unknown; home?: unknown };
    const away = takeThree(parsed?.away);
    const home = takeThree(parsed?.home);
    if (away.length === 0 && home.length === 0) {
      return null;
    }
    return { away, home };
  } catch {
    return null;
  }
}

function formatLeaderNames(leaders: TeamLeadersData, side: "away" | "home"): string {
  const leader = leaders[side];
  return `top player ${leader.name} (${leader.value} rating)`;
}

// --- Recent form helpers ---------------------------------------------------

function sortRecentGames(rows: TeamGame[]): TeamGame[] {
  return [...rows]
    .filter((row) => row.completed)
    .sort(
      (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime(),
    );
}

function getPastGamesBeforeCurrentGame(
  rows: TeamGame[],
  currentGameId?: string,
  currentGameStartDateTime?: string,
): TeamGame[] {
  const sortedRows = sortRecentGames(rows);
  if (currentGameId) {
    const currentGameIndex = sortedRows.findIndex((row) => row.gameId === currentGameId);
    if (currentGameIndex >= 0) {
      return sortedRows.slice(currentGameIndex + 1, currentGameIndex + 6);
    }
  }

  if (!currentGameStartDateTime) {
    return currentGameId
      ? sortedRows.filter((row) => row.gameId !== currentGameId).slice(0, 5)
      : sortedRows.slice(0, 5);
  }

  const currentGameStart = new Date(currentGameStartDateTime).getTime();
  if (Number.isNaN(currentGameStart)) {
    return currentGameId
      ? sortedRows.filter((row) => row.gameId !== currentGameId).slice(0, 5)
      : sortedRows.slice(0, 5);
  }

  return sortedRows
    .filter((row) => {
      const rowStart = new Date(row.date).getTime();
      return (
        row.gameId !== currentGameId &&
        !Number.isNaN(rowStart) &&
        rowStart < currentGameStart
      );
    })
    .slice(0, 5);
}

function formatGameScore(teamScore: number | null, opponentScore: number | null): string {
  if (typeof teamScore === "number" && typeof opponentScore === "number") {
    return `${teamScore}-${opponentScore}`;
  }
  return "-";
}

function formatTeamPerspectiveScore(game: TeamGame): string {
  if (typeof game.teamScore !== "number" || typeof game.opponentScore !== "number") {
    return "-";
  }
  return `${game.teamScore} - ${game.opponentScore}`;
}

function didTeamWin(game: TeamGame): boolean {
  if (game.result === "W") {
    return true;
  }
  if (game.result === "L") {
    return false;
  }
  if (typeof game.teamScore !== "number" || typeof game.opponentScore !== "number") {
    return false;
  }
  return game.teamScore > game.opponentScore;
}

function normalizeImageUri(value: string | undefined): string {
  if (typeof value !== "string" || !value.trim()) {
    return FALLBACK_IMAGE_URI;
  }
  return value.trim();
}

function resolveSeason(startDateTime?: string): number {
  const date = startDateTime ? new Date(startDateTime) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
}

function formatFormPrompt(rows: TeamGame[]): string {
  if (rows.length === 0) {
    return "No recent games available.";
  }
  return rows
    .map(
      (row) =>
        `${row.result || "?"} vs ${row.opponent} ${formatGameScore(row.teamScore, row.opponentScore)}`,
    )
    .join(" | ");
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    cardTitle: previewSectionTitleStyle(theme),
    twoColumnRow: {
      flexDirection: "row",
      gap: theme.spacing[10],
      marginTop: theme.spacing[8],
    },
    formColumn: {
      flex: 1,
      gap: theme.spacing[6],
    },
    formList: {
      gap: theme.spacing[4],
    },
    formItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[6],
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      paddingHorizontal: theme.spacing[6],
      paddingVertical: theme.spacing[4],
    },
    formOpponentLogo: {
      width: 14,
      height: 14,
      borderRadius: theme.radius.pill,
    },
    formLogoBubble: {
      width: 22,
      height: 22,
      borderRadius: theme.radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    formWinnerBubble: {
      backgroundColor: "rgba(255,255,255,0.08)",
      borderWidth: theme.borderWidth.normal,
      borderColor: "rgba(255,255,255,0.18)",
      ...theme.shadows.glow,
    },
    formLoserLogo: {
      opacity: 0.45,
    },
    formScore: {
      ...theme.type.caption,
      color: theme.colors.textPrimary,
      textAlign: "center",
      flex: 1,
    },
    insightsGroups: {
      gap: theme.spacing[16],
      marginTop: theme.spacing[12],
    },
    insightTeamBlock: {
      gap: theme.spacing[10],
    },
    insightTeamHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    insightTeamLogo: {
      width: 22,
      height: 22,
      borderRadius: theme.radius.pill,
    },
    insightTeamLabel: {
      ...theme.type.caption,
      color: theme.colors.textSecondary,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    insightRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing[10],
    },
    insightBullet: {
      width: 6,
      height: 6,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.accentStrong,
      marginTop: 7,
    },
    insightText: {
      ...theme.type.body,
      color: theme.colors.textPrimary,
      flex: 1,
    },
    mutedText: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      marginTop: theme.spacing[12],
    },
    emptyText: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
    },
    articleText: {
      ...theme.type.body,
      color: theme.colors.textPrimary,
      lineHeight: 22,
    },
    apexButton: {
      gap: theme.spacing[8],
    },
    apexButtonPressed: {
      opacity: 0.7,
    },
    apexButtonTag: {
      alignSelf: "flex-start",
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[2],
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.accentStrong,
    },
    apexButtonTagText: {
      ...theme.type.micro,
      color: theme.colors.accentStrong,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    apexButtonLabel: {
      ...theme.type.body,
      color: theme.colors.textPrimary,
      fontWeight: "700",
    },
    modalSafeArea: {
      flex: 1,
      backgroundColor: theme.colors.bg,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing[20],
      paddingVertical: theme.spacing[14],
      borderBottomWidth: theme.borderWidth.normal,
      borderBottomColor: theme.colors.borderSoft,
    },
    modalTitle: {
      ...theme.type.title,
      color: theme.colors.textPrimary,
      fontWeight: "800",
    },
    modalCloseButton: {
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[6],
    },
    modalCloseText: {
      ...theme.type.body,
      color: theme.colors.accentStrong,
      fontWeight: "700",
    },
    modalContent: {
      paddingHorizontal: theme.spacing[20],
      paddingTop: theme.spacing[20],
      paddingBottom: theme.spacing[40],
    },
  });
}
