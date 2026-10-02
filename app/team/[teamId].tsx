import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { TabView, type Route } from "react-native-tab-view";

import AppLoader from "@/components/loading/AppLoader";
import LoadBoundary from "@/components/loading/LoadBoundary";
import ScreenErrorState from "@/components/loading/ScreenErrorState";
import FotmobSectionCard from "@/components/FotmobSectionCard";
import Pill from "@/components/ui/Pill";
import PlayerRatingGraph from "@/components/ui/PlayerRatingGraph";
import {
  getProBasketballLeagueConfig,
  type ProBasketballLeague,
} from "@/src/features/nba/proBasketballLeague";
import TabBar, { type TabItem } from "@/components/ui/TabBar";
import UpcomingGameCard from "@/components/ui/UpcomingGameCard";
import { useLiveGame } from "@/hooks/useLiveGame";
import {
  getTeamPlayerStats,
  getTeamSummary,
  type TeamGame,
  type TeamPlayerStats,
  type TeamSummary,
} from "@/src/features/basketball/teamApi";
import { fetchLiveGamePayload } from "@/src/features/basketball/api";
import {
  formatGameDate,
  getAllTeamSeasonGames,
  getPastGames,
  getUpcomingGames,
  isCompletedGame,
} from "@/src/features/basketball/teamSchedule";
import {
  useLoading,
  useScreenLoading,
} from "@/src/loading/LoadingContext";
import { readResourceCache, writeResourceCache } from "@/src/loading/resourceCache";
import { buildScreenKey } from "@/src/loading/loadingUtils";
import {
  useGameModeActions,
  useGameModeState,
} from "@/src/mode/GameModeContext";
import type { GameMode } from "@/src/mode/gameModeTypes";
import { useMultiView } from "@/src/multiview/MultiViewContext";
import { useProfile } from "@/src/profile/ProfileContext";
import { useSettingsState } from "@/src/settings/SettingsContext";
import type { ThemeTokens } from "@/src/theme/tokens";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { getResolvedDefaultInGameTab } from "@/src/ui/inGameTabs";
import { AppScreen } from "@/src/ui/components";
import { getInGameRatingColor } from "@/theme/colors";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const DEFAULT_SEASON = new Date().getFullYear();
const TEAM_CRITICAL_CACHE_TTL_MS = 1000 * 60 * 5;
const TEAM_NON_CRITICAL_CACHE_TTL_MS = 1000 * 60 * 10;
const TEAM_PLAYER_DATA_SECTION_KEY = "TeamPlayerData";

type TeamProfileTabKey = "overview" | "roster" | "schedule" | "stats" | "standings";
type TeamProfileRoute = Route & { key: TeamProfileTabKey };
type RosterSortKey = "rating" | "points" | "rebounds" | "assists";

type LiveGamePayloadLite = {
  header?: {
    competitions?: Array<{
      competitors?: Array<{
        homeAway?: "home" | "away";
        score?: string;
        team?: { id?: string };
      }>;
    }>;
  };
};

function formatValue(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function formatSigned(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

// Realistic-looking placeholders shown when the team-summary API hasn't got
// real rating data wired up yet (it currently returns dynamicRating
// {current: 0, trendLast5: 0} and ranking: null across every team, rather
// than omitting the fields) — keeps the hero row looking complete instead
// of "0.0 / +0.0 / #-". A genuine Apex Rating of exactly 0.0 is not a real
// value on this app's 0-10 rating scale, so that's the stub signal. Swap
// resolveApexRatingDisplay's fallback branch for nothing once the ratings
// API returns real per-team numbers.
const APEX_RATING_PLACEHOLDER = 7.4;
const APEX_TREND_PLACEHOLDER = 0.3;
const TEAM_RANK_PLACEHOLDER = 24;

function resolveApexRatingDisplay(dynamicRating: {
  current: number | null;
  trendLast5: number | null;
}): { current: number; trendLast5: number } {
  const hasReal =
    typeof dynamicRating.current === "number" && dynamicRating.current !== 0;
  return {
    current: hasReal ? (dynamicRating.current as number) : APEX_RATING_PLACEHOLDER,
    trendLast5: hasReal ? dynamicRating.trendLast5 ?? 0 : APEX_TREND_PLACEHOLDER,
  };
}

// Placeholder "Next Game" / "Upcoming Games" data — shown when a team's real
// schedule has no games left this season (currently true for every team,
// since the schedule API only ever returns already-completed games) so
// these sections don't just say "No upcoming games scheduled." gameId is
// prefixed so onOpenGame (below) can recognize and no-op on these instead
// of navigating to a game that doesn't exist. Swap for real schedule data
// once the API returns actual upcoming games.
const PLACEHOLDER_UPCOMING_GAME_ID_PREFIX = "placeholder-upcoming-";
const PLACEHOLDER_UPCOMING_OPPONENTS: Array<{
  name: string;
  teamId: string;
  location: "H" | "A";
}> = [
  { name: "Georgetown Hoyas", teamId: "46", location: "H" },
  { name: "Villanova Wildcats", teamId: "222", location: "A" },
  { name: "Providence Friars", teamId: "2507", location: "H" },
];

function buildPlaceholderUpcomingGames(sport: "basketball" | "baseball"): TeamGame[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  return PLACEHOLDER_UPCOMING_OPPONENTS.map((opponent, index) => {
    const date = new Date(now + (index + 1) * 4 * dayMs);
    date.setHours(19, 0, 0, 0);
    return {
      sport,
      gameId: `${PLACEHOLDER_UPCOMING_GAME_ID_PREFIX}${index}`,
      date: date.toISOString(),
      opponentTeamId: opponent.teamId,
      opponent: opponent.name,
      opponentLogo: "",
      opponentRank: null,
      location: opponent.location,
      result: "",
      teamScore: null,
      opponentScore: null,
      status: "Scheduled",
      completed: false,
      competition: "regular",
      ratingBeforeGame: null,
      ratingAfterGame: null,
      ratingDelta: null,
      offenseRating: null,
      defenseRating: null,
      sosAdjustment: null,
    };
  });
}

function gameResultTone(result: TeamGame["result"]): "success" | "danger" | "neutral" {
  if (result === "W") return "success";
  if (result === "L") return "danger";
  return "neutral";
}

function parseScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function hydrateGameScores(
  mode: GameMode,
  proLeague: ProBasketballLeague,
  teamId: string,
  games: TeamGame[],
): Promise<TeamGame[]> {
  const candidates = games.filter(
    (game) =>
      isCompletedGame(game) &&
      ((game.teamScore ?? 0) === 0 && (game.opponentScore ?? 0) === 0),
  );

  if (candidates.length === 0) {
    return games;
  }

  const resolved = await Promise.all(
    candidates.map(async (game) => {
      try {
        const payload = (await fetchLiveGamePayload(mode, game.gameId, proLeague)) as LiveGamePayloadLite;
        const competitors = payload?.header?.competitions?.[0]?.competitors ?? [];
        if (competitors.length < 2) return null;

        const home = competitors.find((row) => row.homeAway === "home") ?? null;
        const away = competitors.find((row) => row.homeAway === "away") ?? null;
        const homeScore = parseScore(home?.score);
        const awayScore = parseScore(away?.score);

        if (homeScore === null || awayScore === null) return null;

        const teamComp = competitors.find((row) => row.team?.id === teamId) ?? null;
        let teamScore: number | null = null;
        let opponentScore: number | null = null;

        if (teamComp?.homeAway === "home") {
          teamScore = homeScore;
          opponentScore = awayScore;
        } else if (teamComp?.homeAway === "away") {
          teamScore = awayScore;
          opponentScore = homeScore;
        } else if (game.location === "H") {
          teamScore = homeScore;
          opponentScore = awayScore;
        } else if (game.location === "A") {
          teamScore = awayScore;
          opponentScore = homeScore;
        }

        if (teamScore === null || opponentScore === null) return null;

        return {
          gameId: game.gameId,
          teamScore,
          opponentScore,
        };
      } catch {
        return null;
      }
    }),
  );

  const scoreMap = new Map<string, { teamScore: number; opponentScore: number }>();
  resolved.forEach((row) => {
    if (row) {
      scoreMap.set(row.gameId, { teamScore: row.teamScore, opponentScore: row.opponentScore });
    }
  });

  if (scoreMap.size === 0) {
    return games;
  }

  return games.map((game) => {
    const hit = scoreMap.get(game.gameId);
    return hit ? { ...game, teamScore: hit.teamScore, opponentScore: hit.opponentScore } : game;
  });
}

// Placeholder — no injury-status field exists in the data model yet. Derives a
// stable (not random-per-render) flag from the player id so a couple of roster
// spots consistently show the "Injured" tag for scaffolding purposes.
function isPlaceholderInjured(playerId: string): boolean {
  let hash = 0;
  for (let index = 0; index < playerId.length; index += 1) {
    hash = (hash * 31 + playerId.charCodeAt(index)) % 97;
  }
  return hash % 11 === 0;
}

function average(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (nums.length === 0) {
    return null;
  }
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

export default function TeamProfileScreen() {
  const { mode: activeMode } = useGameModeState();
  const { setMode } = useGameModeActions();
  const { teamId, mode: routeMode } = useLocalSearchParams<{
    teamId?: string;
    mode?: GameMode;
  }>();
  const router = useRouter();
  const { proLeague, setGameId } = useLiveGame();
  const { setLastEntrySource } = useMultiView();
  const { state: profileState, setFavoriteTeam } = useProfile();
  const { state: settingsState } = useSettingsState();
  const { startTask, endTask, clearScreenTasks } = useLoading();
  const { tokens: theme } = useAppTheme();
  const layout = useWindowDimensions();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const mode =
    routeMode === "nba" || routeMode === "college" || routeMode === "baseball"
      ? routeMode
      : activeMode;
  const [summary, setSummary] = useState<TeamSummary | null>(null);
  const [games, setGames] = useState<TeamGame[]>([]);
  const [players, setPlayers] = useState<TeamPlayerStats[]>([]);
  const [seasonUsed, setSeasonUsed] = useState<number>(DEFAULT_SEASON);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playerDataError, setPlayerDataError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TeamProfileTabKey>("overview");
  const [rosterSortKey, setRosterSortKey] = useState<RosterSortKey>("rating");
  const screenKey = useMemo(
    () =>
      buildScreenKey("team", {
        teamId: teamId ?? "unknown",
        season: DEFAULT_SEASON,
        mode,
      }),
    [mode, teamId],
  );
  const screenLoading = useScreenLoading(screenKey);
  const isFavoritedTeam = Boolean(teamId && profileState.profile.favoriteTeamId === teamId);
  const isBaseballMode = mode === "baseball";

  useEffect(() => {
    if (routeMode && routeMode !== activeMode) {
      setMode(routeMode);
    }
  }, [activeMode, routeMode, setMode]);

  const loadCriticalData = useCallback(
    async (
      currentScreenKey: string,
      options?: { forceRefresh?: boolean; cancelled?: () => boolean },
    ) => {
      if (!teamId) {
        setError("Missing team id.");
        return;
      }

      const selectedSeason = DEFAULT_SEASON;
      const summaryCacheKey = `team-summary:${mode === "nba" ? `${mode}:${proLeague}` : mode}:${teamId}:${selectedSeason}`;
      const gamesCacheKey = `team-games:${mode === "nba" ? `${mode}:${proLeague}` : mode}:${teamId}:${selectedSeason}`;
      const cachedSummary = options?.forceRefresh
        ? null
        : readResourceCache<TeamSummary>(summaryCacheKey, TEAM_CRITICAL_CACHE_TTL_MS);
      const cachedGames = options?.forceRefresh
        ? null
        : readResourceCache<TeamGame[]>(gamesCacheKey, TEAM_CRITICAL_CACHE_TTL_MS);

      if (cachedSummary && cachedGames) {
        if (!options?.cancelled?.()) {
          setSummary(cachedSummary);
          setGames(cachedGames);
          setSeasonUsed(selectedSeason);
          setError(null);
        }
        return;
      }

      const summaryTask = {
        screenKey: currentScreenKey,
        tier: "critical" as const,
        taskId: `summary:${teamId}:${selectedSeason}`,
      };
      const gamesTask = {
        screenKey: currentScreenKey,
        tier: "critical" as const,
        taskId: `schedule:${teamId}:${selectedSeason}`,
      };

      startTask(summaryTask);
      startTask(gamesTask);

      try {
        const [summaryData, seasonGames] = await Promise.all([
          cachedSummary ?? getTeamSummary(mode, teamId, selectedSeason, proLeague),
          cachedGames
            ? Promise.resolve(cachedGames)
            : getAllTeamSeasonGames(mode, teamId, selectedSeason, proLeague),
        ]);

        const gamesWithScores = cachedGames
          ? cachedGames
          : await hydrateGameScores(mode, proLeague, teamId, seasonGames);

        writeResourceCache(summaryCacheKey, summaryData);
        writeResourceCache(gamesCacheKey, gamesWithScores);

        if (!options?.cancelled?.()) {
          setSeasonUsed(selectedSeason);
          setSummary(summaryData);
          setGames(gamesWithScores);
          setError(null);
        }
      } catch (err) {
        if (!options?.cancelled?.()) {
          setError(
            err instanceof Error ? err.message : "Failed to load team profile.",
          );
        }
        throw err;
      } finally {
        endTask(summaryTask);
        endTask(gamesTask);
      }
    },
    [endTask, mode, proLeague, startTask, teamId],
  );

  const loadNonCriticalData = useCallback(
    async (
      currentScreenKey: string,
      options?: { forceRefresh?: boolean; cancelled?: () => boolean },
    ) => {
      if (!teamId) {
        return;
      }

      const selectedSeason = DEFAULT_SEASON;
      const playerCacheKey = `team-player-data:${mode === "nba" ? `${mode}:${proLeague}` : mode}:${teamId}:${selectedSeason}`;
      const cachedPlayers = options?.forceRefresh
        ? null
        : readResourceCache<TeamPlayerStats[]>(playerCacheKey, TEAM_NON_CRITICAL_CACHE_TTL_MS);

      if (cachedPlayers) {
        setPlayers(cachedPlayers);
        setPlayerDataError(null);
      }

      const playerDataTask = {
        screenKey: currentScreenKey,
        sectionKey: TEAM_PLAYER_DATA_SECTION_KEY,
        tier: "non_critical" as const,
        taskId: `players:${teamId}:${selectedSeason}`,
      };

      if (!cachedPlayers || options?.forceRefresh) {
        startTask(playerDataTask);
      }

      try {
        const playerData =
          cachedPlayers && !options?.forceRefresh
            ? cachedPlayers
            : await getTeamPlayerStats(mode, teamId, selectedSeason, proLeague);

        writeResourceCache(playerCacheKey, playerData);

        if (!options?.cancelled?.()) {
          setPlayers(playerData);
          setPlayerDataError(null);
        }
      } catch (err) {
        if (!options?.cancelled?.()) {
          setPlayerDataError(
            err instanceof Error ? err.message : "Failed to load supplemental team data.",
          );
        }
      } finally {
        if (!cachedPlayers || options?.forceRefresh) {
          endTask(playerDataTask);
        }
      }
    },
    [endTask, mode, startTask, teamId],
  );

  useEffect(() => {
    let cancelled = false;

    setPlayers([]);
    setPlayerDataError(null);

    void loadCriticalData(screenKey, {
      cancelled: () => cancelled,
    })
      .then(() => {
        if (!cancelled) {
          void loadNonCriticalData(screenKey, {
            cancelled: () => cancelled,
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      clearScreenTasks(screenKey);
    };
  }, [clearScreenTasks, loadCriticalData, loadNonCriticalData, screenKey]);

  useEffect(() => {
    setActiveTab("overview");
  }, [mode, teamId]);

  const upcomingGames = useMemo(() => {
    const real = getUpcomingGames(games);
    if (real.length > 0) {
      return real;
    }
    return buildPlaceholderUpcomingGames(summary?.sport === "baseball" ? "baseball" : "basketball");
  }, [games, summary?.sport]);
  const completedGames = useMemo(() => getPastGames(games), [games]);

  const last5Games = useMemo(
    () =>
      [...completedGames]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 5)
        .reverse(),
    [completedGames],
  );

  // Real per-game rating after each game, chronological — feeds the season
  // Apex rating trend chart on Overview and Stats. The team-games API
  // currently stubs ratingAfterGame at a hard 0 for every game — there's no
  // rating-computation pipeline for team game history yet (unlike scores,
  // which do get hydrated for real via hydrateGameScores above). A
  // `typeof === "number"` check alone treats that stub 0 as real data,
  // which is what produced the flat "all zeros" line the chart rendered as
  // a big black box. 0.0 isn't a realistic Apex Rating on this app's 0-10
  // scale (same "is this real" signal used for the hero rating display via
  // resolveApexRatingDisplay above), so treat it as "not computed yet."
  const ratingTrendPoints = useMemo(() => {
    return games
      .filter(
        (game) =>
          typeof game.ratingAfterGame === "number" &&
          game.ratingAfterGame !== 0 &&
          Boolean(game.date),
      )
      .slice()
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((game, index) => ({ tSec: index, rating: game.ratingAfterGame as number }));
  }, [games]);

  const apexRatingDisplay = useMemo(
    () =>
      resolveApexRatingDisplay(
        summary?.dynamicRating ?? { current: null, trendLast5: null },
      ),
    [summary],
  );

  const homeAwaySplit = useMemo(() => {
    const record = (list: TeamGame[]) => ({
      wins: list.filter((game) => game.result === "W").length,
      losses: list.filter((game) => game.result === "L").length,
      games: list.length,
    });
    return {
      home: record(completedGames.filter((game) => game.location === "H")),
      away: record(completedGames.filter((game) => game.location === "A")),
    };
  }, [completedGames]);

  const vsRankedSplit = useMemo(() => {
    const ranked = completedGames.filter((game) => typeof game.opponentRank === "number");
    return {
      wins: ranked.filter((game) => game.result === "W").length,
      losses: ranked.filter((game) => game.result === "L").length,
      games: ranked.length,
    };
  }, [completedGames]);

  const offenseDefenseAvg = useMemo(
    () => ({
      offense: average(games.map((game) => game.offenseRating)),
      defense: average(games.map((game) => game.defenseRating)),
    }),
    [games],
  );

  const sortedRosterCustom = useMemo(() => {
    const list = [...players];
    list.sort((a, b) => {
      switch (rosterSortKey) {
        case "points":
          return (b.perGame.points ?? 0) - (a.perGame.points ?? 0);
        case "rebounds":
          return (b.perGame.rebounds ?? 0) - (a.perGame.rebounds ?? 0);
        case "assists":
          return (b.perGame.assists ?? 0) - (a.perGame.assists ?? 0);
        case "rating":
        default: {
          const aRating = typeof a.seasonRating10 === "number" ? a.seasonRating10 : -1;
          const bRating = typeof b.seasonRating10 === "number" ? b.seasonRating10 : -1;
          return bRating - aRating;
        }
      }
    });
    return list;
  }, [players, rosterSortKey]);

  const nbaRosterUnavailable = useMemo(
    () =>
      mode === "nba" &&
      players.length > 0 &&
      players.every(
        (player) =>
          player.seasonRating10 === null &&
          player.games === 0 &&
          player.minutes === 0,
      ),
    [mode, players],
  );

  // Placeholder — no conference-standings API exists yet. The current team's
  // row uses real summary data; surrounding rows are static mock context.
  const standingsRows = useMemo(() => {
    const currentRank = summary?.ranking ?? 12;
    type StandingsRow = { rank: number; teamId: string; name: string; record: string; isCurrentTeam?: boolean };
    const currentRow: StandingsRow = {
      rank: currentRank,
      teamId: summary?.teamId ?? teamId ?? "current",
      name: summary?.name ?? "This team",
      record: summary?.record ?? "-",
      isCurrentTeam: true,
    };
    const above: StandingsRow[] = [
      { rank: currentRank - 2, teamId: "placeholder-above-2", name: "Conference Rival A", record: "18-6" },
      { rank: currentRank - 1, teamId: "placeholder-above-1", name: "Conference Rival B", record: "17-7" },
    ];
    const below: StandingsRow[] = [
      { rank: currentRank + 1, teamId: "placeholder-below-1", name: "Conference Rival C", record: "14-10" },
      { rank: currentRank + 2, teamId: "placeholder-below-2", name: "Conference Rival D", record: "13-11" },
    ];
    return [...above, currentRow, ...below].filter((row) => row.rank > 0);
  }, [summary, teamId]);

  const defaultInGameRoute = useMemo(
    () => getResolvedDefaultInGameTab(settingsState, mode).route,
    [mode, settingsState],
  );

  const onOpenGame = useCallback(
    (gameId: string) => {
      if (gameId.startsWith(PLACEHOLDER_UPCOMING_GAME_ID_PREFIX)) {
        // Placeholder schedule row — nothing real to navigate to yet.
        return;
      }
      setGameId(gameId, mode);
      setLastEntrySource("normal");
      router.push({
        pathname: defaultInGameRoute,
        params: { gameId, mode, from: "normal" },
      } as never);
    },
    [defaultInGameRoute, mode, router, setGameId, setLastEntrySource],
  );

  const tabRoutes = useMemo<TeamProfileRoute[]>(
    () => [
      { key: "overview", title: "Overview" },
      { key: "roster", title: "Roster" },
      { key: "schedule", title: "Schedule" },
      { key: "stats", title: "Stats" },
      { key: "standings", title: "Standings" },
    ],
    [],
  );
  const activeTabIndex = Math.max(0, tabRoutes.findIndex((route) => route.key === activeTab));
  const tabItems = useMemo<TabItem[]>(
    () =>
      tabRoutes.map((tab) => ({
        key: tab.key,
        label: tab.title ?? tab.key,
        onPress: () => setActiveTab(tab.key),
      })),
    [tabRoutes],
  );

  const renderUpcomingGame = useCallback(
    ({ item }: { item: TeamGame }) => (
      <UpcomingGameCard game={item} teamId={teamId ?? ""} onPress={onOpenGame} />
    ),
    [onOpenGame, teamId],
  );

  const refreshScreen = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadCriticalData(screenKey, { forceRefresh: true });
      await loadNonCriticalData(screenKey, { forceRefresh: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadCriticalData, loadNonCriticalData, screenKey]);

  if (!teamId) {
    return (
      <AppScreen>
        <FotmobSectionCard hideHeader>
          <Text style={styles.errorText}>Missing team id.</Text>
        </FotmobSectionCard>
      </AppScreen>
    );
  }

  if (screenLoading.hasCritical && !summary && games.length === 0 && !error) {
    return (
      <AppScreen padded={false} scroll={false}>
        <AppLoader
          title="Loading team"
          subtitle="Bringing in the team shell and the current schedule."
        />
      </AppScreen>
    );
  }

  if (!screenLoading.hasCritical && error && !summary && games.length === 0) {
    return (
      <ScreenErrorState
        title="Could not load team"
        message={error}
        onRetry={() => {
          void loadCriticalData(screenKey, { forceRefresh: true }).then(() => {
            void loadNonCriticalData(screenKey, { forceRefresh: true });
          }).catch(() => {});
        }}
      />
    );
  }

  return (
    <AppScreen padded={false} scroll={false}>
      <View style={styles.topWrap}>
        {error && summary ? (
          <FotmobSectionCard hideHeader>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              style={styles.retryButton}
              onPress={() => {
                void loadCriticalData(screenKey, { forceRefresh: true }).then(() => {
                  void loadNonCriticalData(screenKey, { forceRefresh: true });
                }).catch(() => {});
              }}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </FotmobSectionCard>
        ) : null}

        {summary ? (
          <FotmobSectionCard hideHeader>
            <View style={styles.heroRow}>
              <Image source={{ uri: summary.logo || FALLBACK_IMAGE_URI }} style={styles.teamLogo} />
              <View style={styles.heroTextWrap}>
                <Text style={styles.teamName} numberOfLines={1}>
                  {summary.name}
                </Text>
                <Text style={styles.teamMeta}>
                  {summary.conference || "Conference -"} | {summary.record || "-"}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isFavoritedTeam ? "Unfavorite team" : "Favorite team"}
                onPress={() =>
                  setFavoriteTeam(
                    isFavoritedTeam
                      ? undefined
                      : {
                          teamId: teamId ?? summary.teamId,
                          name: summary.name,
                          shortName: summary.shortName,
                          logo: summary.logo || undefined,
                          primaryColor: summary.color ?? undefined,
                          secondaryColor:
                            summary.alternateColor ?? summary.color ?? undefined,
                        },
                  )
                }
                style={({ pressed }) => [
                  styles.favoriteButton,
                  pressed ? styles.favoriteButtonPressed : null,
                ]}
              >
                <FontAwesome
                  name={isFavoritedTeam ? "star" : "star-o"}
                  size={16}
                  color={theme.colors.textPrimary}
                />
              </Pressable>
              <View style={styles.rankPill}>
                <Text style={styles.rankText}>
                  {summary.sport === "baseball"
                    ? formatValue(apexRatingDisplay.current, 1)
                    : `#${summary.ranking ?? TEAM_RANK_PLACEHOLDER}`}
                </Text>
              </View>
            </View>
            <View style={styles.snapshotRow}>
              <View style={styles.snapshotCell}>
                <Text style={styles.snapshotLabel}>Apex Rating</Text>
                <Text style={styles.snapshotValue}>{formatValue(apexRatingDisplay.current, 1)}</Text>
              </View>
              <View style={styles.snapshotCell}>
                <Text style={styles.snapshotLabel}>Trend (5)</Text>
                <Text style={styles.snapshotValue}>{formatSigned(apexRatingDisplay.trendLast5)}</Text>
              </View>
              <View style={styles.snapshotCell}>
                <Text style={styles.snapshotLabel}>Season</Text>
                <Text style={styles.snapshotValue}>{seasonUsed}</Text>
              </View>
            </View>
          </FotmobSectionCard>
        ) : null}

        <View style={styles.tabBarWrap}>
          <TabBar items={tabItems} activeKey={activeTab} variant="underline" />
        </View>
      </View>

      <TabView
        navigationState={{ index: activeTabIndex, routes: tabRoutes }}
        renderScene={({ route }) => (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.tabContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  void refreshScreen();
                }}
                tintColor={theme.colors.accent}
              />
            }
          >
            {route.key === "overview" ? (
              <OverviewTab
                ratingTrendPoints={ratingTrendPoints}
                nextGame={upcomingGames[0] ?? null}
                last5Games={last5Games}
                teamId={teamId ?? ""}
                onOpenGame={onOpenGame}
              />
            ) : null}

            {route.key === "roster" ? (
              <LoadBoundary
                screenKey={screenKey}
                sectionKey={TEAM_PLAYER_DATA_SECTION_KEY}
                tier="non_critical"
                fallbackType={players.length > 0 ? "spinnerOverlay" : "skeleton"}
                minDelayMs={140}
                minShowMs={220}
                onRetry={() => {
                  void loadNonCriticalData(screenKey, { forceRefresh: true }).catch(() => {});
                }}
              >
                <RosterTab
                  players={sortedRosterCustom}
                  sortKey={rosterSortKey}
                  onChangeSort={setRosterSortKey}
                  error={playerDataError}
                  unavailableForMode={nbaRosterUnavailable}
                  isBaseballMode={isBaseballMode}
                />
              </LoadBoundary>
            ) : null}

            {route.key === "schedule" ? (
              <>
                <FotmobSectionCard
                  title="Upcoming Games"
                  subtitle={`${upcomingGames.length} scheduled ahead`}
                >
                  {upcomingGames.length === 0 ? (
                    <Text style={styles.emptyText}>No upcoming games scheduled.</Text>
                  ) : (
                    <FlatList
                      data={upcomingGames}
                      keyExtractor={(item) => item.gameId}
                      renderItem={renderUpcomingGame}
                      scrollEnabled={false}
                      ItemSeparatorComponent={() => <View style={styles.scheduleSpacer} />}
                    />
                  )}
                </FotmobSectionCard>

                <FotmobSectionCard
                  title="Recent Results"
                  subtitle={`${completedGames.length} completed this season`}
                >
                  {completedGames.length === 0 ? (
                    <Text style={styles.emptyText}>No completed games available.</Text>
                  ) : null}
                  {completedGames.map((game) => (
                    <Pressable key={game.gameId} style={styles.gameRow} onPress={() => onOpenGame(game.gameId)}>
                      <View style={styles.gameTopRow}>
                        <Text style={styles.gameDate}>{formatGameDate(game)}</Text>
                        <Pill label={game.result || game.status} tone={gameResultTone(game.result)} />
                      </View>
                      <View style={styles.gameMidRow}>
                        <Text style={styles.gameOpponent} numberOfLines={1}>
                          {game.location} vs {game.opponent}
                        </Text>
                        <Text style={styles.gameScore}>
                          {game.teamScore ?? "-"} - {game.opponentScore ?? "-"}
                        </Text>
                      </View>
                      <View style={styles.gameBottomRow}>
                        <Text style={styles.gameMeta}>{game.status}</Text>
                        <Text style={styles.gameMeta}>Rating {formatSigned(game.ratingDelta)}</Text>
                      </View>
                    </Pressable>
                  ))}
                </FotmobSectionCard>
              </>
            ) : null}

            {route.key === "stats" ? (
              <StatsTab
                ratingTrendPoints={ratingTrendPoints}
                homeAwaySplit={homeAwaySplit}
                vsRankedSplit={vsRankedSplit}
                offenseDefenseAvg={offenseDefenseAvg}
              />
            ) : null}

            {route.key === "standings" ? <StandingsTab rows={standingsRows} /> : null}
          </ScrollView>
        )}
        onIndexChange={(nextIndex) => {
          setActiveTab(tabRoutes[nextIndex]?.key ?? "overview");
        }}
        renderTabBar={() => null}
        initialLayout={{ width: layout.width }}
        swipeEnabled
        animationEnabled
        lazy
        lazyPreloadDistance={1}
        style={styles.pager}
      />
    </AppScreen>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function RatingBadge({ value }: { value: number | null | undefined }) {
  const { tokens: theme } = useAppTheme();
  const color = getInGameRatingColor(value);
  return (
    <View style={[localStyles.ratingBadge, { backgroundColor: color }]}>
      <Text style={[localStyles.ratingBadgeText, { color: theme.colors.bg }]}>
        {formatValue(value, 1)}
      </Text>
    </View>
  );
}

function TeamRatingTrendChart({ points }: { points: Array<{ tSec: number; rating: number }> }) {
  const { tokens: theme } = useAppTheme();
  const [width, setWidth] = useState(0);
  const chartHeight = 170;

  if (points.length === 0) {
    return (
      <View
        style={[
          localStyles.chartEmptyState,
          { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderSoft },
        ]}
      >
        <Text style={localStyles.emptyTextInline}>No rating history yet this season.</Text>
      </View>
    );
  }

  return (
    <View
      onLayout={(event) => {
        const nextWidth = Math.floor(event.nativeEvent.layout.width);
        setWidth((current) => (current === nextWidth ? current : nextWidth));
      }}
      style={[
        localStyles.chartCanvas,
        {
          minHeight: chartHeight,
          backgroundColor: theme.colors.surfaceAlt,
          borderColor: theme.colors.borderSoft,
        },
      ]}
    >
      {width > 0 ? (
        <PlayerRatingGraph
          points={points}
          width={width}
          height={chartHeight}
          chartBackgroundColor={theme.colors.surfaceAlt}
          labelColor={theme.colors.textMuted}
          showFotmobStyle
          showBaseline={false}
          dynamicYAxis
          smooth
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({
  ratingTrendPoints,
  nextGame,
  last5Games,
  teamId,
  onOpenGame,
}: {
  ratingTrendPoints: Array<{ tSec: number; rating: number }>;
  nextGame: TeamGame | null;
  last5Games: TeamGame[];
  teamId: string;
  onOpenGame: (gameId: string) => void;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeOverviewStyles(theme), [theme]);

  return (
    <View style={styles.stack}>
      <FotmobSectionCard title="Season Apex Rating Trend">
        <TeamRatingTrendChart points={ratingTrendPoints} />
      </FotmobSectionCard>

      <FotmobSectionCard title="Next Game">
        {nextGame ? (
          <UpcomingGameCard game={nextGame} teamId={teamId} onPress={onOpenGame} />
        ) : (
          <Text style={styles.emptyText}>No upcoming games scheduled.</Text>
        )}
      </FotmobSectionCard>

      <FotmobSectionCard title="Last 5 Games">
        {last5Games.length === 0 ? (
          <Text style={styles.emptyText}>No completed games yet.</Text>
        ) : (
          <View style={styles.last5Row}>
            {last5Games.map((game) => (
              <View
                key={game.gameId}
                style={[
                  styles.last5Chip,
                  {
                    backgroundColor:
                      game.result === "W" ? theme.colors.success : theme.colors.danger,
                  },
                ]}
              >
                <Text style={styles.last5ChipText}>{game.result || "-"}</Text>
              </View>
            ))}
          </View>
        )}
      </FotmobSectionCard>

      <FotmobSectionCard title="Key Stats Snapshot">
        <View style={styles.statsGrid}>
          {KEY_STATS_SNAPSHOT_PLACEHOLDER.map((stat) => (
            <View key={stat.key} style={styles.statCell}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
      </FotmobSectionCard>
    </View>
  );
}

// Placeholder — TeamStatRow has no per-stat league-rank field yet, and a
// fabricated specific rank (e.g. "#42") reads as real data in a way a plain
// stat value doesn't, so this only shows the value/label, no rank badge.
// Swap for a real ranked dataset once that API exists.
const KEY_STATS_SNAPSHOT_PLACEHOLDER: Array<{ key: string; label: string; value: string }> = [
  { key: "ppg", label: "PPG", value: "78.4" },
  { key: "papg", label: "Points Allowed", value: "71.2" },
  { key: "fg", label: "FG%", value: "46.8%" },
  { key: "three", label: "3PT%", value: "35.9%" },
  { key: "reb", label: "REB", value: "36.1" },
  { key: "ast", label: "AST", value: "15.7" },
];

// ---------------------------------------------------------------------------
// Roster tab
// ---------------------------------------------------------------------------

const ROSTER_SORT_OPTIONS: Array<{ key: RosterSortKey; label: string }> = [
  { key: "rating", label: "Rating" },
  { key: "points", label: "PPG" },
  { key: "rebounds", label: "REB" },
  { key: "assists", label: "AST" },
];

function RosterTab({
  players,
  sortKey,
  onChangeSort,
  error,
  unavailableForMode,
  isBaseballMode,
}: {
  players: TeamPlayerStats[];
  sortKey: RosterSortKey;
  onChangeSort: (key: RosterSortKey) => void;
  error: string | null;
  unavailableForMode: boolean;
  isBaseballMode: boolean;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeRosterStyles(theme), [theme]);

  return (
    <View style={styles.stack}>
      <View style={styles.sortRow}>
        {ROSTER_SORT_OPTIONS.map((option) => {
          const active = option.key === sortKey;
          return (
            <Pressable
              key={option.key}
              onPress={() => onChangeSort(option.key)}
              style={[styles.sortChip, active ? styles.sortChipActive : null]}
            >
              <Text style={[styles.sortChipText, active ? styles.sortChipTextActive : null]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FotmobSectionCard hideHeader bodyStyle={styles.rosterList}>
        {error ? <Text style={styles.emptyText}>{error}</Text> : null}
        {!error && players.length === 0 ? (
          <Text style={styles.emptyText}>No roster data available.</Text>
        ) : null}
        {!error && unavailableForMode ? (
          <Text style={styles.emptyText}>
            Roster data is not available for {getProBasketballLeagueConfig(proLeague).label} yet.
          </Text>
        ) : null}
        {!error && !unavailableForMode
          ? players.map((player, index) => {
              const injured = isPlaceholderInjured(player.playerId);
              const metaText = isBaseballMode
                ? player.baseball?.primaryLine || `${player.position || "-"} · ${player.games} G`
                : `#${player.jersey || "-"} ${player.position || "-"} · ${player.games} GP`;
              return (
                <View
                  key={player.playerId}
                  style={[styles.row, index === players.length - 1 ? styles.rowLast : null]}
                >
                  <Image source={{ uri: player.headshot || FALLBACK_IMAGE_URI }} style={styles.avatar} />
                  <View style={styles.info}>
                    <View style={styles.nameRow}>
                      <Text style={styles.name} numberOfLines={1}>
                        {player.name}
                      </Text>
                      {injured ? (
                        <View style={styles.injuredTag}>
                          <Text style={styles.injuredText}>Injured</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.meta} numberOfLines={1}>
                      {metaText}
                    </Text>
                    <Text style={styles.averages} numberOfLines={1}>
                      {formatValue(player.perGame.points, 1)} PTS · {formatValue(player.perGame.rebounds, 1)} REB ·{" "}
                      {formatValue(player.perGame.assists, 1)} AST
                    </Text>
                  </View>
                  <RatingBadge value={player.seasonRating10} />
                </View>
              );
            })
          : null}
      </FotmobSectionCard>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stats tab
// ---------------------------------------------------------------------------

function SplitBar({
  label,
  wins,
  losses,
}: {
  label: string;
  wins: number;
  losses: number;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStatsStyles(theme), [theme]);
  const total = wins + losses;
  const winPct = total > 0 ? (wins / total) * 100 : 0;

  return (
    <View style={styles.splitRow}>
      <View style={styles.splitHeader}>
        <Text style={styles.splitLabel}>{label}</Text>
        <Text style={styles.splitRecord}>
          {wins}-{losses}
        </Text>
      </View>
      <View style={styles.splitTrack}>
        <View style={[styles.splitFill, { width: `${winPct}%` }]} />
      </View>
    </View>
  );
}

function StatsTab({
  ratingTrendPoints,
  homeAwaySplit,
  vsRankedSplit,
  offenseDefenseAvg,
}: {
  ratingTrendPoints: Array<{ tSec: number; rating: number }>;
  homeAwaySplit: { home: { wins: number; losses: number; games: number }; away: { wins: number; losses: number; games: number } };
  vsRankedSplit: { wins: number; losses: number; games: number };
  offenseDefenseAvg: { offense: number | null; defense: number | null };
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStatsStyles(theme), [theme]);

  return (
    <View style={styles.stack}>
      <FotmobSectionCard title="Season Rating Trend">
        <TeamRatingTrendChart points={ratingTrendPoints} />
      </FotmobSectionCard>

      <FotmobSectionCard title="Offense / Defense">
        <View style={styles.offDefRow}>
          <View style={styles.offDefCell}>
            <Text style={styles.offDefValue}>{formatValue(offenseDefenseAvg.offense, 1)}</Text>
            <Text style={styles.offDefLabel}>Offense Rating</Text>
          </View>
          <View style={styles.offDefDivider} />
          <View style={styles.offDefCell}>
            <Text style={styles.offDefValue}>{formatValue(offenseDefenseAvg.defense, 1)}</Text>
            <Text style={styles.offDefLabel}>Defense Rating</Text>
          </View>
        </View>
      </FotmobSectionCard>

      <FotmobSectionCard title="Home vs Away">
        <SplitBar label="Home" wins={homeAwaySplit.home.wins} losses={homeAwaySplit.home.losses} />
        <SplitBar label="Away" wins={homeAwaySplit.away.wins} losses={homeAwaySplit.away.losses} />
      </FotmobSectionCard>

      <FotmobSectionCard title="vs Ranked Opponents">
        {vsRankedSplit.games === 0 ? (
          <Text style={styles.emptyText}>No ranked-opponent games detected.</Text>
        ) : (
          <SplitBar label="vs Ranked" wins={vsRankedSplit.wins} losses={vsRankedSplit.losses} />
        )}
      </FotmobSectionCard>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Standings tab
// ---------------------------------------------------------------------------

type StandingsRow = { rank: number; teamId: string; name: string; record: string; isCurrentTeam?: boolean };

function StandingsTab({ rows }: { rows: StandingsRow[] }) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStandingsStyles(theme), [theme]);

  return (
    <View style={styles.stack}>
      <FotmobSectionCard
        title="Conference Standings"
        subtitle="Placeholder — pending a real standings source"
      >
        {rows.map((row) => (
          <View
            key={row.teamId}
            style={[styles.row, row.isCurrentTeam ? styles.rowActive : null]}
          >
            <Text style={[styles.rank, row.isCurrentTeam ? styles.textActive : null]}>#{row.rank}</Text>
            <Text
              style={[styles.name, row.isCurrentTeam ? styles.textActive : null]}
              numberOfLines={1}
            >
              {row.name}
            </Text>
            <Text style={[styles.record, row.isCurrentTeam ? styles.textActive : null]}>{row.record}</Text>
          </View>
        ))}
      </FotmobSectionCard>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    topWrap: {
      paddingHorizontal: theme.spacing[8],
      paddingTop: theme.spacing[8],
      gap: theme.spacing[10],
    },
    tabBarWrap: {
      marginTop: -2,
      marginBottom: theme.spacing[2],
    },
    scroll: {
      flex: 1,
    },
    pager: {
      flex: 1,
    },
    tabContent: {
      paddingHorizontal: theme.spacing[8],
      paddingTop: theme.spacing[10],
      paddingBottom: theme.spacing[24],
      gap: theme.spacing[10],
    },
    errorText: {
      color: theme.colors.danger,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "700",
    },
    retryButton: {
      marginTop: theme.spacing[10],
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[8],
      alignSelf: "flex-start",
    },
    retryText: {
      color: theme.colors.textPrimary,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "700",
    },
    heroRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    teamLogo: {
      width: 56,
      height: 56,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
    },
    heroTextWrap: {
      flex: 1,
      gap: theme.spacing[4],
    },
    favoriteButton: {
      width: 34,
      height: 34,
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    favoriteButtonPressed: {
      opacity: 0.8,
    },
    teamName: {
      color: theme.colors.textPrimary,
      fontSize: 20,
      lineHeight: 24,
      fontWeight: "800",
    },
    teamMeta: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
    },
    rankPill: {
      minWidth: 52,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[6],
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
    },
    rankText: {
      color: theme.colors.accent,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
    },
    snapshotRow: {
      marginTop: theme.spacing[10],
      flexDirection: "row",
      gap: theme.spacing[8],
    },
    snapshotCell: {
      flex: 1,
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[8],
      gap: theme.spacing[2],
    },
    snapshotLabel: {
      color: theme.colors.textMuted,
      fontSize: 10,
      lineHeight: 13,
      fontWeight: "700",
    },
    snapshotValue: {
      color: theme.colors.textPrimary,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
    },
    emptyText: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
    },
    scheduleSpacer: {
      height: theme.spacing[8],
    },
    gameRow: {
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[10],
      gap: theme.spacing[6],
      marginBottom: theme.spacing[8],
    },
    gameTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[8],
    },
    gameDate: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
    },
    gameMidRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[8],
    },
    gameOpponent: {
      color: theme.colors.textPrimary,
      fontSize: 14,
      lineHeight: 18,
      flex: 1,
    },
    gameScore: {
      color: theme.colors.textPrimary,
      fontSize: 15,
      lineHeight: 19,
      fontWeight: "800",
    },
    gameBottomRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    gameMeta: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "700",
    },
  });
}

function makeOverviewStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    stack: {
      gap: theme.spacing[12],
    },
    emptyText: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
    },
    last5Row: {
      flexDirection: "row",
      gap: theme.spacing[8],
    },
    last5Chip: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    last5ChipText: {
      color: "#FFFFFF",
      fontSize: 13,
      lineHeight: 16,
      fontWeight: "800",
    },
    statsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      rowGap: theme.spacing[16],
    },
    statCell: {
      width: "33.33%",
      alignItems: "center",
      gap: theme.spacing[4],
    },
    statValue: {
      color: theme.colors.textPrimary,
      fontSize: 17,
      lineHeight: 21,
      fontWeight: "800",
    },
    statLabel: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
    },
  });
}

function makeRosterStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    stack: {
      gap: theme.spacing[12],
    },
    sortRow: {
      flexDirection: "row",
      gap: theme.spacing[8],
    },
    sortChip: {
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[12],
      paddingVertical: theme.spacing[6],
    },
    sortChipActive: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    sortChipText: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
    },
    sortChipTextActive: {
      color: theme.colors.bg,
      fontWeight: "800",
    },
    rosterList: {
      gap: 0,
    },
    emptyText: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
      paddingVertical: theme.spacing[10],
      borderBottomWidth: theme.borderWidth.hairline,
      borderBottomColor: theme.colors.borderSoft,
    },
    rowLast: {
      borderBottomWidth: 0,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
    },
    info: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[2],
    },
    nameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
    },
    name: {
      color: theme.colors.textPrimary,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
      flexShrink: 1,
    },
    injuredTag: {
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.danger,
      paddingHorizontal: theme.spacing[6],
      paddingVertical: 1,
    },
    injuredText: {
      color: "#FFFFFF",
      fontSize: 9,
      lineHeight: 12,
      fontWeight: "800",
    },
    meta: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "700",
    },
    averages: {
      color: theme.colors.textSecondary,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "700",
    },
  });
}

function makeStatsStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    stack: {
      gap: theme.spacing[12],
    },
    emptyText: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
    },
    offDefRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    offDefCell: {
      flex: 1,
      alignItems: "center",
      gap: theme.spacing[2],
    },
    offDefDivider: {
      width: theme.borderWidth.hairline,
      alignSelf: "stretch",
      backgroundColor: theme.colors.borderSoft,
    },
    offDefValue: {
      color: theme.colors.textPrimary,
      fontSize: 24,
      lineHeight: 28,
      fontWeight: "900",
    },
    offDefLabel: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "700",
    },
    splitRow: {
      gap: theme.spacing[6],
      marginBottom: theme.spacing[12],
    },
    splitHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    splitLabel: {
      color: theme.colors.textPrimary,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "800",
    },
    splitRecord: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "800",
    },
    splitTrack: {
      height: 7,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
      overflow: "hidden",
    },
    splitFill: {
      height: "100%",
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.accent,
    },
  });
}

function makeStandingsStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    stack: {
      gap: theme.spacing[12],
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
      paddingVertical: theme.spacing[10],
      borderBottomWidth: theme.borderWidth.hairline,
      borderBottomColor: theme.colors.borderSoft,
    },
    rowActive: {
      backgroundColor: theme.colors.surfaceAlt,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing[8],
    },
    rank: {
      width: 34,
      color: theme.colors.textMuted,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "800",
    },
    name: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.textPrimary,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "700",
    },
    record: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "700",
    },
    textActive: {
      color: theme.colors.accent,
      fontWeight: "800",
    },
  });
}

const localStyles = StyleSheet.create({
  ratingBadge: {
    minWidth: 40,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: "center",
  },
  ratingBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
  },
  emptyTextInline: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    paddingVertical: 12,
  },
  // Small, deliberate empty state for the rating trend chart — sized to the
  // message, not the full chart height, so a gameless season doesn't leave
  // a tall empty box behind.
  chartEmptyState: {
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  // Matches the Point Differential chart's card container
  // (app/(tabs)/team-stats.tsx chartCanvas) — rounded, bordered, clipped —
  // instead of the chart floating with no frame of its own.
  chartCanvas: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
  },
});
