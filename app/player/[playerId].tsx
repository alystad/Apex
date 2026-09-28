import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { TabView, type Route } from "react-native-tab-view";

import FotmobSectionCard from "@/components/FotmobSectionCard";
import HeaderMenuButton from "@/components/home/HeaderMenuButton";
import ScreenErrorState from "@/components/loading/ScreenErrorState";
import { SkeletonCard, SkeletonText } from "@/components/loading/SkeletonPrimitives";
import PlayerRatingGraph, {
  buildMonotoneLinePath,
  smoothRatingColor,
} from "@/components/ui/PlayerRatingGraph";
import TabBar, { type TabItem } from "@/components/ui/TabBar";
import { useLiveGame } from "@/hooks/useLiveGame";
import type {
  PlayerProfileData,
  PlayerProfileGameLogEntry,
  PlayerProfileSplitRow,
} from "@/src/features/basketball/playerApi";
import { getPlayerProfile } from "@/src/features/basketball/playerApi";
import { usePlayerBio } from "@/src/features/basketball/playerBio";
import type { PlayerProfileRouteParams } from "@/src/features/basketball/playerNavigation";
import { useGameModeState } from "@/src/mode/GameModeContext";
import { useMultiView } from "@/src/multiview/MultiViewContext";
import { useSettingsState } from "@/src/settings/SettingsContext";
import type { ThemeTokens } from "@/src/theme/tokens";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { getResolvedDefaultInGameTab } from "@/src/ui/inGameTabs";
import { getInGameRatingColor } from "@/theme/colors";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const HEADER_HEIGHT = 128;
// Height of the shared chip tab strip (marginTop + vertical padding + chip height).
const TAB_BAR_HEIGHT = 56;

type ProfileTab = "overview" | "career" | "splits" | "gamelog";
type ProfileRoute = Route & { key: ProfileTab };
type StatMetric = {
  key: string;
  label: string;
  value: number | null;
  display: string;
  max: number;
};
type CareerSeason = {
  key: string;
  label: string;
  games: number;
  averageRating: number | null;
  team: PlayerProfileGameLogEntry["team"];
};
type SeasonBucket = {
  key: string;
  startYear: number;
  label: string;
  team: PlayerProfileGameLogEntry["team"];
  games: PlayerProfileGameLogEntry[];
  gamesPlayed: number;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  averageRating: number | null;
};
type TeamTimelineEntry = {
  key: string;
  teamId: string;
  team: PlayerProfileGameLogEntry["team"];
  startLabel: string;
  endLabel: string;
  seasons: number;
};

function formatRating(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "-";
}

function formatDecimal(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "-";
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(1)}%`;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getNationality(profile: PlayerProfileData): string {
  const place = profile.player.birthPlace;
  if (!place) {
    return "-";
  }
  const parts = place.split(",").map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? place;
}

function routeParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function getStatMetrics(profile: PlayerProfileData): StatMetric[] {
  const season = profile.season;
  return [
    { key: "ppg", label: "PPG", value: season.pointsPerGame, display: formatDecimal(season.pointsPerGame), max: 30 },
    { key: "rpg", label: "RPG", value: season.reboundsPerGame, display: formatDecimal(season.reboundsPerGame), max: 14 },
    { key: "apg", label: "APG", value: season.assistsPerGame, display: formatDecimal(season.assistsPerGame), max: 12 },
    { key: "stl", label: "STL", value: season.stealsPerGame, display: formatDecimal(season.stealsPerGame), max: 3 },
    { key: "blk", label: "BLK", value: season.blocksPerGame, display: formatDecimal(season.blocksPerGame), max: 4 },
    { key: "fg", label: "FG%", value: season.fgPct, display: formatPercent(season.fgPct), max: 100 },
    { key: "three", label: "3PT%", value: season.threePct, display: formatPercent(season.threePct), max: 100 },
    { key: "ft", label: "FT%", value: season.ftPct, display: formatPercent(season.ftPct), max: 100 },
  ];
}

function getSeasonStartYear(date: string): number {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  const month = parsed.getMonth();
  const year = parsed.getFullYear();
  return month >= 6 ? year : year - 1;
}

function formatSeasonLabel(startYear: number): string {
  if (!startYear) {
    return "Unknown";
  }
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function averageOf(
  entries: PlayerProfileGameLogEntry[],
  getValue: (entry: PlayerProfileGameLogEntry) => number | null,
): number | null {
  const values = entries
    .map(getValue)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function shootingPct(
  entries: PlayerProfileGameLogEntry[],
  pick: (entry: PlayerProfileGameLogEntry) => string,
): number | null {
  let made = 0;
  let attempted = 0;
  entries.forEach((entry) => {
    const match = pick(entry).trim().match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
    if (!match) {
      return;
    }
    made += Number.parseFloat(match[1]) || 0;
    attempted += Number.parseFloat(match[2]) || 0;
  });
  return attempted > 0 ? (made / attempted) * 100 : null;
}

// Groups a game log into per-season buckets (season, team, GP, PPG/RPG/APG, avg rating).
// Retains the underlying games so the same buckets drive the game-log tab and trend lines.
function buildSeasonBuckets(games: PlayerProfileGameLogEntry[]): SeasonBucket[] {
  const bySeason = new Map<
    string,
    {
      startYear: number;
      games: PlayerProfileGameLogEntry[];
      teamCounts: Map<string, { team: PlayerProfileGameLogEntry["team"]; count: number }>;
    }
  >();

  games.forEach((game) => {
    const startYear = getSeasonStartYear(game.date);
    const key = String(startYear || game.date.slice(0, 4) || "unknown");
    const bucket =
      bySeason.get(key) ??
      {
        startYear,
        games: [] as PlayerProfileGameLogEntry[],
        teamCounts: new Map<string, { team: PlayerProfileGameLogEntry["team"]; count: number }>(),
      };
    bucket.games.push(game);
    const teamKey = game.team.id || game.team.abbreviation || game.team.name;
    const teamEntry = bucket.teamCounts.get(teamKey) ?? { team: game.team, count: 0 };
    teamEntry.count += 1;
    bucket.teamCounts.set(teamKey, teamEntry);
    bySeason.set(key, bucket);
  });

  return [...bySeason.entries()]
    .map(([key, bucket]) => {
      const team =
        [...bucket.teamCounts.values()].sort((a, b) => b.count - a.count)[0]?.team ??
        bucket.games[0]?.team ?? {
          name: "Team",
          abbreviation: "",
          logo: "",
        };
      const orderedGames = bucket.games
        .slice()
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      return {
        key,
        startYear: bucket.startYear,
        label: formatSeasonLabel(bucket.startYear),
        team,
        games: orderedGames,
        gamesPlayed: orderedGames.length,
        ppg: averageOf(orderedGames, (game) => game.points),
        rpg: averageOf(orderedGames, (game) => game.rebounds),
        apg: averageOf(orderedGames, (game) => game.assists),
        averageRating: averageOf(orderedGames, (game) => game.dynamicRating),
      };
    })
    .sort((a, b) => Number(b.key) - Number(a.key));
}

function toCareerSeasons(buckets: SeasonBucket[]): CareerSeason[] {
  return buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    games: bucket.gamesPlayed,
    averageRating: bucket.averageRating,
    team: bucket.team,
  }));
}

// A distinct team span within a career (consecutive seasons at the same school/team).
function buildTeamTimeline(buckets: SeasonBucket[]): TeamTimelineEntry[] {
  const chronological = buckets.slice().reverse();
  const spans: TeamTimelineEntry[] = [];
  chronological.forEach((bucket) => {
    const teamId = bucket.team.id || bucket.team.name;
    const current = spans[spans.length - 1];
    if (current && current.teamId === teamId) {
      current.endLabel = bucket.label;
      current.seasons += 1;
      return;
    }
    spans.push({
      key: `${teamId}-${bucket.key}`,
      teamId,
      team: bucket.team,
      startLabel: bucket.label,
      endLabel: bucket.label,
      seasons: 1,
    });
  });
  return spans.reverse();
}

type CareerHigh = {
  key: string;
  label: string;
  value: string;
  gameId: string;
  date: string;
  opponent: string;
};

function maxByEntry(
  entries: PlayerProfileGameLogEntry[],
  getValue: (entry: PlayerProfileGameLogEntry) => number | null,
): PlayerProfileGameLogEntry | null {
  return entries.reduce<PlayerProfileGameLogEntry | null>((best, entry) => {
    const value = getValue(entry);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return best;
    }
    const bestValue = best ? getValue(best) ?? -Infinity : -Infinity;
    return value > bestValue ? entry : best;
  }, null);
}

function buildCareerHighs(games: PlayerProfileGameLogEntry[]): CareerHigh[] {
  const specs: Array<{
    key: string;
    label: string;
    getValue: (entry: PlayerProfileGameLogEntry) => number | null;
    format: (value: number) => string;
  }> = [
    { key: "points", label: "Points", getValue: (g) => g.points, format: (v) => `${Math.round(v)}` },
    { key: "rebounds", label: "Rebounds", getValue: (g) => g.rebounds, format: (v) => `${Math.round(v)}` },
    { key: "assists", label: "Assists", getValue: (g) => g.assists, format: (v) => `${Math.round(v)}` },
    { key: "rating", label: "Apex Rating", getValue: (g) => g.dynamicRating, format: (v) => v.toFixed(1) },
  ];
  return specs
    .map((spec) => {
      const entry = maxByEntry(games, spec.getValue);
      const value = entry ? spec.getValue(entry) : null;
      if (!entry || typeof value !== "number") {
        return null;
      }
      return {
        key: spec.key,
        label: spec.label,
        value: spec.format(value),
        gameId: entry.gameId,
        date: formatDate(entry.date),
        opponent: `${entry.location === "A" ? "@" : "vs"} ${entry.opponent.abbreviation}`,
      } satisfies CareerHigh;
    })
    .filter((row): row is CareerHigh => Boolean(row));
}

function parseRecord(record: string | null | undefined): { wins: number; losses: number } | null {
  const match = (record ?? "").trim().match(/^(\d+)\s*-\s*(\d+)/);
  if (!match) {
    return null;
  }
  return { wins: Number.parseInt(match[1], 10), losses: Number.parseInt(match[2], 10) };
}

function winPct(wins: number, losses: number): number | null {
  const total = wins + losses;
  return total > 0 ? (wins / total) * 100 : null;
}

function RatingPill({ value }: { value: number | null | undefined }) {
  const { tokens: theme } = useAppTheme();
  const color = getInGameRatingColor(value);
  return (
    <View style={[localStyles.ratingPill, { backgroundColor: color }]}>
      <Text style={[localStyles.ratingPillText, { color: theme.colors.bg }]}>
        {formatRating(value)}
      </Text>
    </View>
  );
}

export default function PlayerProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<PlayerProfileRouteParams>();
  const { mode: activeMode } = useGameModeState();
  const { state: settingsState } = useSettingsState();
  const { tokens: theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const layout = useWindowDimensions();
  const { data: liveData, gameId: liveGameId, setGameId } = useLiveGame();
  const { setLastEntrySource } = useMultiView();
  const playerId = routeParam(params.playerId) ?? "";
  const routeMode = routeParam(params.mode);
  const routeTeamId = routeParam(params.teamId);
  const routeTeamName = routeParam(params.teamName);
  const routeTeamLogo = routeParam(params.teamLogo);
  const routeTeamRecord = routeParam(params.teamRecord);
  const routeConferenceName = routeParam(params.conferenceName);
  const routePlayerName = routeParam(params.playerName);
  const routeHeadshot = routeParam(params.headshot);
  const routeJersey = routeParam(params.jersey);
  const routePosition = routeParam(params.position);
  const routeGameId = routeParam(params.gameId);
  const mode =
    routeMode === "nba" || routeMode === "college" ? routeMode : activeMode;
  const [profile, setProfile] = useState<PlayerProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const tabRoutes = useMemo<ProfileRoute[]>(
    () => [
      { key: "overview", title: "Overview" },
      { key: "career", title: "Career" },
      { key: "splits", title: "Splits" },
      { key: "gamelog", title: "Game Log" },
    ],
    [],
  );
  const activeTabIndex = Math.max(
    0,
    tabRoutes.findIndex((route) => route.key === activeTab),
  );
  const defaultInGameRoute = useMemo(
    () => getResolvedDefaultInGameTab(settingsState, mode).route,
    [mode, settingsState],
  );
  const styles = useMemo(
    () => makeStyles(theme, insets.top, insets.bottom),
    [insets.bottom, insets.top, theme],
  );

  const seed = useMemo(
    () => ({
      teamId: routeTeamId,
      teamName: routeTeamName,
      teamLogo: routeTeamLogo,
      teamRecord: routeTeamRecord,
      conferenceName: routeConferenceName,
      playerName: routePlayerName,
      headshot: routeHeadshot,
      jersey: routeJersey,
      position: routePosition,
    }),
    [
      routeConferenceName,
      routeHeadshot,
      routeJersey,
      routePlayerName,
      routePosition,
      routeTeamId,
      routeTeamLogo,
      routeTeamName,
      routeTeamRecord,
    ],
  );

  const loadProfile = useCallback(async () => {
    if (!playerId) {
      setError("Missing player id.");
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const nextProfile = await getPlayerProfile(mode, playerId, seed);
      setProfile(nextProfile);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load player profile.");
    } finally {
      setLoading(false);
    }
  }, [mode, playerId, seed]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const liveContextPlayer = useMemo(() => {
    if (!playerId || !liveData) {
      return null;
    }
    return (
      Object.values(liveData.playersByTeam)
        .flat()
        .find((player) => player.id === playerId) ?? null
    );
  }, [liveData, playerId]);

  const openGame = useCallback(
    (gameId: string) => {
      // router.push alone only changes the URL's gameId param — nothing in
      // app/(tabs)/_layout.tsx reads that param back into LiveGameProvider,
      // so without this the shared live-game state never actually switches
      // and every row kept landing on whichever game was already loaded
      // (see the working pattern in app/team/[teamId].tsx's onOpenGame).
      setGameId(gameId, mode);
      setLastEntrySource("normal");
      router.push({
        pathname: defaultInGameRoute,
        params: { gameId, mode, from: "normal" },
      } as never);
    },
    [defaultInGameRoute, mode, router, setGameId, setLastEntrySource],
  );

  // Game-log rows jump straight into that game's story tab, reusing the same
  // in-game param mechanics as the default tap-through elsewhere in the app.
  // The dedicated box-score tab was removed — a past (finished) game's story
  // tab already shows its recap on its own.
  const openGameBoxScore = useCallback(
    (gameId: string) => {
      // Same fix as openGame above — must update the shared LiveGameProvider
      // state directly, not just the URL param, or the destination tab keeps
      // showing whatever game was already loaded.
      setGameId(gameId, mode);
      setLastEntrySource("normal");
      router.push({
        pathname: "/(tabs)/preview",
        params: { gameId, mode, from: "normal" },
      } as never);
    },
    [mode, router, setGameId, setLastEntrySource],
  );

  const tabItems = useMemo<TabItem[]>(
    () =>
      tabRoutes.map((tab) => ({
        key: tab.key,
        label: tab.title ?? tab.key,
        onPress: () => setActiveTab(tab.key),
      })),
    [tabRoutes],
  );

  // Computed here (rather than alongside the other profile-derived values
  // below, e.g. seasonBuckets/teamTimeline) so usePlayerBio — a hook — runs
  // unconditionally on every render, before the early returns further down
  // bail out while the profile is still loading or missing.
  const schoolHistorySummary = useMemo(() => {
    if (!profile) {
      return null;
    }
    const timeline = buildTeamTimeline(buildSeasonBuckets(profile.gameLog));
    if (timeline.length <= 1) {
      return null;
    }
    // Same transfer-history shape the Career tab's "School timeline" section
    // renders, e.g. "Wake Forest (2021-22); Jacksonville (2023-24, 2024-25);
    // Florida State (2025-26)" — so a transfer reads as a storyline the
    // model can actually cite instead of guessing at one.
    return timeline
      .map((entry) =>
        entry.startLabel === entry.endLabel
          ? `${entry.team.name} (${entry.startLabel})`
          : `${entry.team.name} (${entry.startLabel}-${entry.endLabel})`,
      )
      .join("; ");
  }, [profile]);
  const { bio: aboutBio } = usePlayerBio(profile, mode, schoolHistorySummary);

  if (!playerId) {
    return (
      <ScreenErrorState
        title="Missing player"
        message="No player id was supplied for this profile route."
        onRetry={() => router.back()}
      />
    );
  }

  if (loading && !profile) {
    return (
      <SafeAreaView edges={["left", "right"]} style={styles.screen}>
        <View style={styles.loadingContent}>
          <SkeletonText width="60%" height={30} />
          <SkeletonText width="42%" height={18} />
          <SkeletonCard rows={3} />
          <SkeletonCard rows={4} />
        </View>
      </SafeAreaView>
    );
  }

  if (error && !profile) {
    return (
      <ScreenErrorState
        title="Could not load player"
        message={error}
        onRetry={() => {
          void loadProfile();
        }}
      />
    );
  }

  if (!profile) {
    return null;
  }

  const currentRating =
    liveContextPlayer?.inGameRating10 ??
    profile.rating.currentAvailable ??
    profile.teamPlayerStat?.seasonRating10 ??
    null;
  const seasonAverageRating =
    profile.rating.seasonAverage ??
    liveContextPlayer?.seasonRating10 ??
    profile.teamPlayerStat?.seasonRating10 ??
    null;
  const statMetrics = getStatMetrics(profile);
  const seasonBuckets = buildSeasonBuckets(profile.gameLog);
  const careerSeasons = toCareerSeasons(seasonBuckets);
  const teamTimeline = buildTeamTimeline(seasonBuckets);
  const careerHighs = buildCareerHighs(profile.gameLog);
  const currentSeasonBucket = seasonBuckets[0] ?? null;
  const liveGameActive =
    Boolean(liveContextPlayer) &&
    liveData?.status.state !== "post" &&
    liveData?.status.state !== "final" &&
    liveData?.status.state !== "complete";
  const currentGameId =
    routeGameId
      ? routeGameId
      : liveGameId ?? null;

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.screen}>
      <View style={styles.fixedHeader}>
        <HeaderMenuButton
          icon="chevron-left"
          iconSize={14}
          onPress={() => router.back()}
          accessibilityLabel="Go back"
        />

        <View style={styles.headerIdentity}>
          <Image
            source={{ uri: profile.player.headshot || FALLBACK_IMAGE_URI }}
            style={styles.headshot}
          />
          <View style={styles.headerTextBlock}>
            <Text style={styles.playerName} numberOfLines={1}>
              {profile.player.fullName}
            </Text>
            <View style={styles.teamPillRow}>
              <View style={styles.teamPill}>
                <Image
                  source={{ uri: profile.player.team.logo || FALLBACK_IMAGE_URI }}
                  style={styles.teamLogoTiny}
                />
                <Text style={styles.teamPillText} numberOfLines={1}>
                  {profile.player.team.shortName || profile.player.team.name}
                </Text>
              </View>
              {/* ESPN marks a player "inactive" on a league's roster once
                  they've left it (e.g. a college player who has since
                  signed pro) without ever updating the team field itself —
                  this app has no data source for men's pro basketball to
                  follow that move to, so flagging it honestly here is the
                  most correct thing to show rather than presenting a stale
                  team as current. */}
              {!profile.player.active ? (
                <View style={localStyles.inactiveTag}>
                  <Text style={localStyles.inactiveTagText}>
                    {profile.player.status || "Inactive"}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </View>

      <View style={styles.fixedTabs}>
        <TabBar items={tabItems} activeKey={activeTab} />
      </View>

      <TabView
        navigationState={{ index: activeTabIndex, routes: tabRoutes }}
        renderScene={({ route }) => (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {route.key === "overview" ? (
              <OverviewTabContent
                profile={profile}
                metrics={statMetrics}
                seasonBucket={currentSeasonBucket}
                seasonAverageRating={seasonAverageRating}
                currentRating={currentRating}
                teamRank={profile.teammateRanks.dynamicRating}
                currentGameId={currentGameId}
                liveGameActive={liveGameActive}
                onOpenGame={openGame}
                aboutBio={aboutBio}
              />
            ) : null}

            {route.key === "career" ? (
              <CareerTabContent
                mode={mode}
                playerName={profile.player.fullName}
                buckets={seasonBuckets}
                seasons={careerSeasons}
                timeline={teamTimeline}
                onOpenGame={openGame}
              />
            ) : null}

            {route.key === "splits" ? (
              <SplitsTabContent
                profile={profile}
                careerHighs={careerHighs}
                onOpenGame={openGame}
              />
            ) : null}

            {route.key === "gamelog" ? (
              <GameLogTabContent
                seasons={seasonBuckets}
                onOpenGame={openGameBoxScore}
              />
            ) : null}
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
    </SafeAreaView>
  );
}

function OverviewTabContent({
  profile,
  metrics,
  seasonBucket,
  seasonAverageRating,
  currentRating,
  teamRank,
  currentGameId,
  liveGameActive,
  onOpenGame,
  aboutBio,
}: {
  profile: PlayerProfileData;
  metrics: StatMetric[];
  seasonBucket: SeasonBucket | null;
  seasonAverageRating: number | null;
  currentRating: number | null;
  teamRank: number | null;
  currentGameId: string | null;
  liveGameActive: boolean;
  onOpenGame: (gameId: string) => void;
  aboutBio: string | null;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme, 0, 0), [theme]);
  const nationality = getNationality(profile);
  const apexRating = seasonAverageRating ?? currentRating;
  const recentGames = (seasonBucket?.games ?? profile.gameLog)
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8);
  const bioItems = [
    { key: "position", value: profile.player.position || "-", label: "Position" },
    { key: "jersey", value: profile.player.jersey || "-", label: "Jersey" },
    {
      key: "nationality",
      value: nationality,
      label: "Nationality",
      flag: profile.player.flagHref,
    },
    ...(profile.player.draft
      ? [{ key: "draft", value: profile.player.draft, label: "Draft" }]
      : [{ key: "age", value: profile.player.age ?? "-", label: "Age" }]),
  ];

  return (
    <View style={styles.stack}>
      <FotmobSectionCard hideHeader>
        <View style={styles.apexRow}>
          <View style={styles.apexCopy}>
            <Text style={styles.apexLabel}>Season Apex Rating</Text>
            {typeof teamRank === "number" ? (
              <View style={styles.rankTag}>
                <FontAwesome name="star" size={10} color={theme.colors.bg} />
                <Text style={styles.rankTagText}>#{teamRank} on team</Text>
              </View>
            ) : (
              <Text style={styles.apexSubLabel}>{profile.season.label}</Text>
            )}
          </View>
          <RatingPill value={apexRating} />
        </View>
      </FotmobSectionCard>

      {liveGameActive ? (
        <Pressable
          disabled={!currentGameId}
          onPress={() => currentGameId && onOpenGame(currentGameId)}
        >
          <FotmobSectionCard hideHeader>
            <View style={styles.liveTrendRow}>
              <View>
                <Text style={styles.liveTrendTitle}>Current game trend</Text>
                <Text style={styles.liveTrendSub}>Live rating in progress</Text>
              </View>
              <RatingPill value={currentRating} />
            </View>
          </FotmobSectionCard>
        </Pressable>
      ) : null}

      <FotmobSectionCard hideHeader>
        <View style={localStyles.infoGrid}>
          {bioItems.map((item) => (
            <View key={item.key} style={localStyles.infoItem}>
              <View style={localStyles.infoValueRow}>
                {"flag" in item && item.flag ? (
                  <Image source={{ uri: item.flag }} style={localStyles.flag} />
                ) : null}
                <Text style={localStyles.infoValue} numberOfLines={2}>
                  {item.value}
                </Text>
              </View>
              <Text style={localStyles.infoLabel} numberOfLines={2}>
                {item.label}
              </Text>
            </View>
          ))}
        </View>
      </FotmobSectionCard>

      <FotmobSectionCard title="Season rating trend">
        <SeasonRatingChart games={seasonBucket?.games ?? profile.gameLog} />
      </FotmobSectionCard>

      <FotmobSectionCard title="Season averages">
        <View style={styles.statsGrid}>
          {metrics.map((metric) => (
            <View key={metric.key} style={styles.statCell}>
              <Text style={styles.statValue}>{metric.display}</Text>
              <Text style={styles.statLabel}>{metric.label}</Text>
            </View>
          ))}
        </View>
      </FotmobSectionCard>

      {aboutBio ? (
        <FotmobSectionCard title="About">
          <Text style={localStyles.aboutText}>{aboutBio}</Text>
        </FotmobSectionCard>
      ) : null}

      <FotmobSectionCard title="Recent games" bodyStyle={styles.flatSection}>
        {recentGames.length === 0 ? (
          <Text style={styles.emptyText}>No recent games available.</Text>
        ) : (
          recentGames.map((game, index) => (
            <Pressable
              key={game.gameId}
              onPress={() => onOpenGame(game.gameId)}
              style={[
                styles.matchRow,
                index === recentGames.length - 1 ? styles.matchRowLast : null,
              ]}
            >
              <Text style={styles.matchDate}>{formatDate(game.date)}</Text>
              <View style={styles.matchOpponent}>
                <Image
                  source={{ uri: game.opponent.logo || FALLBACK_IMAGE_URI }}
                  style={styles.matchLogo}
                />
                <Text style={styles.matchOpponentText} numberOfLines={1}>
                  {game.location === "A" ? "@" : "vs"} {game.opponent.name}
                </Text>
              </View>
              <Text style={styles.matchScore}>{game.finalScore || "-"}</Text>
              <RatingPill value={game.dynamicRating} />
            </Pressable>
          ))
        )}
      </FotmobSectionCard>
    </View>
  );
}

function SeasonRatingChart({ games }: { games: PlayerProfileGameLogEntry[] }) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme, 0, 0), [theme]);
  const [width, setWidth] = useState(0);
  const chartHeight = 180;
  const ratedGames = games.filter(
    (game) => typeof game.dynamicRating === "number" && Number.isFinite(game.dynamicRating),
  );
  const graphPoints = ratedGames.map((game, index) => ({
    tSec: index,
    rating: game.dynamicRating ?? 0,
  }));

  if (ratedGames.length === 0) {
    return <Text style={styles.emptyText}>No rating history yet this season.</Text>;
  }

  return (
    <View
      onLayout={(event) => {
        const nextWidth = Math.floor(event.nativeEvent.layout.width);
        setWidth((current) => (current === nextWidth ? current : nextWidth));
      }}
      style={{ minHeight: chartHeight }}
    >
      {width > 0 ? (
        <PlayerRatingGraph
          points={graphPoints}
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

function SplitRowsCard({
  rows,
  title,
}: {
  rows: PlayerProfileSplitRow[];
  title: string;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme, 0, 0), [theme]);
  return (
    <FotmobSectionCard title={title}>
      <View style={styles.splitHeaderRow}>
        <Text style={[styles.splitCellLabel, styles.splitLabelCol]}>Split</Text>
        <Text style={styles.splitCell}>GP</Text>
        <Text style={styles.splitCell}>PTS</Text>
        <Text style={styles.splitCell}>REB</Text>
        <Text style={styles.splitCell}>AST</Text>
        <Text style={styles.splitCell}>RTG</Text>
      </View>
      {rows.map((row) => (
        <View key={row.key} style={styles.splitBodyRow}>
          <Text style={[styles.splitCellValue, styles.splitLabelCol]} numberOfLines={1}>
            {row.label}
          </Text>
          <Text style={styles.splitCell}>{row.games}</Text>
          <Text style={styles.splitCell}>{row.points}</Text>
          <Text style={styles.splitCell}>{row.rebounds}</Text>
          <Text style={styles.splitCell}>{row.assists}</Text>
          <Text style={styles.splitCell}>{row.rating}</Text>
        </View>
      ))}
    </FotmobSectionCard>
  );
}

function SplitsTabContent({
  profile,
  careerHighs,
  onOpenGame,
}: {
  profile: PlayerProfileData;
  careerHighs: CareerHigh[];
  onOpenGame: (gameId: string) => void;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme, 0, 0), [theme]);

  const homeAwayGroup = profile.splitGroups.find(
    (group) => group.key === "home-vs-away",
  );
  const rankedRows = buildRankedSplitRows(profile.gameLog);

  // Win% when this player appears vs. the team's record without him.
  const withRecord = parseRecord(profile.season.teamRecordWhenPlayerAppeared);
  const teamRecord = parseRecord(profile.player.team.record);
  const withPct = withRecord ? winPct(withRecord.wins, withRecord.losses) : null;
  const withoutRecord =
    withRecord && teamRecord
      ? {
          wins: Math.max(0, teamRecord.wins - withRecord.wins),
          losses: Math.max(0, teamRecord.losses - withRecord.losses),
        }
      : null;
  const withoutPct = withoutRecord
    ? winPct(withoutRecord.wins, withoutRecord.losses)
    : null;

  return (
    <View style={styles.stack}>
      {homeAwayGroup && homeAwayGroup.rows.length > 0 ? (
        <SplitRowsCard rows={homeAwayGroup.rows} title="Home vs Away" />
      ) : (
        <FotmobSectionCard title="Home vs Away">
          <Text style={styles.emptyText}>No home/away splits available.</Text>
        </FotmobSectionCard>
      )}

      {rankedRows.length > 0 ? (
        <SplitRowsCard rows={rankedRows} title="vs Ranked opponents" />
      ) : (
        <FotmobSectionCard title="vs Ranked opponents">
          <Text style={styles.emptyText}>No ranked-opponent games detected.</Text>
        </FotmobSectionCard>
      )}

      <FotmobSectionCard title="Availability impact">
        {withPct !== null || withoutPct !== null ? (
          <View style={styles.impactRow}>
            <View style={styles.impactCell}>
              <Text style={styles.impactValue}>{formatPercent(withPct)}</Text>
              <Text style={styles.impactLabel}>Win% with player</Text>
              {withRecord ? (
                <Text style={styles.impactMeta}>
                  {withRecord.wins}-{withRecord.losses}
                </Text>
              ) : null}
            </View>
            <View style={styles.impactDivider} />
            <View style={styles.impactCell}>
              <Text style={styles.impactValue}>{formatPercent(withoutPct)}</Text>
              <Text style={styles.impactLabel}>Win% without</Text>
              {withoutRecord ? (
                <Text style={styles.impactMeta}>
                  {withoutRecord.wins}-{withoutRecord.losses}
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <Text style={styles.emptyText}>Not enough record data to derive impact.</Text>
        )}
      </FotmobSectionCard>

      <FotmobSectionCard title="Career highs" bodyStyle={styles.flatSection}>
        {careerHighs.length === 0 ? (
          <Text style={styles.emptyText}>No career highs available.</Text>
        ) : (
          careerHighs.map((high, index) => (
            <Pressable
              key={high.key}
              onPress={() => onOpenGame(high.gameId)}
              style={[
                styles.matchRow,
                index === careerHighs.length - 1 ? styles.matchRowLast : null,
              ]}
            >
              <Text style={styles.highValue}>{high.value}</Text>
              <View style={styles.matchOpponent}>
                <Text style={styles.matchOpponentText} numberOfLines={1}>
                  {high.label}
                </Text>
                <Text style={styles.highMeta} numberOfLines={1}>
                  {high.opponent} · {high.date}
                </Text>
              </View>
              <FontAwesome
                name="chevron-right"
                size={12}
                color={theme.colors.textMuted}
              />
            </Pressable>
          ))
        )}
      </FotmobSectionCard>
    </View>
  );
}

function GameLogTabContent({
  seasons,
  onOpenGame,
}: {
  seasons: SeasonBucket[];
  onOpenGame: (gameId: string) => void;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme, 0, 0), [theme]);
  const [selectedSeasonKey, setSelectedSeasonKey] = useState<string | null>(
    seasons[0]?.key ?? null,
  );
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const selectedSeason =
    seasons.find((season) => season.key === selectedSeasonKey) ?? seasons[0] ?? null;
  const games = (selectedSeason?.games ?? [])
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (seasons.length === 0) {
    return <Text style={styles.emptyText}>No game log available.</Text>;
  }

  return (
    <View style={styles.stack}>
      <View>
        <Pressable
          style={styles.seasonSelector}
          onPress={() => setDropdownOpen((open) => !open)}
        >
          <Text style={styles.seasonSelectorText}>
            {selectedSeason?.label ?? "Season"}
          </Text>
          <FontAwesome
            name={dropdownOpen ? "chevron-up" : "chevron-down"}
            size={12}
            color={theme.colors.textMuted}
          />
        </Pressable>
        {dropdownOpen ? (
          <View style={styles.dropdownCard}>
            <FotmobSectionCard hideHeader bodyStyle={styles.flatSection}>
              {seasons.map((season) => (
                <Pressable
                  key={season.key}
                  onPress={() => {
                    setSelectedSeasonKey(season.key);
                    setDropdownOpen(false);
                  }}
                  style={styles.dropdownRow}
                >
                  <Text
                    style={[
                      styles.dropdownRowText,
                      season.key === selectedSeason?.key
                        ? styles.dropdownRowTextActive
                        : null,
                    ]}
                  >
                    {season.label}
                  </Text>
                  <Text style={styles.dropdownRowMeta}>
                    {season.team.abbreviation || season.team.name} · {season.gamesPlayed} GP
                  </Text>
                </Pressable>
              ))}
            </FotmobSectionCard>
          </View>
        ) : null}
      </View>

      <FotmobSectionCard title={selectedSeason?.label ?? "Games"} bodyStyle={styles.flatSection}>
        {games.length === 0 ? (
          <Text style={styles.emptyText}>No games in this season.</Text>
        ) : (
          games.map((game, index) => (
            <Pressable
              key={game.gameId}
              onPress={() => onOpenGame(game.gameId)}
              style={[
                styles.matchRow,
                index === games.length - 1 ? styles.matchRowLast : null,
              ]}
            >
              <Text style={styles.matchDate}>{formatDate(game.date)}</Text>
              <View style={styles.matchOpponent}>
                <Image
                  source={{ uri: game.opponent.logo || FALLBACK_IMAGE_URI }}
                  style={styles.matchLogo}
                />
                <View style={styles.gameLogOpponentCopy}>
                  <Text style={styles.matchOpponentText} numberOfLines={1}>
                    {game.location === "A" ? "@" : "vs"} {game.opponent.name}
                  </Text>
                  <Text style={styles.gameLogLine} numberOfLines={1}>
                    {game.result ? `${game.result} ` : ""}
                    {game.finalScore || "-"} · {game.points} PTS · {game.rebounds} REB ·{" "}
                    {game.assists} AST
                  </Text>
                </View>
              </View>
              <RatingPill value={game.dynamicRating} />
            </Pressable>
          ))
        )}
      </FotmobSectionCard>
    </View>
  );
}

// Aggregates a set of games into a single split row (used for ranked-opponent splits).
function aggregateSplitRow(
  key: string,
  label: string,
  entries: PlayerProfileGameLogEntry[],
): PlayerProfileSplitRow | null {
  if (entries.length === 0) {
    return null;
  }
  return {
    key,
    label,
    games: entries.length,
    minutes: formatDecimal(averageOf(entries, (entry) => entry.minutes)),
    points: formatDecimal(averageOf(entries, (entry) => entry.points)),
    rebounds: formatDecimal(averageOf(entries, (entry) => entry.rebounds)),
    assists: formatDecimal(averageOf(entries, (entry) => entry.assists)),
    steals: formatDecimal(averageOf(entries, (entry) => entry.steals)),
    blocks: formatDecimal(averageOf(entries, (entry) => entry.blocks)),
    turnovers: formatDecimal(averageOf(entries, (entry) => entry.turnovers)),
    fgPct: formatPercent(shootingPct(entries, (entry) => entry.fg)),
    threePct: formatPercent(shootingPct(entries, (entry) => entry.threePt)),
    ftPct: formatPercent(shootingPct(entries, (entry) => entry.ft)),
    rating: formatDecimal(averageOf(entries, (entry) => entry.dynamicRating)),
  };
}

function isRankedOpponentGame(entry: PlayerProfileGameLogEntry): boolean {
  const note = `${entry.eventNote ?? ""} ${entry.opponent.name}`;
  const match = note.match(/(?:#|No\.\s?)(\d{1,2})\b/);
  if (!match) {
    return false;
  }
  const rank = Number.parseInt(match[1], 10);
  return Number.isFinite(rank) && rank >= 1 && rank <= 25;
}

function buildRankedSplitRows(
  games: PlayerProfileGameLogEntry[],
): PlayerProfileSplitRow[] {
  const ranked = games.filter(isRankedOpponentGame);
  const unranked = games.filter((entry) => !isRankedOpponentGame(entry));
  return [
    aggregateSplitRow("vs-ranked", "vs Ranked", ranked),
    aggregateSplitRow("vs-unranked", "vs Unranked", unranked),
  ].filter((row): row is PlayerProfileSplitRow => Boolean(row) && (row?.games ?? 0) > 0)
    // Only surface the ranked breakdown when at least one ranked game exists.
    .filter(() => ranked.length > 0);
}

function CareerTabContent({
  mode,
  buckets,
  seasons,
  timeline,
}: {
  mode: string;
  playerName: string;
  buckets: SeasonBucket[];
  seasons: CareerSeason[];
  timeline: TeamTimelineEntry[];
  onOpenGame: (gameId: string) => void;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme, 0, 0), [theme]);
  const [selectedSeasonKey, setSelectedSeasonKey] = useState<string | null>(
    seasons[0]?.key ?? null,
  );
  const selectedSeason =
    seasons.find((season) => season.key === selectedSeasonKey) ?? seasons[0] ?? null;

  useEffect(() => {
    if (!selectedSeasonKey && seasons[0]) {
      setSelectedSeasonKey(seasons[0].key);
    }
  }, [selectedSeasonKey, seasons]);

  if (seasons.length === 0) {
    return <Text style={styles.emptyText}>No career history available.</Text>;
  }

  return (
    <View style={styles.stack}>
      <FotmobSectionCard title="Career rating trend">
        <CareerRatingChart
          seasons={seasons}
          selectedSeasonKey={selectedSeason?.key ?? null}
          onSelectSeason={setSelectedSeasonKey}
        />
        <View style={styles.careerSelectedRow}>
          <View style={styles.careerSelectedCopy}>
            <Text style={styles.careerSelectedTitle} numberOfLines={1}>
              {selectedSeason?.label ?? "Season"}
            </Text>
            <Text style={styles.careerSelectedMeta} numberOfLines={1}>
              {selectedSeason
                ? `${mode === "college" ? "School" : "Team"}: ${selectedSeason.team.name}`
                : ""}
            </Text>
          </View>
          <RatingPill value={selectedSeason?.averageRating ?? null} />
        </View>
      </FotmobSectionCard>

      <FotmobSectionCard title="Year by year">
        <View style={styles.careerHeaderRow}>
          <Text style={[styles.splitCellLabel, styles.careerSeasonCol]}>Season</Text>
          <Text style={styles.splitCell}>GP</Text>
          <Text style={styles.splitCell}>PPG</Text>
          <Text style={styles.splitCell}>RPG</Text>
          <Text style={styles.splitCell}>APG</Text>
          <Text style={styles.splitCell}>RTG</Text>
        </View>
        {buckets.map((bucket) => (
          <Pressable
            key={bucket.key}
            onPress={() => setSelectedSeasonKey(bucket.key)}
            style={[
              styles.careerTableRow,
              bucket.key === selectedSeason?.key ? styles.careerTableRowActive : null,
            ]}
          >
            <View style={[styles.careerSeasonCol, styles.careerSeasonCell]}>
              <Image
                source={{ uri: bucket.team.logo || FALLBACK_IMAGE_URI }}
                style={styles.careerTeamLogo}
              />
              <Text style={styles.careerSeasonText} numberOfLines={1}>
                {bucket.label}
              </Text>
            </View>
            <Text style={styles.splitCell}>{bucket.gamesPlayed}</Text>
            <Text style={styles.splitCell}>{formatDecimal(bucket.ppg)}</Text>
            <Text style={styles.splitCell}>{formatDecimal(bucket.rpg)}</Text>
            <Text style={styles.splitCell}>{formatDecimal(bucket.apg)}</Text>
            <Text style={styles.splitCell}>{formatRating(bucket.averageRating)}</Text>
          </Pressable>
        ))}
      </FotmobSectionCard>

      <FotmobSectionCard title={mode === "college" ? "School timeline" : "Team timeline"}>
        <View style={styles.timeline}>
          {timeline.map((entry, index) => (
            <View key={entry.key} style={styles.timelineRow}>
              <View style={styles.timelineMarkerColumn}>
                <View style={styles.timelineDot} />
                {index < timeline.length - 1 ? (
                  <View style={styles.timelineLine} />
                ) : null}
              </View>
              <Image
                source={{ uri: entry.team.logo || FALLBACK_IMAGE_URI }}
                style={styles.matchLogo}
              />
              <View style={styles.timelineCopy}>
                <Text style={styles.matchOpponentText} numberOfLines={1}>
                  {entry.team.name}
                </Text>
                <Text style={styles.careerMeta} numberOfLines={1}>
                  {entry.startLabel === entry.endLabel
                    ? entry.startLabel
                    : `${entry.startLabel} – ${entry.endLabel}`}{" "}
                  · {entry.seasons} {entry.seasons === 1 ? "season" : "seasons"}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </FotmobSectionCard>
    </View>
  );
}

function CareerRatingChart({
  onSelectSeason,
  seasons,
  selectedSeasonKey,
}: {
  onSelectSeason: (seasonKey: string) => void;
  seasons: CareerSeason[];
  selectedSeasonKey: string | null;
}) {
  const { tokens: theme } = useAppTheme();
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [width, setWidth] = useState(0);
  const chartHeight = 210;
  const padX = 26;
  const padTop = 18;
  const padBottom = 42;
  const innerWidth = Math.max(1, width - padX * 2);
  const innerHeight = chartHeight - padTop - padBottom;
  const chartSeasons = seasons.slice().reverse();
  const points = chartSeasons.map((season, index) => {
    const rating = season.averageRating ?? 0;
    const x =
      chartSeasons.length <= 1
        ? padX + innerWidth / 2
        : padX + (innerWidth * index) / (chartSeasons.length - 1);
    const y = padTop + (1 - Math.max(0, Math.min(10, rating)) / 10) * innerHeight;
    return { season, x, y, rating };
  });
  const selectedPoint = points.find((point) => point.season.key === selectedSeasonKey);
  // Same smooth-curve + rating-gradient technique PlayerRatingGraph uses in its
  // `showFotmobStyle` line, so this chart reads as the same graph family.
  const smoothLinePath = buildMonotoneLinePath(
    points.map((point) => ({ x: point.x, y: point.y })),
  );
  const lineGradientId = `career-line-${instanceId}`;
  const firstX = points[0]?.x ?? padX;
  const lastX = points[points.length - 1]?.x ?? padX;
  const xSpan = Math.max(1e-6, lastX - firstX);
  const lineStops = (() => {
    let lastOffset = -1;
    return points.map((point) => {
      let offset = Math.max(0, Math.min(1, (point.x - firstX) / xSpan));
      if (offset <= lastOffset) {
        offset = Math.min(1, lastOffset + 1e-4);
      }
      lastOffset = offset;
      return { offset, color: smoothRatingColor(point.rating) };
    });
  })();

  const selectAtX = useCallback(
    (x: number) => {
      if (points.length === 0) {
        return;
      }
      const nearest = points.reduce((best, point) =>
        Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best,
      );
      onSelectSeason(nearest.season.key);
    },
    [onSelectSeason, points],
  );
  const chartGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .shouldCancelWhenOutside(false)
        .onBegin((event) => {
          runOnJS(selectAtX)(event.x);
        })
        .onUpdate((event) => {
          runOnJS(selectAtX)(event.x);
        }),
    [selectAtX],
  );

  return (
    <View
      onLayout={(event) => {
        const nextWidth = Math.floor(event.nativeEvent.layout.width);
        setWidth((current) => (current === nextWidth ? current : nextWidth));
      }}
      style={{ minHeight: chartHeight }}
    >
      {width > 0 ? (
        <GestureDetector gesture={chartGesture}>
          <View style={{ height: chartHeight }}>
            <Svg width={width} height={chartHeight}>
              <Defs>
                <LinearGradient
                  id={lineGradientId}
                  x1={firstX}
                  y1="0"
                  x2={lastX}
                  y2="0"
                  gradientUnits="userSpaceOnUse"
                >
                  {lineStops.map((stop, index) => (
                    <Stop
                      key={`career-line-stop-${index}`}
                      offset={stop.offset}
                      stopColor={stop.color}
                      stopOpacity="1"
                    />
                  ))}
                </LinearGradient>
              </Defs>
              <Line
                x1={padX}
                y1={padTop}
                x2={padX}
                y2={chartHeight - padBottom}
                stroke={theme.colors.borderSoft}
                strokeWidth={1}
              />
              <Line
                x1={padX}
                y1={chartHeight - padBottom}
                x2={width - padX}
                y2={chartHeight - padBottom}
                stroke={theme.colors.borderSoft}
                strokeWidth={1}
              />
              {smoothLinePath ? (
                <>
                  <Path
                    d={smoothLinePath}
                    fill="none"
                    stroke={`url(#${lineGradientId})`}
                    strokeWidth={8}
                    strokeOpacity={0.12}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <Path
                    d={smoothLinePath}
                    fill="none"
                    stroke={`url(#${lineGradientId})`}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              ) : null}
              {points.map((point) => (
                <Circle
                  key={point.season.key}
                  cx={point.x}
                  cy={point.y}
                  r={point.season.key === selectedSeasonKey ? 5 : 3.5}
                  fill={smoothRatingColor(point.rating)}
                  stroke={theme.colors.bg}
                  strokeWidth={2}
                />
              ))}
              {selectedPoint ? (
                <Line
                  x1={selectedPoint.x}
                  y1={padTop}
                  x2={selectedPoint.x}
                  y2={chartHeight - padBottom}
                  stroke={theme.colors.textMuted}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
              ) : null}
            </Svg>
            <Text style={[localStyles.axisLabel, { left: 2, top: padTop - 2 }]}>10</Text>
            <Text style={[localStyles.axisLabel, { left: 6, top: chartHeight - padBottom - 10 }]}>0</Text>
            {points.map((point, index) => {
              const previous = points[index - 1];
              const changedTeams =
                index === 0 ||
                (previous &&
                  (previous.season.team.id || previous.season.team.name) !==
                    (point.season.team.id || point.season.team.name));
              return (
                <View
                  key={`marker-${point.season.key}`}
                  pointerEvents="none"
                  style={[
                    localStyles.careerMarker,
                    {
                      left: point.x - 15,
                      top: point.y - 33,
                      opacity: changedTeams ? 1 : 0,
                      borderColor: theme.colors.borderSoft,
                      backgroundColor: theme.colors.surface,
                    },
                  ]}
                >
                  <Image
                    source={{ uri: point.season.team.logo || FALLBACK_IMAGE_URI }}
                    style={localStyles.careerMarkerLogo}
                  />
                </View>
              );
            })}
            {points.map((point) => (
              <Text
                key={`label-${point.season.key}`}
                style={[
                  localStyles.seasonAxisLabel,
                  {
                    left: point.x - 25,
                    top: chartHeight - padBottom + 12,
                    color: theme.colors.textMuted,
                  },
                ]}
                numberOfLines={1}
              >
                {point.season.label}
              </Text>
            ))}
          </View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

function makeStyles(theme: ThemeTokens, insetTop: number, insetBottom: number) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.bg,
    },
    fixedHeader: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 20,
      height: insetTop + HEADER_HEIGHT,
      paddingTop: insetTop + theme.spacing[10],
      paddingHorizontal: theme.spacing[16],
      backgroundColor: theme.colors.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.borderSoft,
    },
    headerIdentity: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[12],
      marginTop: theme.spacing[6],
    },
    headshot: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: theme.colors.surfaceAlt,
    },
    headerTextBlock: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[8],
    },
    playerName: {
      color: theme.colors.textPrimary,
      fontSize: 24,
      lineHeight: 28,
      fontWeight: "800",
    },
    teamPillRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
    },
    teamPill: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[4],
    },
    teamLogoTiny: {
      width: 16,
      height: 16,
      borderRadius: 8,
    },
    teamPillText: {
      maxWidth: 190,
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
    },
    fixedTabs: {
      position: "absolute",
      top: insetTop + HEADER_HEIGHT,
      left: 0,
      right: 0,
      zIndex: 19,
      minHeight: TAB_BAR_HEIGHT,
      justifyContent: "center",
      backgroundColor: theme.colors.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.borderSoft,
      paddingHorizontal: theme.spacing[16],
    },
    scroll: {
      flex: 1,
    },
    pager: {
      flex: 1,
    },
    content: {
      paddingTop: insetTop + HEADER_HEIGHT + TAB_BAR_HEIGHT + theme.spacing[16],
      paddingHorizontal: theme.spacing[16],
      paddingBottom: Math.max(theme.spacing[32], insetBottom + theme.spacing[24]),
      gap: theme.spacing[12],
    },
    loadingContent: {
      paddingTop: insetTop + theme.spacing[24],
      paddingHorizontal: theme.spacing[16],
      gap: theme.spacing[12],
    },
    flatSection: {
      gap: 0,
    },
    stack: {
      gap: theme.spacing[12],
    },
    matchGroup: {
      marginBottom: theme.spacing[18],
    },
    groupLabel: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "800",
      marginBottom: theme.spacing[4],
    },
    matchRow: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.borderSoft,
      paddingVertical: theme.spacing[10],
    },
    matchRowLast: {
      borderBottomWidth: 0,
    },
    matchDate: {
      width: 48,
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
    },
    matchOpponent: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    matchLogo: {
      width: 24,
      height: 24,
      borderRadius: 12,
    },
    matchOpponentText: {
      flex: 1,
      color: theme.colors.textPrimary,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "700",
    },
    matchScore: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "800",
      minWidth: 44,
      textAlign: "right",
    },
    seasonSelector: {
      height: 42,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing[14],
    },
    seasonSelectorText: {
      color: theme.colors.textPrimary,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
    },
    statsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      rowGap: theme.spacing[18],
    },
    statCell: {
      width: "25%",
      alignItems: "center",
      gap: theme.spacing[4],
    },
    statValue: {
      color: theme.colors.textPrimary,
      fontSize: 18,
      lineHeight: 22,
      fontWeight: "800",
    },
    statLabel: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
    },
    barStack: {
      gap: theme.spacing[14],
    },
    barRow: {
      gap: theme.spacing[8],
    },
    barMeta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    barLabel: {
      color: theme.colors.textPrimary,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "800",
    },
    barValue: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "800",
    },
    barTrack: {
      height: 7,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
      overflow: "hidden",
    },
    barFill: {
      height: "100%",
      borderRadius: theme.radius.pill,
    },
    ratingHeroValue: {
      color: theme.colors.textPrimary,
      fontSize: 44,
      lineHeight: 48,
      fontWeight: "900",
      textAlign: "center",
    },
    ratingHeroLabel: {
      color: theme.colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "800",
      textAlign: "center",
      marginTop: theme.spacing[4],
    },
    liveTrendRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[12],
    },
    liveTrendTitle: {
      color: theme.colors.textPrimary,
      fontSize: 15,
      lineHeight: 19,
      fontWeight: "800",
    },
    liveTrendSub: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      marginTop: theme.spacing[2],
    },
    ratingHistoryRow: {
      minHeight: 54,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.borderSoft,
      paddingVertical: theme.spacing[10],
    },
    ratingOpponent: {
      flex: 1,
      color: theme.colors.textPrimary,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "700",
    },
    emptyText: {
      color: theme.colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "700",
      textAlign: "center",
      paddingVertical: theme.spacing[24],
    },
    careerSelectedRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[12],
      marginTop: theme.spacing[14],
    },
    careerSelectedCopy: {
      flex: 1,
      minWidth: 0,
    },
    careerSelectedTitle: {
      color: theme.colors.textPrimary,
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
    },
    careerSelectedMeta: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      marginTop: theme.spacing[2],
    },
    careerRow: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.borderSoft,
      paddingVertical: theme.spacing[10],
    },
    careerTeamCopy: {
      flex: 1,
      minWidth: 0,
    },
    careerMeta: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      marginTop: theme.spacing[2],
    },
    apexRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[12],
    },
    apexCopy: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[6],
    },
    apexLabel: {
      color: theme.colors.textPrimary,
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
    },
    apexSubLabel: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
    },
    rankTag: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[4],
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.accent,
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[2],
    },
    rankTagText: {
      color: theme.colors.bg,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "900",
    },
    splitHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingBottom: theme.spacing[8],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.borderSoft,
    },
    splitBodyRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: theme.spacing[10],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.borderSoft,
    },
    splitLabelCol: {
      flex: 1,
      minWidth: 0,
      textAlign: "left",
    },
    splitCell: {
      width: 44,
      textAlign: "center",
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "700",
    },
    splitCellLabel: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
    },
    splitCellValue: {
      color: theme.colors.textPrimary,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "800",
    },
    impactRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    impactCell: {
      flex: 1,
      alignItems: "center",
      gap: theme.spacing[2],
    },
    impactDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: "stretch",
      backgroundColor: theme.colors.borderSoft,
    },
    impactValue: {
      color: theme.colors.textPrimary,
      fontSize: 26,
      lineHeight: 30,
      fontWeight: "900",
    },
    impactLabel: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "800",
    },
    impactMeta: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
    },
    highValue: {
      width: 48,
      color: theme.colors.textPrimary,
      fontSize: 20,
      lineHeight: 24,
      fontWeight: "900",
    },
    highMeta: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      marginTop: theme.spacing[2],
    },
    dropdownCard: {
      marginTop: theme.spacing[8],
    },
    dropdownRow: {
      paddingVertical: theme.spacing[10],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.borderSoft,
    },
    dropdownRowText: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "700",
    },
    dropdownRowTextActive: {
      color: theme.colors.textPrimary,
      fontWeight: "900",
    },
    dropdownRowMeta: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      marginTop: theme.spacing[2],
    },
    gameLogOpponentCopy: {
      flex: 1,
      minWidth: 0,
    },
    gameLogLine: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "700",
      marginTop: theme.spacing[2],
    },
    careerHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingBottom: theme.spacing[8],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.borderSoft,
    },
    careerSeasonCol: {
      flex: 1,
      minWidth: 0,
    },
    careerTableRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: theme.spacing[10],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.borderSoft,
      borderRadius: theme.radius.md,
    },
    careerTableRowActive: {
      backgroundColor: theme.colors.surfaceAlt,
    },
    careerSeasonCell: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    careerTeamLogo: {
      width: 20,
      height: 20,
      borderRadius: 10,
    },
    careerSeasonText: {
      flex: 1,
      color: theme.colors.textPrimary,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "800",
    },
    timeline: {
      gap: 0,
    },
    timelineRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    timelineMarkerColumn: {
      width: 14,
      alignItems: "center",
      alignSelf: "stretch",
    },
    timelineDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      marginTop: theme.spacing[18],
      backgroundColor: theme.colors.accent,
    },
    timelineLine: {
      flex: 1,
      width: 2,
      backgroundColor: theme.colors.borderSoft,
    },
    timelineCopy: {
      flex: 1,
      minWidth: 0,
      paddingVertical: theme.spacing[12],
    },
  });
}

const localStyles = StyleSheet.create({
  ratingPill: {
    minWidth: 42,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: "center",
  },
  ratingPillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
  },
  infoGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  infoItem: {
    flex: 1,
    alignItems: "center",
    minWidth: 0,
    gap: 6,
  },
  infoValueRow: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  infoValue: {
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "900",
    textAlign: "center",
  },
  aboutText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
  },
  inactiveTag: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "rgba(255,196,0,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,196,0,0.4)",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  inactiveTagText: {
    color: "#FFC400",
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  infoLabel: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  flag: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  axisLabel: {
    position: "absolute",
    color: "rgba(255,255,255,0.52)",
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
  },
  seasonAxisLabel: {
    position: "absolute",
    width: 50,
    textAlign: "center",
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "700",
  },
  careerMarker: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  careerMarkerLogo: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
});
