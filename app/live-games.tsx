import FontAwesome from "@expo/vector-icons/FontAwesome";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { GlassView } from "expo-glass-effect";
import {
  addDays,
  format,
  parse,
  startOfDay,
} from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  FlatList,
  GestureResponderEvent,
  LayoutChangeEvent,
  Modal,
  NativeSyntheticEvent,
  Image,
  NativeTouchEvent,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TabView, type Route } from "react-native-tab-view";

import ApiSetupScreen from "@/components/ApiSetupScreen";
import ConferenceFilterBar from "@/components/ConferenceFilterBar";
import TrackedBetControls from "@/components/betting/TrackedBetControls";
import TrackedBetSummaryCard from "@/components/betting/TrackedBetSummaryCard";
import AppLoader from "@/components/loading/AppLoader";
import ScreenErrorState from "@/components/loading/ScreenErrorState";
import GlassPillButton from "@/components/GlassPillButton";
import CalendarModal from "@/components/home/CalendarModal";
import HeaderMenuButton from "@/components/home/HeaderMenuButton";
import LiveStatusDot from "@/components/home/LiveStatusDot";
import PlayerModal from "@/components/PlayerModal";
import TeamLogoLink from "@/components/TeamLogoLink";
import Card from "@/components/ui/Card";
import BaseballLiveStatePill from "@/components/ui/BaseballLiveStatePill";
import Pill from "@/components/ui/Pill";
import SectionHeader from "@/components/ui/SectionHeader";
import TabBar, { type TabItem } from "@/components/ui/TabBar";
import TopPlayerRow from "@/components/ui/TopPlayerRow";
import {
  buildLiveGameDataFromPayload,
  type LiveGameData,
  type LiveGamePlayer,
  useLiveGame,
} from "@/hooks/useLiveGame";
import {
  API_SETUP_COMMANDS,
  API_SETUP_MESSAGE,
  checkApiHealth as checkApiHealthOnce,
  getApiBaseUrl,
  isLanHttpUrl,
} from "@/src/config/api";
import {
  useLoading,
  useScreenLoading,
} from "@/src/loading/LoadingContext";
import { readResourceCache, writeResourceCache } from "@/src/loading/resourceCache";
import { buildScreenKey } from "@/src/loading/loadingUtils";
import {
  useConferenceFilter,
} from "@/src/conferences/ConferenceFilterContext";
import {
  deriveConferenceFromGame,
  deriveConferencesFromGame,
  getConferenceOptionsFromGames,
} from "@/src/conferences/conferenceFilterUtils";
import { ALL_CONFERENCE_OPTION } from "@/src/conferences/conferenceCatalog";
import {
  ALL_CONFERENCE_KEY,
  type ConferenceOption,
} from "@/src/conferences/conferenceFilterTypes";
import {
  fetchGamesForDate,
  fetchLiveGamePayload,
  type LiveGameListItem,
} from "@/src/features/basketball/api";
import { stashPendingGameSeed } from "@/src/loading/pendingGameSeed";
import { fetchTopMarketEv } from "@/src/features/betting/api";
import { findOddsEventForGame } from "@/src/features/betting/eventMatching";
import {
  buildTrackedBetCandidateFromTopMarketEv,
  buildTrackedBetGameSnapshotFromListItem,
  buildTrackedBetKey,
} from "@/src/features/betting/trackedBets";
import type { BettingGame, TopMarketEvItem } from "@/src/features/betting/types";
import { useGameMode } from "@/src/mode/GameModeContext";
import type { GameMode } from "@/src/mode/gameModeTypes";
import { useMultiView } from "@/src/multiview/MultiViewContext";
import { useProfile } from "@/src/profile/ProfileContext";
import type { FavoriteGameSelection } from "@/src/profile/profileTypes";
import { useSettingsState } from "@/src/settings/SettingsContext";
import type { ThemeTokens } from "@/src/theme/tokens";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { getResolvedDefaultInGameTab } from "@/src/ui/inGameTabs";
import { PRO_BASKETBALL_LABEL } from "@/src/features/nba/proBasketballLeague";
import { AppScreen } from "@/src/ui/components";
import {
  useGameCardOrigin,
  type GameCardFrame,
} from "@/src/navigation/GameCardOriginContext";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const SPORTS_DAY_CUTOFF_HOUR = 4;
const CARD_TAP_MOVEMENT_THRESHOLD = 12;
const DATE_SLIDER_PAST_DAYS = 21;
const DATE_SLIDER_FUTURE_DAYS = 45;
const MATCH_GAMES_CACHE_TTL_MS = 1000 * 60 * 2;
const TOP_EDGE_CACHE_TTL_MS = 1000 * 60;
const PRO_EV_MODAL_SECTION_KEY = "ProEvModal";
const TOP_EDGE_PREFS_STORAGE_KEY = "@boston-game/top-edge-prefs";
type ConferenceRoute = Route & { title: string };
type TopEdgeSort = "proEv" | "fairProb";

type TopEdgePrefs = {
  sortBy: TopEdgeSort;
};

type ResolvedTopEdgeTarget = {
  gameId: string;
  targetMode: GameMode;
};

type MatchViewMode = "normal" | "leaderboard";
type MatchListGroup = {
  key: string;
  label: string;
  shortLabel: string;
  games: LiveGameListItem[];
};

type LeaderboardPlayerEntry = {
  gameId: string;
  player: LiveGamePlayer;
  teamColor?: string | null;
  teamPrimaryColor?: string | null;
  gameState?: string;
};

const TOP_EDGE_TEAM_ALIAS_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bhawai i\b/g, "hawaii"],
  [/\bhawai\b/g, "hawaii"],
  [/\bole miss\b/g, "mississippi"],
  [/\buconn\b/g, "connecticut"],
  [/\bunc\b/g, "north carolina"],
  [/\bumkc\b/g, "kansas city"],
  [/\bse louisiana\b/g, "southeastern louisiana"],
  [/\bucf\b/g, "central florida"],
  [/\bunlv\b/g, "nevada las vegas"],
  [/\bbyu\b/g, "brigham young"],
  [/\blsu\b/g, "louisiana state"],
  [/\bcal state\b/g, "csu"],
  [/\bcsu\b/g, "cal state"],
  [/\bcal baptist\b/g, "california baptist"],
  [/\bst johns\b/g, "saint johns"],
  [/\bst marys\b/g, "saint marys"],
  [/\bst thomas\b/g, "saint thomas"],
  [/\bstate\b/g, "st"],
];

const NBA_TEAM_NAME_SET = new Set(
  [
    "atlanta hawks",
    "boston celtics",
    "brooklyn nets",
    "charlotte hornets",
    "chicago bulls",
    "cleveland cavaliers",
    "dallas mavericks",
    "denver nuggets",
    "detroit pistons",
    "golden state warriors",
    "houston rockets",
    "indiana pacers",
    "la clippers",
    "los angeles clippers",
    "los angeles lakers",
    "memphis grizzlies",
    "miami heat",
    "milwaukee bucks",
    "minnesota timberwolves",
    "new orleans pelicans",
    "new york knicks",
    "oklahoma city thunder",
    "orlando magic",
    "philadelphia 76ers",
    "phoenix suns",
    "portland trail blazers",
    "sacramento kings",
    "san antonio spurs",
    "toronto raptors",
    "utah jazz",
    "washington wizards",
  ].map((team) => team.trim()),
);

function toDateKeyLocal(date: Date): string {
  return format(startOfDay(date), "yyyy-MM-dd");
}

function getDefaultSelectedDateKey(): string {
  const now = new Date();
  return now.getHours() < SPORTS_DAY_CUTOFF_HOUR
    ? toDateKeyLocal(addDays(now, -1))
    : toDateKeyLocal(now);
}

function getDateRail(
  selectedDateKey: string,
): Array<{ key: string; label: string; secondaryLabel: string }> {
  const selectedDate = parse(selectedDateKey, "yyyy-MM-dd", new Date());
  const todayKey = getDefaultSelectedDateKey();

  return Array.from(
    { length: DATE_SLIDER_PAST_DAYS + DATE_SLIDER_FUTURE_DAYS + 1 },
    (_, index) => {
      const offset = index - DATE_SLIDER_PAST_DAYS;
      const date = addDays(selectedDate, offset);
      const key = toDateKeyLocal(date);
      return {
        key,
        label: key === todayKey ? "Today" : format(date, "MMM d"),
        secondaryLabel: format(date, "EEE"),
      };
    },
  );
}

function sortPlayersForLeaderboard(
  left: LeaderboardPlayerEntry,
  right: LeaderboardPlayerEntry,
): number {
  const leftRating = left.player.inGameRating10 ?? -1;
  const rightRating = right.player.inGameRating10 ?? -1;
  if (leftRating !== rightRating) {
    return rightRating - leftRating;
  }
  return right.player.points - left.player.points;
}

function buildLeaderboardEntriesFromGameData(
  data: LiveGameData,
  gameId: string,
): LeaderboardPlayerEntry[] {
  const teamPrimaryColorById = new Map<string, string | null>();
  const teamSecondaryColorById = new Map<string, string | null>();

  data.teams.forEach((team) => {
    teamPrimaryColorById.set(team.id, team.color || team.alternateColor || null);
    teamSecondaryColorById.set(team.id, team.alternateColor || team.color || null);
  });

  return Object.values(data.playersByTeam)
    .flat()
    .filter(
      (player) =>
        typeof player.inGameRating10 === "number" &&
        Number.isFinite(player.inGameRating10),
    )
    .map((player) => ({
      gameId,
      player,
      teamColor: teamSecondaryColorById.get(player.teamId) ?? null,
      teamPrimaryColor: teamPrimaryColorById.get(player.teamId) ?? null,
      gameState: data.status.state,
    }));
}

function isLeaderboardEntryLive(entry: LeaderboardPlayerEntry): boolean {
  return entry.gameState !== "post";
}

function statusTone(status: string): "live" | "success" | "warning" {
  const s = status.toLowerCase();
  if (s.includes("live") || s.includes("in progress")) return "live";
  if (s.includes("final")) return "success";
  return "warning";
}

function getMatchViewStatusFill(status: string): string {
  const tone = statusTone(status);
  if (tone === "live") return "#3B82F6";
  if (tone === "success") return "#22A06B";
  if (tone === "warning") return "#C98A1A";
  return "#000000";
}

function formatMatchCardStatusText(
  game: Pick<LiveGameListItem, "statusText" | "isLive">,
): string {
  const raw = String(game.statusText ?? "").trim();
  if (!raw) {
    return "Scheduled";
  }

  const normalized = raw.toLowerCase();
  if (game.isLive || normalized.includes("final")) {
    return raw;
  }

  const timeMatch = raw.match(
    /\b\d{1,2}:\d{2}\s*(?:[AP]\.?M\.?)?/i,
  );
  if (timeMatch?.[0]) {
    return timeMatch[0].replace(/\./g, "").replace(/\s+/g, " ").trim();
  }

  return raw;
}

function getMatchCardTeamName(team: LiveGameListItem["home"]): string {
  return team.shortDisplayName?.trim() || team.abbreviation?.trim() || team.name;
}

function modeLabel(mode: GameMode): string {
  if (mode === "nba") return PRO_BASKETBALL_LABEL;
  if (mode === "baseball") return "College Baseball";
  return "College Basketball";
}

function formatFavoriteStartDate(startDateTime?: string): string {
  if (!startDateTime) {
    return "";
  }
  const parsed = new Date(startDateTime);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type GamePhase = "scheduled" | "live" | "final";

function getGamePhase(game: Pick<LiveGameListItem, "isLive" | "statusText">): GamePhase {
  if (/final/i.test(String(game.statusText ?? ""))) {
    return "final";
  }
  return game.isLive ? "live" : "scheduled";
}

function toOrdinal(value: number): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value}st`;
  if (mod10 === 2 && mod100 !== 12) return `${value}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${value}rd`;
  return `${value}th`;
}

function formatPeriodLabel(period: number, sport?: "basketball" | "baseball"): string {
  if (sport === "baseball" || !Number.isFinite(period) || period <= 0) {
    return "";
  }
  if (period <= 4) {
    return toOrdinal(period);
  }
  const overtime = period - 4;
  return overtime === 1 ? "OT" : `${overtime}OT`;
}

// Live clock + quarter/half, e.g. "6:30 - 3rd".
function formatLiveClockLabel(game: LiveGameListItem): string {
  const clock = String(game.clock ?? "").trim();
  const periodLabel = formatPeriodLabel(game.period, game.sport);
  if (clock && periodLabel) {
    return `${clock} - ${periodLabel}`;
  }
  return clock || periodLabel || String(game.statusText ?? "").trim();
}

function parseScoreValue(score: string | undefined): number | null {
  const parsed = Number.parseInt(String(score ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function gameLiveRank(game: LiveGameListItem): number {
  const status = String(game.statusText ?? "").toLowerCase();
  const isCurrentlyPlaying =
    game.isLive &&
    (status.includes("in progress") ||
      /\bq[1-4]\b/.test(status) ||
      status.includes("quarter") ||
      status.includes("halftime") ||
      status.includes("ot") ||
      status.includes("inning"));
  if (isCurrentlyPlaying) return 0;
  if (game.isLive) return 1;
  return 2;
}

function shouldOpenGameOnPreview(game: Pick<LiveGameListItem, "isLive" | "statusText">): boolean {
  const status = String(game.statusText ?? "").trim().toLowerCase();

  if (game.isLive) {
    return false;
  }

  if (
    status.includes("final") ||
    status.includes("postponed") ||
    status.includes("canceled") ||
    status.includes("cancelled") ||
    status.includes("suspended")
  ) {
    return false;
  }

  return true;
}

function sortGamesForMatchView(games: LiveGameListItem[]): LiveGameListItem[] {
  return [...games].sort((a, b) => gameLiveRank(a) - gameLiveRank(b));
}

function formatEvPercent(value: number | undefined): string {
  if (!Number.isFinite(value)) return "-";
  const n = Number(value);
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function formatFairProb(value: number | undefined): string {
  if (!Number.isFinite(value)) return "Fair win probability -";
  return `Fair win probability ${(Number(value) * 100).toFixed(1)}%`;
}

function sanitizeTopEdgePrefs(value: unknown): TopEdgePrefs {
  const raw = (value ?? {}) as Partial<TopEdgePrefs>;
  return {
    sortBy: raw.sortBy === "fairProb" ? "fairProb" : "proEv",
  };
}

function formatOdds(value: number | undefined): string {
  if (!Number.isFinite(value)) return "-";
  const n = Number(value);
  return n > 0 ? `+${n}` : `${n}`;
}

function formatLinePoint(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }
  const n = Number(value);
  return ` ${n > 0 ? "+" : ""}${n}`;
}

function buildConferenceBuckets(
  games: LiveGameListItem[],
  options: ConferenceOption[],
  mode: GameMode,
): Record<string, LiveGameListItem[]> {
  const optionKeys = new Set(options.map((option) => option.key));
  const buckets = Object.fromEntries(
    options.map((option) => [option.key, [] as LiveGameListItem[]]),
  ) as Record<string, LiveGameListItem[]>;

  games.forEach((game) => {
    if (optionKeys.has(ALL_CONFERENCE_KEY)) {
      buckets[ALL_CONFERENCE_KEY].push(game);
    }

    const derivedKeys = new Set(
      deriveConferencesFromGame(game, mode)
        .map((conference) => conference.key)
        .filter((key) => key !== ALL_CONFERENCE_KEY && optionKeys.has(key)),
    );

    derivedKeys.forEach((conferenceKey) => {
      buckets[conferenceKey].push(game);
    });
  });

  return buckets;
}

function buildMatchListGroups(
  games: LiveGameListItem[],
  activeConferenceKey: string,
  activeConferenceLabel: string | undefined,
  mode: GameMode,
): MatchListGroup[] {
  if (games.length === 0) {
    return [];
  }

  if (activeConferenceKey !== ALL_CONFERENCE_KEY) {
    const label = activeConferenceLabel || modeLabel(mode);
    return [
      {
        key: activeConferenceKey,
        label,
        shortLabel: label,
        games,
      },
    ];
  }

  const groups = new Map<string, MatchListGroup>();
  games.forEach((game) => {
    const conference = deriveConferenceFromGame(game, mode);
    const existing = groups.get(conference.key);
    if (existing) {
      existing.games.push(game);
      return;
    }
    groups.set(conference.key, {
      key: conference.key,
      label: conference.label,
      shortLabel: conference.label,
      games: [game],
    });
  });

  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function getConferenceBadgeLabel(label: string): string {
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "A";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

function resolveTopEdgeDateKey(
  commenceTime: string | undefined,
  fallbackDateKey: string,
): string {
  if (!commenceTime) {
    return fallbackDateKey;
  }

  const parsed = new Date(commenceTime);
  if (Number.isNaN(parsed.getTime())) {
    return fallbackDateKey;
  }

  return toDateKeyLocal(parsed);
}

function getTopEdgeDateCandidates(
  commenceTime: string | undefined,
  fallbackDateKey: string,
): string[] {
  const keys = new Set<string>([fallbackDateKey]);
  const baseDateKey = resolveTopEdgeDateKey(commenceTime, fallbackDateKey);
  keys.add(baseDateKey);

  const parsed = parse(baseDateKey, "yyyy-MM-dd", new Date());
  if (!Number.isNaN(parsed.getTime())) {
    keys.add(toDateKeyLocal(addDays(parsed, -1)));
    keys.add(toDateKeyLocal(addDays(parsed, 1)));
  }

  return [...keys];
}

function getTopEdgeTeams(
  row: Pick<TopMarketEvItem, "event" | "homeTeam" | "awayTeam">,
): {
  homeTeam?: string;
  awayTeam?: string;
} {
  if (row.homeTeam || row.awayTeam) {
    return {
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
    };
  }

  const [awayTeam, homeTeam] = String(row.event ?? "")
    .split("@")
    .map((part) => part.trim())
    .filter(Boolean);

  return { homeTeam, awayTeam };
}

function normalizeTopEdgeTeamName(value: string | undefined): string {
  const initial = (value ?? "")
    .toLowerCase()
    .replace(/#[0-9]+/g, "")
    .replace(/[â€™']/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(university|college)\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!initial) {
    return "";
  }

  return TOP_EDGE_TEAM_ALIAS_REPLACEMENTS.reduce((current, [pattern, replacement]) => {
    return current.replace(pattern, replacement).replace(/\s+/g, " ").trim();
  }, initial);
}

function buildNormalizedMatchupKey(
  awayTeam: string | undefined,
  homeTeam: string | undefined,
): string {
  const away = normalizeTopEdgeTeamName(awayTeam);
  const home = normalizeTopEdgeTeamName(homeTeam);
  if (!away || !home) {
    return "";
  }
  return `${away} @ ${home}`;
}

function isKnownNbaTeamName(value: string | undefined): boolean {
  const normalized = normalizeTopEdgeTeamName(value);
  return normalized.length > 0 && NBA_TEAM_NAME_SET.has(normalized);
}

function resolveTopEdgeMode(
  row: Pick<TopMarketEvItem, "sportKey" | "homeTeam" | "awayTeam" | "event">,
): GameMode {
  const { homeTeam, awayTeam } = getTopEdgeTeams(row);
  if (isKnownNbaTeamName(homeTeam) || isKnownNbaTeamName(awayTeam)) {
    return "nba";
  }

  return row.sportKey === "basketball_nba" ? "nba" : "college";
}

function getTopEdgeRowKey(row: TopMarketEvItem): string {
  return `${row.eventId}-${row.book}-${row.marketLabel}-${row.side}-${row.linePoint ?? "na"}`;
}

function scoreTopEdgeTeamMatch(left: string | undefined, right: string | undefined): number {
  const normalizedLeft = normalizeTopEdgeTeamName(left);
  const normalizedRight = normalizeTopEdgeTeamName(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 100;
  }

  if (
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ) {
    return 84;
  }

  const leftTokens = new Set(normalizedLeft.split(" ").filter(Boolean));
  const rightTokens = new Set(normalizedRight.split(" ").filter(Boolean));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token));

  if (overlap.length >= 2) {
    return 70 + overlap.length * 6;
  }

  if (overlap.length === 1 && overlap[0] && overlap[0].length >= 4) {
    return 60;
  }

  return 0;
}

function scoreTopEdgeStartTime(
  game: LiveGameListItem,
  commenceTime: string | undefined,
): number {
  if (!commenceTime) {
    return 0;
  }

  const target = Date.parse(commenceTime);
  if (!Number.isFinite(target)) {
    return 0;
  }

  const gameStatus = game.statusText.trim();
  if (/live|final|halftime|qtr|quarter|ot|in progress/i.test(gameStatus)) {
    return 12;
  }

  const match = gameStatus.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) {
    return 0;
  }

  const parsed = parse(
    `${resolveTopEdgeDateKey(commenceTime, getDefaultSelectedDateKey())} ${match[1]}:${match[2]} ${match[3].toUpperCase()}`,
    "yyyy-MM-dd h:mm a",
    new Date(),
  );
  const gameTime = parsed.getTime();
  if (Number.isNaN(gameTime)) {
    return 0;
  }

  const diffHours = Math.abs(gameTime - target) / (1000 * 60 * 60);
  if (diffHours <= 0.5) return 18;
  if (diffHours <= 2) return 12;
  if (diffHours <= 6) return 6;
  return 0;
}

function findBestLiveGameMatch(
  games: LiveGameListItem[],
  row: TopMarketEvItem,
): LiveGameListItem | null {
  const { homeTeam, awayTeam } = getTopEdgeTeams(row);
  if (!homeTeam || !awayTeam) {
    return null;
  }

  let bestMatch: { game: LiveGameListItem; score: number } | null = null;

  for (const game of games) {
    const directScore =
      scoreTopEdgeTeamMatch(homeTeam, game.home.name) +
      scoreTopEdgeTeamMatch(awayTeam, game.away.name) +
      scoreTopEdgeStartTime(game, row.commenceTime);
    const reversedScore =
      scoreTopEdgeTeamMatch(homeTeam, game.away.name) +
      scoreTopEdgeTeamMatch(awayTeam, game.home.name) +
      scoreTopEdgeStartTime(game, row.commenceTime) -
      4;
    const score = Math.max(directScore, reversedScore);

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { game, score };
    }
  }

  if (!bestMatch || bestMatch.score < 108) {
    return null;
  }
  return bestMatch.game;
}

function findExactLiveGameMatch(
  games: LiveGameListItem[],
  row: TopMarketEvItem,
): LiveGameListItem | null {
  const { homeTeam, awayTeam } = getTopEdgeTeams(row);
  const targetKey = buildNormalizedMatchupKey(awayTeam, homeTeam);
  if (!targetKey) {
    return null;
  }

  return (
    games.find(
      (game) =>
        buildNormalizedMatchupKey(game.away.name, game.home.name) === targetKey,
    ) ?? null
  );
}

function mapLiveGameToBettingGame(
  game: LiveGameListItem,
  sportKey: string | undefined,
): BettingGame {
  return {
    eventId: game.gameId,
    sportKey: sportKey ?? "basketball_ncaab",
    homeTeam: game.home.name,
    awayTeam: game.away.name,
  };
}

function MatchGameCardPressable({
  onNavigate,
  children,
  originGameId,
  originSource,
}: {
  onNavigate: () => void;
  children: React.ReactNode;
  originGameId?: string;
  originSource?: "live-games-card";
}) {
  const { setGameCardFrame, activateGameCardOrigin } = useGameCardOrigin();
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const movedTooFarRef = useRef(false);
  const cardRef = useRef<View | null>(null);

  const measureCardFrame = useCallback(
    (shouldActivateOrigin: boolean, afterMeasure?: () => void) => {
      if (
        !originGameId ||
        originSource !== "live-games-card" ||
        !cardRef.current ||
        typeof cardRef.current.measureInWindow !== "function"
      ) {
        afterMeasure?.();
        return;
      }

      requestAnimationFrame(() => {
        cardRef.current?.measureInWindow((x, y, width, height) => {
          if (width > 0 && height > 0) {
            const frame: GameCardFrame = { x, y, width, height };
            setGameCardFrame(originGameId, frame);
            if (shouldActivateOrigin) {
              activateGameCardOrigin(originGameId, originSource, frame);
            }
          }
          afterMeasure?.();
        });
      });
    },
    [activateGameCardOrigin, originGameId, originSource, setGameCardFrame],
  );

  return (
    <Pressable
      ref={cardRef}
      onLayout={() => {
        measureCardFrame(false);
      }}
      onPressIn={(event: GestureResponderEvent) => {
        pressStartRef.current = {
          x: event.nativeEvent.pageX,
          y: event.nativeEvent.pageY,
        };
        movedTooFarRef.current = false;
      }}
      onTouchMove={(event: NativeSyntheticEvent<NativeTouchEvent>) => {
        if (!pressStartRef.current || movedTooFarRef.current) {
          return;
        }

        const deltaX = Math.abs(event.nativeEvent.pageX - pressStartRef.current.x);
        const deltaY = Math.abs(event.nativeEvent.pageY - pressStartRef.current.y);
        if (
          deltaX > CARD_TAP_MOVEMENT_THRESHOLD ||
          deltaY > CARD_TAP_MOVEMENT_THRESHOLD
        ) {
          movedTooFarRef.current = true;
        }
      }}
      onPress={() => {
        if (!movedTooFarRef.current) {
          measureCardFrame(true, onNavigate);
        }
      }}
      onPressOut={() => {
        pressStartRef.current = null;
        movedTooFarRef.current = false;
      }}
    >
      {children}
    </Pressable>
  );
}

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      position: "relative",
      backgroundColor: theme.colors.bg,
    },
    headerOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 20,
      elevation: 20,
    },
    // Solid black behind the header's own content (logo/Live/menu/date row).
    // Height is set inline to the header's measured height.
    headerSolidBlack: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: "#000000",
    },
    // Fade-to-transparent strip directly below the header — see its JSX
    // usage. `top`/`height` set inline (top = headerHeight).
    headerFadeGradient: {
      position: "absolute",
      left: 0,
      right: 0,
    },
    floatingLayer: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 40,
      elevation: 40,
    },
    headerTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    brandLogo: {
      // Fixed dimensions so the logo never stretches when placed in a flex row.
      width: 120,
      height: 38,
    },
    headerArea: {
      paddingHorizontal: theme.spacing[8],
      // No paddingBottom — the date row is the last thing in this column in
      // the common case, and the gradient/list start exactly at
      // headerHeight (this view's own measured height), so any trailing
      // padding here becomes dead solid-black space between the date row
      // and the list before the fade even starts.
      gap: theme.spacing[4],
    },
    body: {
      flex: 1,
      minHeight: 0,
    },
    content: {
      paddingHorizontal: theme.spacing[8],
      paddingBottom: theme.spacing[32] + 64,
    },
    sceneContent: {
      paddingHorizontal: theme.spacing[8],
      paddingBottom: theme.spacing[32] + 64,
      paddingTop: theme.spacing[2],
      flexGrow: 1,
    },
    iconRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.glass,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.24,
      shadowRadius: 14,
      elevation: 6,
    },
    headerMenuOverlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 25,
      elevation: 25,
    },
    headerMenuBackdrop: {
      flex: 1,
    },
    headerMenuWrap: {
      position: "absolute",
      top: theme.spacing[18],
      right: theme.spacing[8],
    },
    headerMenuCard: {
      minWidth: 160,
      borderRadius: theme.radius.lg,
      paddingVertical: theme.spacing[4],
      overflow: "hidden",
    },
    headerMenuItem: {
      minHeight: 40,
      paddingHorizontal: theme.spacing[10],
      alignItems: "flex-start",
      justifyContent: "center",
    },
    headerMenuItemText: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "600",
      color: theme.colors.textPrimary,
    },
    headerMenuItemTextMuted: {
      color: theme.colors.textMuted,
    },
    headerMenuDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.borderSoft,
      marginHorizontal: theme.spacing[10],
    },
    iconBtnActive: {
      borderColor: theme.colors.accentStrong,
      backgroundColor: theme.colors.glassStrong,
    },
    liveBtn: {
      height: 40,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
      paddingHorizontal: theme.spacing[12],
      borderRadius: theme.radius.pill,
      overflow: "hidden",
      // Same glass treatment as the hamburger button (subtle border + faint
      // base tint); the GlassView/fallback below provides the frosted fill.
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.18)",
      backgroundColor: "rgba(255,255,255,0.06)",
    },
    liveBtnGlassMask: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.pill,
      overflow: "hidden",
    },
    liveBtnGlass: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.pill,
      overflow: "hidden",
    },
    liveBtnFallbackGlass: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.pill,
      backgroundColor: "rgba(255,255,255,0.14)",
    },
    liveBtnOn: {
      borderColor: "rgba(34,197,94,0.5)",
      backgroundColor: "rgba(34,197,94,0.08)",
    },
    liveBtnText: {
      fontSize: 13,
      lineHeight: 16,
      fontWeight: "800",
      letterSpacing: 0.2,
      color: "#FFFFFF",
    },
    jumpTodayWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      alignItems: "center",
      zIndex: 30,
      elevation: 30,
    },
    jumpTodayButton: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 14,
      elevation: 8,
    },
    jumpTodayContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
    },
    jumpTodayText: {
      fontSize: 13,
      lineHeight: 16,
      fontWeight: "800",
      letterSpacing: 0.2,
      color: theme.colors.textPrimary,
    },
    dateSliderWrap: {
      marginHorizontal: -theme.spacing[8],
      paddingHorizontal: theme.spacing[8],
      marginTop: -theme.spacing[2],
      // Cancels TWO stacked sources of dead space below the visible date
      // pills, both confirmed by measuring actual rendered boxes: TabBar's
      // own `paddingVertical` on its wrapping View (6px — see
      // components/ui/TabBar.tsx), PLUS the date pills' own touch-target
      // padding (~11px — `tabChip`'s `minHeight` in TabBar.tsx makes the
      // pill's real box taller than its label text, for tap-target sizing).
      // Landing headerHeight (and thus the fade gradient's top / the list's
      // paddingTop) at the pill's true visual bottom, not ~17px below it.
      // Safe to reach slightly past the touch-target box: the fade gradient
      // this feeds into starts fully opaque black (see headerFadeGradient),
      // so a few pixels of overlap into the pill's own invisible padding is
      // indistinguishable from the solid backdrop everything already sits
      // on — there's no partial-opacity band there for it to cut into.
      marginBottom: -theme.spacing[18],
    },
    selectorWrap: {
      marginTop: -theme.spacing[20],
      paddingTop: 0,
      paddingBottom: 0,
    },
    previewCardPressable: {
      borderRadius: theme.radius.lg,
    },
    previewHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: theme.spacing[8],
      marginBottom: theme.spacing[8],
    },
    previewTitleWrap: {
      flex: 1,
      gap: theme.spacing[2],
    },
    previewTitle: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    previewSubtitle: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
    previewStack: {
      gap: theme.spacing[8],
    },
    topEdgeToggle: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[8],
      marginBottom: theme.spacing[8],
    },
    topEdgeToggleRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    topEdgeChevron: {
      fontSize: 18,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textSecondary,
      minWidth: 16,
      textAlign: "center",
    },
    topEdgeFilterRow: {
      flexDirection: "row",
      gap: theme.spacing[8],
      marginBottom: theme.spacing[10],
    },
    topEdgeFilterChip: {
      flex: 1,
      minHeight: 40,
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: "transparent",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spacing[10],
    },
    topEdgeFilterChipActive: {
      borderColor: theme.colors.borderSoft,
      backgroundColor: "transparent",
    },
    topEdgeFilterText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textMuted,
      textAlign: "center",
    },
    topEdgeFilterTextActive: {
      color: "#FFFFFF",
    },
    previewRow: {
      borderRadius: theme.radius.lg,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[10],
      gap: theme.spacing[4],
    },
    previewRowTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: theme.spacing[8],
    },
    previewEvent: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    previewMeta: {
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
    previewHint: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textSecondary,
    },
    gameGridRow: {
      gap: theme.spacing[8],
    },
    gameGridItem: {
      flex: 1,
      marginBottom: theme.spacing[8],
    },
    groupBlock: {
      marginBottom: theme.spacing[12],
    },
    leaderboardFooter: {
      marginTop: theme.spacing[8],
      marginBottom: theme.spacing[12],
    },
    leaderboardFooterCard: {
      gap: theme.spacing[10],
    },
    leaderboardRows: {
      gap: theme.spacing[10],
    },
    groupHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing[12],
      paddingVertical: theme.spacing[12],
    },
    groupHeaderPressed: {
      opacity: theme.opacity.pressed,
    },
    groupHeaderLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
      flex: 1,
      minWidth: 0,
    },
    groupBadge: {
      width: 24,
      height: 24,
      borderRadius: theme.radius.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
    },
    groupBadgeText: {
      fontSize: 10,
      lineHeight: 12,
      fontWeight: "800",
      letterSpacing: 0.3,
      color: theme.colors.textPrimary,
    },
    groupTitle: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      flex: 1,
    },
    groupGamesWrap: {
      paddingHorizontal: theme.spacing[12],
      paddingBottom: theme.spacing[8],
    },
    // Used when the games list is the sole content of the card (no
    // collapsible header above it, e.g. WNBA) so the first row still gets
    // breathing room from the card's top edge.
    groupGamesWrapStandalone: {
      paddingTop: theme.spacing[12],
    },
    groupRowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.borderSoft,
      marginVertical: theme.spacing[4],
    },
    matchCardBody: {
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[8],
    },
    fotmobRow: {
      position: "relative",
      flexDirection: "row",
      alignItems: "center",
      minHeight: 50,
      paddingVertical: theme.spacing[8],
    },
    // Score/time layer centered over the whole row so it sits dead-center on
    // screen regardless of team-name width.
    fotmobCenter: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
    },
    // Live/final status pinned to the left edge (overlay, out of flow) so it
    // doesn't push the centered score off-center.
    statusIndicatorOverlay: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[4],
    },
    statusIndicatorWrap: {
      width: 68,
      alignItems: "flex-start",
      gap: theme.spacing[4],
      flexShrink: 0,
    },
    // Right-side counterweight to statusIndicatorWrap so the center score/time
    // column lands at the true horizontal center of the card/screen.
    statusIndicatorSpacer: {
      width: 68,
      flexShrink: 0,
    },
    statusIndicatorDot: {
      width: 9,
      height: 9,
      borderRadius: theme.radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    statusIndicatorPulse: {
      position: "absolute",
      width: 17,
      height: 17,
      borderRadius: theme.radius.pill,
      backgroundColor: "rgba(34,197,94,0.22)",
    },
    statusIndicatorText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      textAlign: "left",
    },
    fotmobTeamSlot: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
      minWidth: 0,
    },
    fotmobAwaySlot: {
      justifyContent: "flex-end",
      // Reserve the center zone for the pinned score/time so names never
      // underlap it.
      paddingRight: theme.spacing[48],
    },
    fotmobHomeSlot: {
      justifyContent: "flex-start",
      paddingLeft: theme.spacing[48],
    },
    // +10% (was 20x20) — team logos across the schedule list.
    fotmobLogo: {
      width: 22,
      height: 22,
    },
    fotmobLogoLose: {
      opacity: 0.4,
    },
    fotmobTeamName: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "500",
      color: theme.colors.textPrimary,
      flexShrink: 1,
    },
    fotmobTeamNameAway: {
      textAlign: "right",
    },
    fotmobTeamNameHome: {
      textAlign: "left",
    },
    fotmobScore: {
      minWidth: 72,
      textAlign: "center",
      fontSize: 20,
      lineHeight: 24,
      fontWeight: "600",
      letterSpacing: 0.3,
      fontVariant: ["tabular-nums"],
      color: theme.colors.textPrimary,
    },
    // Pre-game tip-off time ("7:30 PM") — deliberately its OWN (smaller) style
    // rather than reusing fotmobScore: that style is sized for the actual
    // in-progress/final score digits, which should stay prominent, while the
    // scheduled time is secondary information and reads better sized closer
    // to the team names next to it.
    fotmobScheduledTime: {
      minWidth: 72,
      textAlign: "center",
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "600",
      letterSpacing: 0.2,
      fontVariant: ["tabular-nums"],
      color: theme.colors.textMuted,
    },
    fotmobScoreWin: {
      color: theme.colors.textPrimary,
      fontWeight: "700",
    },
    fotmobScoreLose: {
      color: theme.colors.textMuted,
      fontWeight: "600",
    },
    fotmobTeamNameLose: {
      color: theme.colors.textMuted,
    },
    fotmobScoreSep: {
      color: theme.colors.textMuted,
      fontWeight: "600",
    },
    baseballGroupMetaRow: {
      paddingBottom: theme.spacing[8],
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[6],
    },
    matchRowHead: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: theme.spacing[4],
      gap: theme.spacing[6],
    },
    matchMeta: {
      flex: 1,
      fontSize: 10,
      lineHeight: 12,
      fontWeight: "700",
      letterSpacing: 0.1,
      color: theme.colors.textMuted,
      textAlign: "right",
    },
    matchMetaCompact: {
      flex: 1,
      fontSize: 9,
      lineHeight: 11,
      fontWeight: "700",
      color: theme.colors.textMuted,
      textAlign: "right",
    },
    spacer: {
      height: theme.spacing[10],
    },
    rowHead: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: theme.spacing[8],
      gap: theme.spacing[8],
    },
    meta: {
      flex: 1,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      letterSpacing: 0.2,
      color: theme.colors.textMuted,
      textAlign: "right",
    },
    metaCompact: {
      flex: 1,
      fontSize: 10,
      lineHeight: 13,
      fontWeight: "700",
      color: theme.colors.textMuted,
      textAlign: "right",
    },
    matchupRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[4],
      minWidth: 0,
    },
    teamSlot: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[4],
      minWidth: 0,
    },
    teamSlotHome: {
      justifyContent: "flex-end",
    },
    teamSlotAway: {
      justifyContent: "flex-start",
    },
    teamRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: theme.spacing[4],
    },
    teamCell: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
      flex: 1,
      minWidth: 0,
    },
    teamNameWrap: {
      flex: 1,
      minWidth: 0,
    },
    logo: {
      width: 22,
      height: 22,
    },
    // +10% (was 18x18) — kept in sync with fotmobLogo for consistency.
    matchLogo: {
      width: 20,
      height: 20,
    },
    teamName: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "700",
      color: theme.colors.textPrimary,
      flex: 1,
    },
    matchTeamName: {
      fontSize: 12,
      lineHeight: 15,
      fontWeight: "700",
      color: theme.colors.textPrimary,
      flex: 1,
    },
    teamNameHome: {
      textAlign: "right",
    },
    teamNameAway: {
      textAlign: "left",
    },
    matchTeamNameHome: {
      textAlign: "right",
    },
    matchTeamNameAway: {
      textAlign: "left",
    },
    homeMarker: {
      fontSize: 10,
      lineHeight: 12,
      fontWeight: "700",
      color: theme.colors.textMuted,
      marginTop: theme.spacing[2],
    },
    score: {
      fontSize: 24,
      lineHeight: 26,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      minWidth: 72,
      textAlign: "center",
    },
    matchScore: {
      fontSize: 18,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      minWidth: 58,
      textAlign: "center",
    },
    // Losing team on a completed game (grid card): dim name + score.
    matchTeamNameLose: {
      color: theme.colors.textMuted,
    },
    matchScoreLose: {
      color: theme.colors.textMuted,
    },
    baseballMetaRow: {
      marginTop: theme.spacing[6],
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[6],
    },
    empty: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textSecondary,
      textAlign: "center",
    },
    emptySubtext: {
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "500",
      color: theme.colors.textMuted,
      textAlign: "center",
    },
    emptyStateCard: {
      alignItems: "center",
      gap: theme.spacing[8],
    },
    emptyRetryButton: {
      marginTop: theme.spacing[2],
      paddingHorizontal: theme.spacing[12],
      paddingVertical: theme.spacing[8],
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.hairline,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceAlt,
    },
    emptyRetryText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textPrimary,
    },
    errorText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.danger,
    },
    evRowHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: theme.spacing[8],
      marginBottom: theme.spacing[6],
    },
    evTitleWrap: {
      flex: 1,
      gap: theme.spacing[2],
    },
    evEvent: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    evSubtitle: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    evDetails: {
      gap: theme.spacing[2],
    },
    evDetailText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textSecondary,
    },
    pager: {
      flex: 1,
      minHeight: 0,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.72)",
      justifyContent: "center",
      alignItems: "center",
    },
    modalSheetWrap: {
      paddingHorizontal: theme.spacing[8],
      paddingBottom: theme.spacing[12],
      width: "100%",
      alignItems: "center",
    },
    modalSheet: {
      width: "100%",
      maxWidth: 560,
      maxHeight: "72%",
      borderRadius: theme.radius.xl,
      overflow: "hidden",
    },
    modalHeader: {
      paddingHorizontal: theme.spacing[16],
      paddingTop: theme.spacing[14],
      paddingBottom: theme.spacing[10],
      borderBottomWidth: theme.borderWidth.hairline,
      borderBottomColor: theme.colors.borderSoft,
      gap: theme.spacing[4],
    },
    modalTitle: {
      fontSize: 18,
      lineHeight: 22,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    modalSubtitle: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
    modalListContent: {
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[12],
      paddingBottom: theme.spacing[20],
    },
    modalSummaryWrap: {
      paddingHorizontal: theme.spacing[8],
      paddingTop: theme.spacing[10],
    },
  });
}

export default function LiveGamesScreen() {
  const params = useLocalSearchParams<{
    mode?: string | string[];
    favorites?: string | string[];
    navToken?: string | string[];
  }>();
  const needsManualApiSetup = !getApiBaseUrl();
  const { setGameId } = useLiveGame();
  const { mode, setMode } = useGameMode();
  const { setLastEntrySource } = useMultiView();
  const {
    state: profileState,
    toggleTrackedBet,
    updateTrackedBetStake,
    setTrackedBetResult,
    syncTrackedBetsFromSnapshots,
  } = useProfile();
  const { state: settingsState } = useSettingsState();
  const { state: conferenceState, setSelectedConference } =
    useConferenceFilter();
  const { startTask, endTask, clearScreenTasks } = useLoading();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useWindowDimensions();
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [headerHeight, setHeaderHeight] = useState(0);
  // Header background is just solid black behind the logo/Live/menu/date
  // content (measured via headerHeight, already tracked below), plus a
  // short LinearGradient fading black -> transparent right underneath it so
  // the list dissolves into black as it scrolls under the date row instead
  // of being cut off by a hard edge. No blur, no measured sub-zones — an
  // earlier version split the header into a blurred transition zone
  // concentrated at the date row, which kept producing a visible seam where
  // the blur's own bounds ended (a moving list edge crossing a blur
  // boundary reads as a seam no matter how the tint around it is tuned).
  // This is deliberately simpler: one flat color, one small gradient.
  const HEADER_FADE_HEIGHT = 36;
  const [games, setGames] = useState<LiveGameListItem[]>([]);
  // Which date `games` actually holds data for. `games` is shared/global
  // (one array for whichever date is "active"), but updating it happens
  // async (loadGames resolves after the render that flips a route to
  // active) — see renderDateScene's isActiveRoute branch, which used to
  // trust `games` unconditionally the instant a route became active, even
  // for the one render where it still held the PREVIOUS date's rows. That's
  // the swipe-completion flicker: cached-correct data during the drag ->
  // stale `games` the instant the new route becomes active -> corrected
  // once loadGames resolves. Comparing against this key lets that branch
  // fall back to the same cache read a non-active route already uses
  // whenever `games` hasn't caught up yet, closing the gap entirely.
  const [gamesDateKey, setGamesDateKey] = useState<string | null>(null);
  const [collapsedMatchGroups, setCollapsedMatchGroups] = useState<Record<string, boolean>>({});
  const [topEvRows, setTopEvRows] = useState<TopMarketEvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [evLoading, setEvLoading] = useState(false);
  const [evError, setEvError] = useState<string | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState(
    getDefaultSelectedDateKey,
  );
  const [healthStatus, setHealthStatus] = useState<"idle" | "ok" | "fail">(
    "idle",
  );
  const [healthErrorMessage, setHealthErrorMessage] = useState<string | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [isProEvModalOpen, setIsProEvModalOpen] = useState(false);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [matchViewMode, setMatchViewMode] = useState<MatchViewMode>("normal");
  // Live-only filter (applies on Today; remembered per the requirement so it
  // restores when navigating back to Today).
  const [liveFilterOn, setLiveFilterOn] = useState(false);
  const [leaderboardPlayers, setLeaderboardPlayers] = useState<
    LeaderboardPlayerEntry[]
  >([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [selectedLeaderboardPlayer, setSelectedLeaderboardPlayer] =
    useState<LiveGamePlayer | null>(null);
  const [isLeaderboardPlayerModalOpen, setIsLeaderboardPlayerModalOpen] =
    useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [topEdgeSort, setTopEdgeSort] = useState<TopEdgeSort>("proEv");
  const [topEdgePrefsHydrated, setTopEdgePrefsHydrated] = useState(false);
  const [topEdgeTargets, setTopEdgeTargets] = useState<
    Record<string, ResolvedTopEdgeTarget>
  >({});
  const [activeConferenceKey, setActiveConferenceKey] = useState<string>(
    ALL_CONFERENCE_KEY,
  );
  const dateRailAnchorRef = useRef(getDefaultSelectedDateKey());
  // Game counts for each date in the rail window, keyed by date key. Populated
  // by the effect below so the date slider can skip days with zero games.
  // Undefined = not checked yet (not "known empty") — see filteredDateRail.
  const [dateGameCounts, setDateGameCounts] = useState<Record<string, number>>({});
  const topEdgeGamesCacheRef = useRef<Map<string, LiveGameListItem[]>>(new Map());
  const leaderboardGameCacheRef = useRef<Map<string, LiveGameData>>(new Map());
  const leaderboardRosterCacheRef = useRef<Map<string, LiveGamePlayer[]>>(
    new Map(),
  );
  const leaderboardLogoCacheRef = useRef<Map<string, string>>(new Map());
  const leaderboardSeasonInputCacheRef = useRef(new Map());
  const leaderboardSeasonPowerCacheRef = useRef(new Map());
  // Broadcast/sync delay for the cross-game leaderboard: hold freshly-computed
  // rankings for the configured number of seconds before committing them, so
  // this surface never renders live ratings ahead of a delayed stream. Held in
  // refs so the loader's identity stays stable across delay/data changes.
  const liveDataDelayRef = useRef(settingsState.inGame.liveDataDelaySeconds);
  const leaderboardDelayTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const leaderboardHasDataRef = useRef(false);
  useEffect(() => {
    liveDataDelayRef.current = settingsState.inGame.liveDataDelaySeconds;
  }, [settingsState.inGame.liveDataDelaySeconds]);
  useEffect(() => {
    return () => {
      leaderboardDelayTimersRef.current.forEach((timer) => clearTimeout(timer));
      leaderboardDelayTimersRef.current = [];
    };
  }, []);
  const routeModeParam = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const routeFavoritesParam = Array.isArray(params.favorites)
    ? params.favorites[0]
    : params.favorites;
  const routeNavToken = Array.isArray(params.navToken)
    ? params.navToken[0]
    : params.navToken;
  const screenKey = useMemo(
    () => buildScreenKey("live-games", { date: selectedDateKey, mode }),
    [mode, selectedDateKey],
  );
  const screenLoading = useScreenLoading(screenKey);
  const showTopEdge = mode !== "baseball";
  const todayKey = getDefaultSelectedDateKey();
  const isToday = selectedDateKey === todayKey;
  const applyLiveFilter = isToday && liveFilterOn;
  const liveGameCount = useMemo(
    () => games.filter((game) => game.isLive).length,
    [games],
  );
  const onLivePress = useCallback(() => {
    if (!isToday) {
      setSelectedDateKey(todayKey);
      setLiveFilterOn(true);
      return;
    }
    setLiveFilterOn((current) => !current);
  }, [isToday, todayKey]);

  useEffect(() => {
    if (
      routeModeParam === "college" ||
      routeModeParam === "nba" ||
      routeModeParam === "baseball"
    ) {
      setMode(routeModeParam);
    }
  }, [routeModeParam, setMode]);

  useEffect(() => {
    if (routeFavoritesParam === "1") {
      setShowFavoritesOnly(true);
      return;
    }
    if (routeFavoritesParam === "0") {
      setShowFavoritesOnly(false);
    }
  }, [routeFavoritesParam]);

  useEffect(() => {
    if (!routeNavToken) {
      return;
    }
    setSelectedDateKey(getDefaultSelectedDateKey());
    setActiveConferenceKey(ALL_CONFERENCE_KEY);
    setGames([]);
    setGamesDateKey(null);
    setTopEvRows([]);
    setError(null);
    setEvError(null);
    setLoading(true);
    setEvLoading(false);
  }, [routeNavToken]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setMatchViewMode("normal");
        setIsHeaderMenuOpen(false);
        setLeaderboardPlayers([]);
        setLeaderboardError(null);
        setLeaderboardLoading(false);
        setSelectedLeaderboardPlayer(null);
        setIsLeaderboardPlayerModalOpen(false);
      };
    }, []),
  );

  useEffect(() => {
    setIsHeaderMenuOpen(false);
  }, [matchViewMode, mode, selectedDateKey, showFavoritesOnly]);

  useEffect(() => {
    if (!showFavoritesOnly) {
      return;
    }
    setMatchViewMode("normal");
    setLeaderboardPlayers([]);
    setLeaderboardError(null);
    setLeaderboardLoading(false);
  }, [showFavoritesOnly]);

  useEffect(() => {
    if (matchViewMode === "leaderboard") {
      return;
    }
    setSelectedLeaderboardPlayer(null);
    setIsLeaderboardPlayerModalOpen(false);
  }, [matchViewMode]);

  const defaultInGameRoute = useMemo(
    () => getResolvedDefaultInGameTab(settingsState, mode).route,
    [mode, settingsState],
  );

  const conferenceOptions = useMemo(
    () => {
      if (mode === "nba") {
        return [ALL_CONFERENCE_OPTION];
      }
      return getConferenceOptionsFromGames(
        games,
        conferenceState.selectedConferenceKey,
        conferenceState.selectedConferenceLabel,
        mode,
      );
    },
    [
      conferenceState.selectedConferenceKey,
      conferenceState.selectedConferenceLabel,
      games,
      mode,
    ],
  );

  const conferenceBuckets = useMemo(
    () => buildConferenceBuckets(games, conferenceOptions, mode),
    [conferenceOptions, games, mode],
  );

  const filteredTopEvRows = useMemo(() => {
    const rankedRows = [...topEvRows].sort(
      (left, right) =>
        topEdgeSort === "fairProb"
          ? (right.fairProb ?? Number.NEGATIVE_INFINITY) -
            (left.fairProb ?? Number.NEGATIVE_INFINITY)
          : right.edgePct - left.edgePct,
    );
    return rankedRows;
  }, [topEdgeSort, topEvRows]);
  const trackedBetByKey = useMemo(
    () => new Map(profileState.trackedBets.map((bet) => [bet.key, bet])),
    [profileState.trackedBets],
  );
  const topEvEntries = useMemo(
    () =>
      filteredTopEvRows.map((row) => {
        const target = topEdgeTargets[getTopEdgeRowKey(row)];
        return {
          row,
          candidate: buildTrackedBetCandidateFromTopMarketEv(row, {
            gameId: target?.gameId,
            mode: target?.targetMode,
            fallbackMode: mode,
          }),
        };
      }),
    [filteredTopEvRows, mode, topEdgeTargets],
  );
  const visibleTrackedTopEvBets = useMemo(
    () =>
      topEvEntries
        .map((entry) =>
          entry.candidate ? trackedBetByKey.get(buildTrackedBetKey(entry.candidate)) : null,
        )
        .filter((bet): bet is NonNullable<typeof bet> => Boolean(bet)),
    [topEvEntries, trackedBetByKey],
  );
  const checkApiHealth = useCallback(async () => {
    const result = await checkApiHealthOnce(getApiBaseUrl(), 12000);
    setHealthStatus(result.ok ? "ok" : "fail");
    if (!result.ok) {
      const reason = result.error ?? "API unreachable";
      const tunnelHint = isLanHttpUrl(result.baseUrl)
        ? " Make sure your phone is on the same Wi-Fi as your computer and try `npm run dev:mobile`, or use `npm run dev:mobile:tunnel`."
        : "";
      setHealthErrorMessage(
        `Could not reach API at ${result.baseUrl ?? "unset"}. ${reason}.${tunnelHint}`,
      );
      return;
    }
    setHealthErrorMessage(null);
  }, []);

  const loadGames = useCallback(
    async (
      dateKey: string,
      currentScreenKey: string,
      options?: { forceRefresh?: boolean; cancelled?: () => boolean },
    ) => {
      const cacheKey = `match-games:${mode}:${dateKey}`;
      if (!options?.forceRefresh) {
        const cachedGames = readResourceCache<LiveGameListItem[]>(
          cacheKey,
          MATCH_GAMES_CACHE_TTL_MS,
        );
        if (cachedGames) {
          const sortedCachedGames = sortGamesForMatchView(cachedGames);
          if (!options?.cancelled?.()) {
            setGames(sortedCachedGames);
            setGamesDateKey(dateKey);
            setError(null);
            setLoading(false);
          }
          return sortedCachedGames;
        }
      }

      const taskInput = {
        screenKey: currentScreenKey,
        tier: "critical" as const,
        taskId: `games:${dateKey}`,
      };
      startTask(taskInput);

      try {
        const rows = sortGamesForMatchView(await fetchGamesForDate(mode, dateKey));
        writeResourceCache(cacheKey, rows);
        if (!options?.cancelled?.()) {
          setGames(rows);
          setGamesDateKey(dateKey);
          setError(null);
        }
        return rows;
      } catch (err) {
        if (!options?.cancelled?.()) {
          setError(err instanceof Error ? err.message : "Failed to load games.");
        }
        throw err;
      } finally {
        if (!options?.cancelled?.()) {
          setLoading(false);
        }
        endTask(taskInput);
      }
    },
    [endTask, mode, startTask],
  );

  const loadTopEv = useCallback(
    async (
      dateKey: string,
      currentScreenKey: string,
      sectionKey: string,
      options?: { forceRefresh?: boolean; cancelled?: () => boolean },
    ) => {
      if (mode === "baseball") {
        if (!options?.cancelled?.()) {
          setTopEvRows([]);
          setEvError(null);
          setEvLoading(false);
        }
        return [];
      }
      const cacheKey = `top-ev:all-basketball:${dateKey}:${topEdgeSort}`;
      if (!options?.forceRefresh) {
        const cachedEdges = readResourceCache<TopMarketEvItem[]>(
          cacheKey,
          TOP_EDGE_CACHE_TTL_MS,
        );
        if (cachedEdges) {
          if (!options?.cancelled?.()) {
            setTopEvRows(cachedEdges);
            setEvError(null);
            setEvLoading(false);
          }
          return cachedEdges;
        }
      }

      const taskInput = {
        screenKey: currentScreenKey,
        sectionKey,
        tier: "non_critical" as const,
        taskId: `${sectionKey}:${dateKey}`,
      };
      startTask(taskInput);
      if (!options?.cancelled?.()) {
        setEvLoading(true);
      }

      try {
        const rows = await fetchTopMarketEv(dateKey, undefined, {
          forceRefresh: options?.forceRefresh,
          sortBy: topEdgeSort,
          limit: 10,
        });
        writeResourceCache(cacheKey, rows);
        if (!options?.cancelled?.()) {
          setTopEvRows(rows);
          setEvError(null);
        }
        return rows;
      } catch (err) {
        if (!options?.cancelled?.()) {
          setEvError(
            err instanceof Error
              ? err.message
              : "Failed to load highest Pro EV bets.",
          );
        }
        throw err;
      } finally {
        if (!options?.cancelled?.()) {
          setEvLoading(false);
        }
        endTask(taskInput);
      }
    },
    [endTask, mode, startTask, topEdgeSort],
  );

  useEffect(() => {
    void checkApiHealth();
  }, [checkApiHealth]);

  useEffect(() => {
    let active = true;

    void AsyncStorage.getItem(TOP_EDGE_PREFS_STORAGE_KEY).then((raw) => {
      if (!active) {
        return;
      }

      if (raw) {
        try {
          const prefs = sanitizeTopEdgePrefs(JSON.parse(raw));
          setTopEdgeSort(prefs.sortBy);
        } catch {
          setTopEdgeSort("proEv");
        }
      }

      setTopEdgePrefsHydrated(true);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!topEdgePrefsHydrated) {
      return;
    }

    const payload = JSON.stringify({
      sortBy: topEdgeSort,
    } satisfies TopEdgePrefs);
    void AsyncStorage.setItem(TOP_EDGE_PREFS_STORAGE_KEY, payload);
  }, [topEdgePrefsHydrated, topEdgeSort]);

  useEffect(() => {
    if (
      conferenceState.selectedConferenceKey === ALL_CONFERENCE_KEY &&
      conferenceState.selectedConferenceLabel === "All"
    ) {
      return;
    }
    setSelectedConference({ key: ALL_CONFERENCE_KEY, label: "All" });
  }, [
    conferenceState.selectedConferenceKey,
    conferenceState.selectedConferenceLabel,
    mode,
    setSelectedConference,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (healthStatus !== "ok") {
      setLoading(false);
      setEvLoading(false);
      return;
    }
    setLoading(true);
    void loadGames(selectedDateKey, screenKey, {
      cancelled: () => cancelled,
    })
      .catch(() => {});

    return () => {
      cancelled = true;
      clearScreenTasks(screenKey);
    };
  }, [
    clearScreenTasks,
    healthStatus,
    loadGames,
    loadTopEv,
    screenKey,
    selectedDateKey,
  ]);

  // Force-refresh the games list whenever the Home Screen regains focus
  // (e.g. swiping back out of a game) — otherwise `loadGames`' own 2-minute
  // resource cache (see MATCH_GAMES_CACHE_TTL_MS) could still be "fresh" by
  // its own TTL and just re-serve whatever scores were current when the user
  // left, even though a live game they were just watching has since moved
  // on. Skips the very first focus (the initial mount already triggers its
  // own load via the effect above) so this doesn't double-fetch on open.
  const hasFocusedHomeScreenRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedHomeScreenRef.current) {
        hasFocusedHomeScreenRef.current = true;
        return;
      }
      void loadGames(selectedDateKey, screenKey, { forceRefresh: true }).catch(() => {});
    }, [loadGames, screenKey, selectedDateKey]),
  );

  useEffect(() => {
    let cancelled = false;
    if (healthStatus !== "ok" || !isProEvModalOpen) {
      return;
    }
    void loadTopEv(selectedDateKey, screenKey, PRO_EV_MODAL_SECTION_KEY, {
      cancelled: () => cancelled,
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [healthStatus, isProEvModalOpen, loadTopEv, screenKey, selectedDateKey]);

  useEffect(() => {
    if (conferenceOptions.length === 0) {
      return;
    }
    const nextActiveOption =
      conferenceOptions.find((option) => option.key === activeConferenceKey) ??
      conferenceOptions[0];

    if (!nextActiveOption) {
      return;
    }

    if (nextActiveOption.key !== activeConferenceKey) {
      setActiveConferenceKey(nextActiveOption.key);
    }

    if (
      nextActiveOption.key !== conferenceState.selectedConferenceKey ||
      nextActiveOption.label !== conferenceState.selectedConferenceLabel
    ) {
      setSelectedConference(nextActiveOption);
    }
  }, [
    activeConferenceKey,
    conferenceOptions,
    conferenceState.selectedConferenceKey,
    conferenceState.selectedConferenceLabel,
    setSelectedConference,
  ]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await checkApiHealth();
      await loadGames(selectedDateKey, screenKey, {
        forceRefresh: true,
      }).catch(() => []);
      if (isProEvModalOpen) {
        await loadTopEv(
          selectedDateKey,
          screenKey,
          PRO_EV_MODAL_SECTION_KEY,
          { forceRefresh: true },
        ).catch(() => []);
      }
      if (!showFavoritesOnly) {
        selectedConferenceGames.forEach((game) => {
          leaderboardGameCacheRef.current.delete(`${mode}:${game.gameId}`);
        });
        await loadLeaderboardPlayers(selectedConferenceGames, {
          forceRefresh: true,
        }).catch(() => []);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const formattedDateLabel = format(
    parse(selectedDateKey, "yyyy-MM-dd", new Date()),
    "MMM d",
  );
  // Full, unfiltered candidate window (every calendar day, past + future).
  // This never shrinks — it's the source list we check for game counts and
  // filter down from below. Kept separate from the rendered rail so
  // filteredDateRail can grow back if e.g. mode changes and a previously-
  // empty date turns out to have games in the new mode.
  const dateRail = useMemo(
    () => getDateRail(dateRailAnchorRef.current),
    [],
  );

  // Fetch a game count for every not-yet-checked date in the window whenever
  // the candidate list or sport mode changes. Counts are mode-scoped (a date
  // can have college games but no NBA games, etc.) and reuse the same
  // resource cache `loadGames` writes to, so dates the user has actually
  // visited resolve instantly instead of re-fetching.
  useEffect(() => {
    let cancelled = false;
    const datesToCheck = dateRail
      .map((item) => item.key)
      .filter((key) => dateGameCounts[`${mode}:${key}`] === undefined);

    if (datesToCheck.length === 0) {
      return;
    }

    void Promise.allSettled(
      datesToCheck.map(async (dateKey) => {
        const cacheKey = `match-games:${mode}:${dateKey}`;
        const cached = readResourceCache<LiveGameListItem[]>(
          cacheKey,
          MATCH_GAMES_CACHE_TTL_MS,
        );
        if (cached) {
          return { dateKey, count: cached.length };
        }
        const rows = await fetchGamesForDate(mode, dateKey);
        writeResourceCache(cacheKey, rows);
        return { dateKey, count: rows.length };
      }),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      setDateGameCounts((current) => {
        const next = { ...current };
        results.forEach((result) => {
          if (result.status === "fulfilled") {
            next[`${mode}:${result.value.dateKey}`] = result.value.count;
          }
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [dateRail, mode, dateGameCounts]);

  // Dedicated, high-priority prefetch for the two dates immediately adjacent
  // to the selected one — the ones a swipe-left/swipe-right actually lands
  // on. The broad sweep above eventually covers the whole
  // DATE_SLIDER_PAST_DAYS..DATE_SLIDER_FUTURE_DAYS rail (67 dates), but it
  // fires all of them in one Promise.allSettled batch with no priority
  // ordering — "tomorrow" competes equally with a date 45 days out, so
  // there's no guarantee the very next/previous day resolves before the user
  // actually swipes there, especially if they swipe soon after the screen
  // loads. This fires immediately whenever the selected date (or mode)
  // changes, asking for just those two dates so they get their own fetch
  // calls right away instead of waiting their turn in the wide batch.
  // renderDateScene reads straight from the same resource cache this writes
  // to, so once this resolves the adjacent scene has real data with zero
  // loading state to show during the swipe itself.
  useEffect(() => {
    let cancelled = false;
    const selectedDate = parse(selectedDateKey, "yyyy-MM-dd", new Date());
    const adjacentDateKeys = [
      toDateKeyLocal(addDays(selectedDate, -1)),
      toDateKeyLocal(addDays(selectedDate, 1)),
    ];

    void Promise.allSettled(
      adjacentDateKeys.map(async (dateKey) => {
        const cacheKey = `match-games:${mode}:${dateKey}`;
        const cached = readResourceCache<LiveGameListItem[]>(
          cacheKey,
          MATCH_GAMES_CACHE_TTL_MS,
        );
        if (cached) {
          return { dateKey, count: cached.length };
        }
        const rows = await fetchGamesForDate(mode, dateKey);
        writeResourceCache(cacheKey, rows);
        return { dateKey, count: rows.length };
      }),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      setDateGameCounts((current) => {
        const next = { ...current };
        let changed = false;
        results.forEach((result) => {
          if (result.status === "fulfilled") {
            const key = `${mode}:${result.value.dateKey}`;
            if (next[key] !== result.value.count) {
              next[key] = result.value.count;
              changed = true;
            }
          }
        });
        return changed ? next : current;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [mode, selectedDateKey]);

  // The rendered rail: every date EXCEPT ones confirmed to have zero games,
  // plus the selected date unconditionally.
  //
  // Deliberately "hide once confirmed empty," not "show once confirmed
  // populated" — that inversion used to be the whole bug. Game counts for
  // the ~67-day rail resolve via one Promise.allSettled batch (see the
  // effect above), so on the very first render, before that batch settles,
  // NO date's count is known yet. Under the old "only show confirmed
  // non-empty dates" rule, that meant dateRail filtered down to just the
  // ONE unconditionally-included selected date — a 1-item dateRoutes array —
  // and the instant the batch resolved, it jumped straight to its full ~45
  // items in a single render, with TabView's controlled navigationState.index
  // jumping right along with it (observed: 0 -> 16). A routes array
  // reshaping AND its index jumping a long distance in the same render is
  // exactly the kind of change react-native-tab-view's pager doesn't
  // reliably follow — it rendered page 0 instead of jumping to the new
  // index, which is why the app opened on whatever date ended up first in
  // the array (weeks in the past) instead of today.
  //
  // Showing every date until it's PROVEN empty keeps dateRail/dateRoutes at
  // its full, stable shape from the first render (today already sits at its
  // real position, e.g. index 21, immediately) — it only ever shrinks
  // gradually afterward as individual dates get confirmed empty and drop
  // out, never growing in one destabilizing jump.
  const filteredDateRail = useMemo(
    () =>
      dateRail.filter((item) => {
        if (item.key === selectedDateKey) {
          return true;
        }
        const count = dateGameCounts[`${mode}:${item.key}`];
        return typeof count !== "number" || count > 0;
      }),
    [dateRail, dateGameCounts, mode, selectedDateKey],
  );
  const dateRoutes = useMemo<ConferenceRoute[]>(
    () =>
      filteredDateRail.map((item) => ({
        key: item.key,
        title: item.label,
      })),
    [filteredDateRail],
  );
  const selectedDateIndex = useMemo(
    () => dateRoutes.findIndex((route) => route.key === selectedDateKey),
    [dateRoutes, selectedDateKey],
  );
  const dateTabItems = useMemo<TabItem[]>(
    () =>
      filteredDateRail.map((item) => ({
        key: item.key,
        label: item.label,
        secondaryLabel: item.secondaryLabel,
        onPress: () => setSelectedDateKey(item.key),
      })),
    [filteredDateRail],
  );
  // Nearest date (today or later) confirmed to have games, for the "Jump to
  // Today" button — if today itself has none, land on the next date that
  // does rather than jumping to a day the rail doesn't even show. Falls back
  // to today while counts are still resolving.
  const nextDateKeyWithGames = useMemo(() => {
    const todayIndex = dateRail.findIndex((item) => item.key === todayKey);
    if (todayIndex === -1) {
      return todayKey;
    }
    for (let index = todayIndex; index < dateRail.length; index += 1) {
      const key = dateRail[index].key;
      const count = dateGameCounts[`${mode}:${key}`];
      if (typeof count === "number" && count > 0) {
        return key;
      }
    }
    return todayKey;
  }, [dateRail, dateGameCounts, mode, todayKey]);
  const activeConferenceOption = useMemo(
    () =>
      conferenceOptions.find((option) => option.key === activeConferenceKey) ??
      conferenceOptions[0] ??
      null,
    [activeConferenceKey, conferenceOptions],
  );
  const selectedConferenceGames = useMemo(
    () => conferenceBuckets[activeConferenceKey] ?? [],
    [activeConferenceKey, conferenceBuckets],
  );
  const leaderboardTopPlayerKey = leaderboardPlayers[0]
    ? `${leaderboardPlayers[0].gameId}:${leaderboardPlayers[0].player.id}`
    : null;
  const headerMenuLabel =
    showFavoritesOnly || matchViewMode === "leaderboard"
      ? "Normal"
      : "Leaderboard";
  const loadLeaderboardPlayers = useCallback(
    async (
      slateGames: LiveGameListItem[],
      options?: { forceRefresh?: boolean; cancelled?: () => boolean },
    ) => {
      if (showFavoritesOnly) {
        if (!options?.cancelled?.()) {
          setLeaderboardLoading(false);
        }
        return [];
      }

      if (!options?.cancelled?.()) {
        setLeaderboardError(null);
        // Only show the spinner (and blank the list) when there is nothing on
        // screen yet. If a leaderboard is already visible, keep it until the
        // delay-buffered commit replaces it, so we don't flash empty/spinner or
        // render ahead of a delayed broadcast.
        if (!leaderboardHasDataRef.current) {
          setLeaderboardLoading(true);
          setLeaderboardPlayers([]);
        }
      }

      if (slateGames.length === 0) {
        if (!options?.cancelled?.()) {
          leaderboardHasDataRef.current = false;
          setLeaderboardPlayers([]);
          setLeaderboardLoading(false);
        }
        return [];
      }

      // getApiBaseUrl() is the single source of truth for the API base URL
      // (local/tunnel EXPO_PUBLIC_API_MODE toggle) — this used to fall back
      // to a hardcoded LAN IP whenever getApiBaseUrl() returned falsy,
      // silently ignoring tunnel mode instead of surfacing the same
      // "API not configured" state the rest of the screen already handles.
      const apiBase = getApiBaseUrl();
      if (!apiBase) {
        if (!options?.cancelled?.()) {
          leaderboardHasDataRef.current = false;
          setLeaderboardPlayers([]);
          setLeaderboardError(API_SETUP_MESSAGE);
          setLeaderboardLoading(false);
        }
        return [];
      }
      const results = await Promise.allSettled(
        slateGames.map(async (game) => {
          const cacheKey = `${mode}:${game.gameId}`;
          if (options?.forceRefresh) {
            leaderboardGameCacheRef.current.delete(cacheKey);
          }

          let data = leaderboardGameCacheRef.current.get(cacheKey);
          if (!data) {
            const payload = await fetchLiveGamePayload(mode, game.gameId);
            const built = await buildLiveGameDataFromPayload({
              apiBase,
              gameId: game.gameId,
              mode,
              payload,
              rosterCache: leaderboardRosterCacheRef.current,
              logoCache: leaderboardLogoCacheRef.current,
              seasonInputCache: leaderboardSeasonInputCacheRef.current as never,
              seasonPowerCache: leaderboardSeasonPowerCacheRef.current as never,
            });

            if (built.status !== "ok") {
              throw new Error(built.message);
            }

            data = built.data;
            leaderboardGameCacheRef.current.set(cacheKey, data);
          }

          return buildLeaderboardEntriesFromGameData(data, game.gameId);
        }),
      );

      if (options?.cancelled?.()) {
        return [];
      }

      const nextPlayers = results
        .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
        .sort(sortPlayersForLeaderboard);
      const firstError = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      const commit = () => {
        if (options?.cancelled?.()) {
          return;
        }
        setLeaderboardPlayers(nextPlayers);
        leaderboardHasDataRef.current = nextPlayers.length > 0;
        setLeaderboardError(
          nextPlayers.length === 0 && firstError
            ? firstError.reason instanceof Error
              ? firstError.reason.message
              : "Failed to load leaderboard."
            : null,
        );
        setLeaderboardLoading(false);
      };

      // Hold the freshly-computed rankings for the configured delay before
      // showing them, mirroring the main live-game provider's publish buffer.
      const delaySeconds = liveDataDelayRef.current;
      if (delaySeconds > 0) {
        const timer = setTimeout(() => {
          leaderboardDelayTimersRef.current = leaderboardDelayTimersRef.current.filter(
            (item) => item !== timer,
          );
          commit();
        }, delaySeconds * 1000);
        leaderboardDelayTimersRef.current.push(timer);
      } else {
        commit();
      }

      return nextPlayers;
    },
    [mode, showFavoritesOnly],
  );
  const getTopEdgeGamesForDate = useCallback(
    async (targetMode: GameMode, dateKey: string) => {
      const mapKey = `${targetMode}:${dateKey}`;
      if (targetMode === mode && dateKey === selectedDateKey && games.length > 0) {
        topEdgeGamesCacheRef.current.set(mapKey, games);
        return games;
      }

      const cachedGames = topEdgeGamesCacheRef.current.get(mapKey);
      if (cachedGames) {
        return cachedGames;
      }

      const resourceKey = `match-games:${targetMode}:${dateKey}`;
      const resourceGames = readResourceCache<LiveGameListItem[]>(
        resourceKey,
        MATCH_GAMES_CACHE_TTL_MS,
      );
      if (resourceGames) {
        topEdgeGamesCacheRef.current.set(mapKey, resourceGames);
        return resourceGames;
      }

      const rows = await fetchGamesForDate(targetMode, dateKey);
      writeResourceCache(resourceKey, rows);
      topEdgeGamesCacheRef.current.set(mapKey, rows);
      return rows;
    },
    [games, mode, selectedDateKey],
  );
  useEffect(() => {
    let cancelled = false;
    const trackedTopEvBets = profileState.trackedBets.filter(
      (bet) =>
        bet.source === "live-games-pro-ev" &&
        (bet.mode === "college" || bet.mode === "nba"),
    );

    if (trackedTopEvBets.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    const modesToLoad = [...new Set(trackedTopEvBets.map((bet) => bet.mode))];
    void Promise.all(
      modesToLoad.map(async (targetMode) => ({
        targetMode,
        slate: await getTopEdgeGamesForDate(targetMode, selectedDateKey).catch(
          () => [] as LiveGameListItem[],
        ),
      })),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      const snapshots = results.flatMap(({ targetMode, slate }) =>
        slate.map((game) => buildTrackedBetGameSnapshotFromListItem(targetMode, game)),
      );
      syncTrackedBetsFromSnapshots(snapshots);
    });

    return () => {
      cancelled = true;
    };
  }, [
    getTopEdgeGamesForDate,
    profileState.trackedBets,
    selectedDateKey,
    syncTrackedBetsFromSnapshots,
  ]);
  useEffect(() => {
    let cancelled = false;
    if (
      healthStatus !== "ok" ||
      showFavoritesOnly
    ) {
      return () => {
        cancelled = true;
      };
    }

    void loadLeaderboardPlayers(selectedConferenceGames, {
      cancelled: () => cancelled,
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    healthStatus,
    loadLeaderboardPlayers,
    selectedConferenceGames,
    showFavoritesOnly,
  ]);
  const findTopEdgeGameId = useCallback(
    async (row: TopMarketEvItem) => {
      const { homeTeam, awayTeam } = getTopEdgeTeams(row);
      if (!homeTeam || !awayTeam) {
        console.log("[top-edge] missing teams for row", {
          event: row.event,
          eventId: row.eventId,
          sportKey: row.sportKey,
        });
        return null;
      }

      const candidateModes: GameMode[] = row.sportKey
        ? [resolveTopEdgeMode(row)]
        : mode === "nba"
          ? ["nba", "college"]
          : ["college", "nba"];
      const candidateDates = getTopEdgeDateCandidates(
        row.commenceTime,
        selectedDateKey,
      );

      const candidateTargets = candidateModes.flatMap((candidateMode) =>
        candidateDates.map((candidateDate) => ({
          candidateMode,
          candidateDate,
        })),
      );
      const settledGames = await Promise.all(
        candidateTargets.map(async ({ candidateMode, candidateDate }) => {
          try {
            const slateGames = await getTopEdgeGamesForDate(
              candidateMode,
              candidateDate,
            );
            return { candidateMode, slateGames };
          } catch {
            return { candidateMode, slateGames: [] as LiveGameListItem[] };
          }
        }),
      );

      for (const { candidateMode, slateGames } of settledGames) {
        const exactMatch = findExactLiveGameMatch(slateGames, row);
        if (exactMatch?.gameId) {
          console.log("[top-edge] exact game match", {
            row: row.event,
            gameId: exactMatch.gameId,
            mode: candidateMode,
          });
          return { gameId: exactMatch.gameId, targetMode: candidateMode };
        }
      }

      for (const { candidateMode, slateGames } of settledGames) {
        const matchedGame = findOddsEventForGame(
          slateGames.map((game) => mapLiveGameToBettingGame(game, row.sportKey)),
          {
            homeTeam: { displayName: homeTeam },
            awayTeam: { displayName: awayTeam },
            startDateTime: row.commenceTime,
          },
        );

        const resolvedGameId =
          matchedGame?.eventId ?? findBestLiveGameMatch(slateGames, row)?.gameId;
        if (resolvedGameId) {
          console.log("[top-edge] fallback game match", {
            row: row.event,
            gameId: resolvedGameId,
            mode: candidateMode,
          });
          return { gameId: resolvedGameId, targetMode: candidateMode };
        }
      }

      console.log("[top-edge] no game match found", {
        row: row.event,
        eventId: row.eventId,
        sportKey: row.sportKey,
        commenceTime: row.commenceTime,
      });
      return null;
    },
    [getTopEdgeGamesForDate, mode, selectedDateKey],
  );
  useEffect(() => {
    let cancelled = false;
    const rows = filteredTopEvRows.slice(0, 10);

    if (rows.length === 0) {
      setTopEdgeTargets({});
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const nextEntries = await Promise.all(
        rows.map(async (row) => {
          const match = await findTopEdgeGameId(row).catch(() => null);
          return [getTopEdgeRowKey(row), match] as const;
        }),
      );

      if (cancelled) {
        return;
      }

      setTopEdgeTargets(
        Object.fromEntries(
          nextEntries.filter(
            (entry): entry is readonly [string, ResolvedTopEdgeTarget] =>
              Boolean(entry[1]?.gameId),
          ),
        ),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [filteredTopEvRows, findTopEdgeGameId]);
  const navigateToResolvedGame = useCallback(
    (
      target: ResolvedTopEdgeTarget,
      originSource?: "live-games-card",
      preferredRoute?: string,
    ) => {
      console.log("[top-edge] navigating to game", target);
      setMode(target.targetMode);
      setLastEntrySource("normal");
      setGameId(target.gameId, target.targetMode);
      setIsProEvModalOpen(false);
      router.push({
        pathname: (preferredRoute ?? defaultInGameRoute) as never,
        params: {
          gameId: target.gameId,
          mode: target.targetMode,
          from: "normal",
          origin: originSource,
        },
      } as never);
    },
    [defaultInGameRoute, router, setGameId, setLastEntrySource, setMode],
  );
  const openTopEdgeGame = useCallback(
    async (row: TopMarketEvItem) => {
      console.log("[top-edge] row tapped", {
        row: row.event,
        eventId: row.eventId,
        sportKey: row.sportKey,
      });
      const cachedMatch = topEdgeTargets[getTopEdgeRowKey(row)];
      if (cachedMatch) {
        console.log("[top-edge] using cached target", cachedMatch);
        navigateToResolvedGame(cachedMatch);
        return;
      }

      const match = await findTopEdgeGameId(row).catch(() => null);
      if (!match) {
        console.log("[top-edge] tap resolved to no target", {
          row: row.event,
          eventId: row.eventId,
        });
        return;
      }

      navigateToResolvedGame(match);
    },
    [
      findTopEdgeGameId,
      navigateToResolvedGame,
      topEdgeTargets,
    ],
  );

  const openGame = useCallback(
    (game: LiveGameListItem) => {
      // Hand the schedule list's already-known team names/logos/records/
      // score/status to the destination screen so its shell can paint
      // instantly instead of starting from nothing — see
      // src/loading/pendingGameSeed.ts.
      stashPendingGameSeed(game);
      navigateToResolvedGame(
        { gameId: game.gameId, targetMode: mode },
        "live-games-card",
        shouldOpenGameOnPreview(game) ? "/(tabs)/preview" : undefined,
      );
    },
    [mode, navigateToResolvedGame],
  );
  const favoriteGames = useMemo(
    () =>
      [...profileState.favoriteGames].sort(
        (left, right) =>
          new Date(right.addedAt).getTime() - new Date(left.addedAt).getTime(),
      ),
    [profileState.favoriteGames],
  );
  const openFavoriteGame = useCallback(
    (favorite: FavoriteGameSelection) => {
      navigateToResolvedGame({
        gameId: favorite.gameId,
        targetMode: favorite.mode,
      }, undefined, shouldOpenGameOnPreview({
        isLive: false,
        statusText: favorite.snapshot?.statusText ?? "",
      }) ? "/(tabs)/preview" : undefined);
    },
    [navigateToResolvedGame],
  );
  const openLeaderboardPlayer = useCallback(
    (entry: LeaderboardPlayerEntry) => {
      setGameId(entry.gameId, mode);
      setSelectedLeaderboardPlayer(entry.player);
      setIsLeaderboardPlayerModalOpen(true);
    },
    [mode, setGameId],
  );
  const toggleMatchGroup = useCallback((groupKey: string) => {
    setCollapsedMatchGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  }, []);

  const renderGameItem = useCallback<ListRenderItem<LiveGameListItem>>(
    ({ item: game }) => {
      const conferences = deriveConferencesFromGame(game, mode);
      const metaParts = [
        conferences.map((conference) => conference.label).join(" • "),
        game.venue || (game.sport === "baseball" ? "Ballpark" : "Arena"),
      ].filter(Boolean);
      const conferenceLabel =
        metaParts[0] ||
        game.conference?.shortName ||
        game.conference?.name ||
        modeLabel(mode);
      const baseballSummary = game.baseballScoreboard;
      const statusText = formatMatchCardStatusText(game);
      // Dim the losing team (name + score) once the game is final.
      const gridIsFinal = getGamePhase(game) === "final";
      const gridAwayScore = parseScoreValue(game.away.score);
      const gridHomeScore = parseScoreValue(game.home.score);
      const gridAwayWins =
        gridIsFinal &&
        gridAwayScore !== null &&
        gridHomeScore !== null &&
        gridAwayScore > gridHomeScore;
      const gridHomeWins =
        gridIsFinal &&
        gridAwayScore !== null &&
        gridHomeScore !== null &&
        gridHomeScore > gridAwayScore;

      return (
        <View style={styles.gameGridItem}>
          <MatchGameCardPressable
            onNavigate={() => openGame(game)}
            originGameId={game.gameId}
            originSource="live-games-card"
          >
            <Card padded={false}>
              <View style={styles.matchCardBody}>
                <View style={styles.matchRowHead}>
                  <Pill
                    label={statusText}
                    tone={statusTone(game.statusText)}
                    fillColor={getMatchViewStatusFill(game.statusText)}
                  />
                  <Text numberOfLines={2} style={styles.matchMeta}>
                    {conferenceLabel}
                  </Text>
                    </View>

                <View style={styles.matchupRow}>
                  <View style={[styles.teamSlot, styles.teamSlotHome]}>
                    <Text
                      style={[
                        styles.matchTeamName,
                        styles.matchTeamNameHome,
                        gridAwayWins ? styles.matchTeamNameLose : null,
                      ]}
                      numberOfLines={1}
                    >
                      {getMatchCardTeamName(game.home)}
                    </Text>
                    <TeamLogoLink
                      teamId={game.home.id}
                      uri={game.home.logo || FALLBACK_IMAGE_URI}
                      style={styles.matchLogo}
                    />
                  </View>
                  <Text style={styles.matchScore} numberOfLines={1}>
                    <Text style={gridAwayWins ? styles.matchScoreLose : undefined}>
                      {game.home.score}
                    </Text>
                    {" - "}
                    <Text style={gridHomeWins ? styles.matchScoreLose : undefined}>
                      {game.away.score}
                    </Text>
                  </Text>
                  <View style={[styles.teamSlot, styles.teamSlotAway]}>
                    <TeamLogoLink
                      teamId={game.away.id}
                      uri={game.away.logo || FALLBACK_IMAGE_URI}
                      style={styles.matchLogo}
                    />
                    <Text
                      style={[
                        styles.matchTeamName,
                        styles.matchTeamNameAway,
                        gridHomeWins ? styles.matchTeamNameLose : null,
                      ]}
                      numberOfLines={1}
                    >
                      {getMatchCardTeamName(game.away)}
                    </Text>
                  </View>
                    </View>

                {game.sport === "baseball" ? (
                  <View style={styles.baseballMetaRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <BaseballLiveStatePill situation={game.baseballState} compact />
                    </View>
                    <Text style={styles.matchMetaCompact}>
                      R/H/E {game.away.score}/{baseballSummary?.away.hits ?? "-"}/
                  {baseballSummary?.away.errors ?? "-"} • {game.home.score}/
                  {baseballSummary?.home.hits ?? "-"}/{baseballSummary?.home.errors ?? "-"}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Card>
          </MatchGameCardPressable>
        </View>
      );
    },
    [mode, openGame, styles, theme],
  );
  const renderGameGroupItem = useCallback<ListRenderItem<MatchListGroup>>(
    ({ item: group }) => {
      const isCollapsed = collapsedMatchGroups[group.key] ?? false;
      // "nba" mode is currently pointed at WNBA data (see PRO_BASKETBALL_LABEL
      // in src/features/nba/proBasketballLeague.ts) — for that league
      // specifically, skip the collapsible section header/toggle entirely
      // and just show the games directly. Other leagues (college, baseball)
      // keep the existing collapsible-group behavior untouched.
      const isWnba = mode === "nba";

      const gamesList = (
        <View style={[styles.groupGamesWrap, isWnba ? styles.groupGamesWrapStandalone : null]}>
          {group.games.map((game, index) => {
                  const phase = getGamePhase(game);
                  const isLive = phase === "live";
                  const isFinal = phase === "final";
                  const indicatorColor = isLive
                    ? "#22C55E"
                    : isFinal
                      ? theme.colors.textMuted
                      : "#60A5FA";
                  // Left-of-score label: live clock+period, "Final", or nothing
                  // (scheduled shows the tip-off time in the center instead).
                  const statusLabel = isLive
                    ? formatLiveClockLabel(game)
                    : isFinal
                      ? "Final"
                      : "";
                  const scheduledTime = formatMatchCardStatusText(game);
                  const awayScoreValue = parseScoreValue(game.away.score);
                  const homeScoreValue = parseScoreValue(game.home.score);
                  const awayWins =
                    isFinal &&
                    awayScoreValue !== null &&
                    homeScoreValue !== null &&
                    awayScoreValue > homeScoreValue;
                  const homeWins =
                    isFinal &&
                    awayScoreValue !== null &&
                    homeScoreValue !== null &&
                    homeScoreValue > awayScoreValue;

                  return (
                    <View key={game.gameId}>
                      <MatchGameCardPressable
                        onNavigate={() => openGame(game)}
                        originGameId={game.gameId}
                        originSource="live-games-card"
                      >
                        <View style={styles.fotmobRow}>
                          <View style={[styles.fotmobTeamSlot, styles.fotmobAwaySlot]}>
                            <Text
                              numberOfLines={2}
                              style={[
                                styles.fotmobTeamName,
                                styles.fotmobTeamNameAway,
                                homeWins ? styles.fotmobTeamNameLose : null,
                              ]}
                            >
                              {getMatchCardTeamName(game.away)}
                            </Text>
                            <TeamLogoLink
                              teamId={game.away.id}
                              uri={game.away.logo || FALLBACK_IMAGE_URI}
                              style={[
                                styles.fotmobLogo,
                                homeWins ? styles.fotmobLogoLose : null,
                              ]}
                            />
                          </View>

                          <View style={[styles.fotmobTeamSlot, styles.fotmobHomeSlot]}>
                            <TeamLogoLink
                              teamId={game.home.id}
                              uri={game.home.logo || FALLBACK_IMAGE_URI}
                              style={[
                                styles.fotmobLogo,
                                awayWins ? styles.fotmobLogoLose : null,
                              ]}
                            />
                            <Text
                              numberOfLines={2}
                              style={[
                                styles.fotmobTeamName,
                                styles.fotmobTeamNameHome,
                                awayWins ? styles.fotmobTeamNameLose : null,
                              ]}
                            >
                              {getMatchCardTeamName(game.home)}
                            </Text>
                          </View>

                          {/* Score/time pinned to the exact horizontal center of
                              the card (= screen center), independent of team-name
                              widths, so times and scores read straight down the
                              middle. */}
                          <View pointerEvents="none" style={styles.fotmobCenter}>
                            {phase === "scheduled" ? (
                              <Text style={styles.fotmobScheduledTime} numberOfLines={1}>
                                {scheduledTime}
                              </Text>
                            ) : (
                              <Text style={styles.fotmobScore} numberOfLines={1}>
                                <Text
                                  style={
                                    awayWins
                                      ? styles.fotmobScoreWin
                                      : isFinal
                                        ? styles.fotmobScoreLose
                                        : undefined
                                  }
                                >
                                  {game.away.score}
                                </Text>
                                <Text style={styles.fotmobScoreSep}> - </Text>
                                <Text
                                  style={
                                    homeWins
                                      ? styles.fotmobScoreWin
                                      : isFinal
                                        ? styles.fotmobScoreLose
                                        : undefined
                                  }
                                >
                                  {game.home.score}
                                </Text>
                              </Text>
                            )}
                          </View>

                          {/* Live/final status (clock or "Final") pinned to the
                              left edge so it never offsets the centered score. No
                              dot before a game starts. */}
                          {statusLabel ? (
                            <View pointerEvents="none" style={styles.statusIndicatorOverlay}>
                              {phase !== "scheduled" ? (
                                <View
                                  style={[
                                    styles.statusIndicatorDot,
                                    { backgroundColor: indicatorColor },
                                  ]}
                                >
                                  {isLive ? <View style={styles.statusIndicatorPulse} /> : null}
                                </View>
                              ) : null}
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.statusIndicatorText,
                                  { color: indicatorColor },
                                ]}
                              >
                                {statusLabel}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      </MatchGameCardPressable>

                      {game.sport === "baseball" ? (
                        <View style={styles.baseballGroupMetaRow}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <BaseballLiveStatePill situation={game.baseballState} compact />
                          </View>
                          <Text style={styles.matchMetaCompact}>
                            R/H/E {game.away.score}/{game.baseballScoreboard?.away.hits ?? "-"}/
                            {game.baseballScoreboard?.away.errors ?? "-"} • {game.home.score}/
                            {game.baseballScoreboard?.home.hits ?? "-"}/
                            {game.baseballScoreboard?.home.errors ?? "-"}
                          </Text>
                        </View>
                      ) : null}

                      {index < group.games.length - 1 ? (
                        <View style={styles.groupRowDivider} />
                      ) : null}
                    </View>
                  );
                })}
        </View>
      );

      if (isWnba) {
        return (
          <View style={styles.groupBlock}>
            <Card padded={false}>{gamesList}</Card>
          </View>
        );
      }

      return (
        <View style={styles.groupBlock}>
          <Card padded={false}>
            <Pressable
              onPress={() => toggleMatchGroup(group.key)}
              style={({ pressed }) => [
                styles.groupHeader,
                pressed ? styles.groupHeaderPressed : null,
              ]}
            >
              <View style={styles.groupHeaderLeft}>
                <View style={styles.groupBadge}>
                  <Text style={styles.groupBadgeText}>
                    {getConferenceBadgeLabel(group.shortLabel)}
                  </Text>
                </View>
                <Text numberOfLines={1} style={styles.groupTitle}>
                  {group.label}
                </Text>
              </View>
              <FontAwesome
                name={isCollapsed ? "angle-down" : "angle-up"}
                size={18}
                color={theme.colors.textPrimary}
              />
            </Pressable>

            {!isCollapsed ? gamesList : null}
          </Card>
        </View>
      );
    },
    [
      collapsedMatchGroups,
      mode,
      openGame,
      styles,
      theme.colors.textMuted,
      theme.colors.textPrimary,
      toggleMatchGroup,
    ],
  );
  const renderFavoriteGameItem = useCallback<ListRenderItem<FavoriteGameSelection>>(
    ({ item: favorite }) => {
      const snapshot = favorite.snapshot;
      const metaParts = [
        modeLabel(favorite.mode),
        snapshot?.venue || (snapshot?.sport === "baseball" ? "Ballpark" : "Arena"),
        formatFavoriteStartDate(snapshot?.startDateTime),
      ].filter(Boolean);

      return (
        <MatchGameCardPressable onNavigate={() => openFavoriteGame(favorite)}>
          <Card>
            <View style={styles.rowHead}>
              <Pill
                label={snapshot?.statusText || "Favorited"}
                tone={statusTone(snapshot?.statusText || "Scheduled")}
              />
              <Text style={styles.meta}>{metaParts.join(" | ")}</Text>
            </View>

            <View style={styles.teamRow}>
              <View style={styles.teamCell}>
                <TeamLogoLink
                  uri={snapshot?.awayLogo || FALLBACK_IMAGE_URI}
                  style={styles.logo}
                />
                <Text style={styles.teamName} numberOfLines={1}>
                  {snapshot?.awayName || "Away"}
                </Text>
              </View>
              <Text style={styles.score}>{snapshot?.awayScore || "-"}</Text>
            </View>

            <View style={styles.teamRow}>
              <View style={styles.teamCell}>
                <TeamLogoLink
                  uri={snapshot?.homeLogo || FALLBACK_IMAGE_URI}
                  style={styles.logo}
                />
                <Text style={styles.teamName} numberOfLines={1}>
                  {snapshot?.homeName || "Home"}
                </Text>
              </View>
              <Text style={styles.score}>{snapshot?.homeScore || "-"}</Text>
            </View>
          </Card>
        </MatchGameCardPressable>
      );
    },
    [openFavoriteGame, styles],
  );

  const renderEvItem = useCallback<ListRenderItem<TopMarketEvItem>>(
    ({ item: row }) => {
      const target = topEdgeTargets[getTopEdgeRowKey(row)];
      const candidate = buildTrackedBetCandidateFromTopMarketEv(row, {
        gameId: target?.gameId,
        mode: target?.targetMode,
        fallbackMode: mode,
      });
      const trackedBet = candidate
        ? trackedBetByKey.get(buildTrackedBetKey(candidate))
        : null;

      return (
        <MatchGameCardPressable onNavigate={() => void openTopEdgeGame(row)}>
          <Card>
            <View style={styles.evRowHeader}>
              <View style={styles.evTitleWrap}>
                <Text style={styles.evEvent} numberOfLines={2}>
                  {row.event || row.eventId}
                </Text>
                <Text style={styles.evSubtitle}>
                  {row.marketLabel.toUpperCase()} | {row.side}
                  {formatLinePoint(row.linePoint)} | {formatOdds(row.offeredOdds)}
                </Text>
              </View>
              <Pill
                label={`Pro EV ${formatEvPercent(row.edgePct)}`}
                tone={row.edgePct >= 0 ? "success" : "danger"}
              />
            </View>
            <View style={styles.evDetails}>
              <Text style={styles.evDetailText}>{formatFairProb(row.fairProb)}</Text>
              {row.confidence !== undefined ? (
                <Text style={styles.evDetailText}>
                  Confidence {(row.confidence * 100).toFixed(0)}%
                </Text>
              ) : null}
            </View>
            {candidate ? (
              <TrackedBetControls
                candidate={candidate}
                trackedBet={trackedBet}
                onToggle={toggleTrackedBet}
                onStakeChange={updateTrackedBetStake}
                onResultChange={(key, result) =>
                  setTrackedBetResult(key, result, "manual")
                }
              />
            ) : null}
          </Card>
        </MatchGameCardPressable>
      );
    },
    [
      mode,
      openTopEdgeGame,
      setTrackedBetResult,
      styles,
      toggleTrackedBet,
      topEdgeTargets,
      trackedBetByKey,
      updateTrackedBetStake,
    ],
  );
  const renderLeaderboardItem = useCallback<
    ListRenderItem<LeaderboardPlayerEntry>
  >(
    ({ item }) => {
      const playerKey = `${item.gameId}:${item.player.id}`;
      return (
        <TopPlayerRow
          player={item.player}
          teamColor={item.teamColor}
          teamPrimaryColor={item.teamPrimaryColor}
          isHighestRated={leaderboardTopPlayerKey === playerKey}
          sparklinePulseEnabled={isLeaderboardEntryLive(item)}
          onPress={() => openLeaderboardPlayer(item)}
        />
      );
    },
    [leaderboardTopPlayerKey, openLeaderboardPlayer],
  );
  const renderMatchLeaderboardFooter = useCallback(
    (routeGames: LiveGameListItem[]) => {
      if (routeGames.length === 0 || showFavoritesOnly) {
        return null;
      }

      const leaderboardEmptyText = leaderboardLoading
        ? "Loading leaderboard..."
        : leaderboardError ||
          "No rated players are available for the selected date and conference.";

      return (
        <View style={styles.leaderboardFooter}>
          <Card style={styles.leaderboardFooterCard}>
            <SectionHeader
              title="Player Leaderboard"
              subtitle="Top rated players across these matchups"
            />
            {leaderboardLoading ? (
              <AppLoader
                title="Loading leaderboard"
                subtitle="Ranking players across the current slate."
              />
            ) : leaderboardPlayers.length > 0 ? (
              <View style={styles.leaderboardRows}>
                {leaderboardPlayers.map((item) => {
                  const playerKey = `${item.gameId}:${item.player.id}`;
                  return (
                    <TopPlayerRow
                      key={playerKey}
                      player={item.player}
                      teamColor={item.teamColor}
                      teamPrimaryColor={item.teamPrimaryColor}
                      isHighestRated={leaderboardTopPlayerKey === playerKey}
                      sparklinePulseEnabled={isLeaderboardEntryLive(item)}
                      onPress={() => openLeaderboardPlayer(item)}
                    />
                  );
                })}
              </View>
            ) : (
              <>
                <Text style={styles.empty}>{leaderboardEmptyText}</Text>
                {leaderboardError ? (
                  <Pressable
                    style={styles.emptyRetryButton}
                    onPress={() => void loadLeaderboardPlayers(routeGames, { forceRefresh: true })}
                  >
                    <Text style={styles.emptyRetryText}>Retry</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </Card>
        </View>
      );
    },
    [
      leaderboardError,
      leaderboardLoading,
      leaderboardPlayers,
      leaderboardTopPlayerKey,
      loadLeaderboardPlayers,
      openLeaderboardPlayer,
      showFavoritesOnly,
      styles,
    ],
  );

  const renderDateScene = useCallback(
    ({ route }: { route: ConferenceRoute }) => {
      // Each route in the date TabView renders its OWN date's games, not the
      // currently-selected date's — otherwise every adjacent page (which
      // react-native-tab-view keeps mounted/pre-rendered so swipes reveal
      // real content, matching the in-game Court/Stats/Plays/Odds tabs)
      // would just be showing a duplicate of whatever `games`/
      // `conferenceBuckets` currently hold for the active date. The active
      // route reuses the live `games` state (freshest, updates on
      // pull-to-refresh); every other route reads its own data out of the
      // same resource cache the date-rail count-check effect already
      // populates for the whole visible rail, so adjacent days' real games
      // are ready before the user ever starts dragging.
      const isActiveRoute = route.key === selectedDateKey;
      // `games` is only trustworthy for the active route once loadGames has
      // actually resolved FOR THIS DATE — selectedDateKey changes (and thus
      // a route becoming "active") happen a full render ahead of that, since
      // loadGames runs in an effect that fires after the commit. Trusting
      // `games` unconditionally here for that one render was exactly the
      // swipe-completion flicker: cache-correct data while the pane was
      // still the "next" pane -> switches to still-stale `games` the instant
      // it becomes active -> corrects once loadGames resolves. Falling back
      // to the same cache read a non-active route uses whenever `games`
      // hasn't caught up yet closes that gap — the active route just keeps
      // showing what it was already showing a moment ago.
      const activeGamesAreFresh = isActiveRoute && gamesDateKey === route.key;
      const routeCachedGames = activeGamesAreFresh
        ? null
        : readResourceCache<LiveGameListItem[]>(
            `match-games:${mode}:${route.key}`,
            MATCH_GAMES_CACHE_TTL_MS,
          );
      const routeAllGames = activeGamesAreFresh ? games : (routeCachedGames ?? []);
      const routeBuckets = activeGamesAreFresh
        ? conferenceBuckets
        : buildConferenceBuckets(routeAllGames, conferenceOptions, mode);
      const routeGames = routeBuckets[activeConferenceKey] ?? [];
      const displayGames = applyLiveFilter
        ? routeGames.filter((game) => game.isLive)
        : routeGames;
      const routeGroups = buildMatchListGroups(
        displayGames,
        activeConferenceKey,
        activeConferenceOption?.label,
        mode,
      );
      const isBaseballMode = mode === "baseball";
      const isAllConference = activeConferenceKey === ALL_CONFERENCE_KEY;
      const routeStillLoading = activeGamesAreFresh ? loading : routeCachedGames === null;
      // Same staleness guard as routeStillLoading above — an error left over
      // from the PREVIOUS active date shouldn't flash on this route before
      // its own load (cache-hit or fetch) has actually resolved.
      const hasError = activeGamesAreFresh && Boolean(error);
      let emptyText = "No games available for this date.";
      let emptySubtext = "";

      if (routeStillLoading) {
        emptyText = "Loading games...";
      } else if (hasError) {
        emptyText = error ?? "Failed to load games.";
      } else if (applyLiveFilter) {
        emptyText = "No games live right now";
        emptySubtext = "Tap Live again to see all of today's games.";
      } else if (isBaseballMode && isAllConference) {
        emptyText = "No live college baseball games right now.";
        emptySubtext = "Check back soon or pull to refresh.";
      } else if (!isAllConference) {
        emptyText = `No ${activeConferenceOption?.label ?? "conference"} games for ${format(
          parse(route.key, "yyyy-MM-dd", new Date()),
          "MMM d",
        )}.`;
      }

      if (matchViewMode === "leaderboard") {
        const leaderboardEmptyText = leaderboardLoading
          ? "Loading leaderboard..."
          : leaderboardError ||
            "No rated players are available for the selected date and conference.";

        return (
          <FlatList
            numColumns={1}
            data={leaderboardPlayers}
            keyExtractor={(item) => `${item.gameId}:${item.player.id}`}
            renderItem={renderLeaderboardItem}
            ItemSeparatorComponent={() => <View style={styles.spacer} />}
            contentContainerStyle={[styles.sceneContent, { paddingTop: headerHeight }]}
            scrollIndicatorInsets={{ top: headerHeight }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.accent}
              />
            }
            ListEmptyComponent={
              leaderboardLoading ? (
                <AppLoader
                  title="Loading leaderboard"
                  subtitle="Ranking players across the current slate."
                />
              ) : (
                <Card style={styles.emptyStateCard}>
                  <Text style={styles.empty}>{leaderboardEmptyText}</Text>
                  {leaderboardError ? (
                    <Pressable
                      style={styles.emptyRetryButton}
                      onPress={() => void loadLeaderboardPlayers(routeGames, { forceRefresh: true })}
                    >
                      <Text style={styles.emptyRetryText}>Retry</Text>
                    </Pressable>
                  ) : null}
                </Card>
              )
            }
            keyboardShouldPersistTaps="handled"
          />
        );
      }

      return (
        <FlatList
          data={routeGroups}
          keyExtractor={(item) => item.key}
          renderItem={renderGameGroupItem}
          numColumns={1}
          contentContainerStyle={[styles.sceneContent, { paddingTop: headerHeight }]}
          scrollIndicatorInsets={{ top: headerHeight }}
          ListFooterComponent={
            /* Insight cards temporarily hidden – restore the JSX below to bring them back:
            <HomeInsightsSections
              onSeeFullLeaderboard={() => setMatchViewMode("leaderboard")}
            />
            */
            null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent}
            />
          }
          ListEmptyComponent={
            <Card style={styles.emptyStateCard}>
              <Text style={styles.empty}>{emptyText}</Text>
              {emptySubtext ? (
                <Text style={styles.emptySubtext}>{emptySubtext}</Text>
              ) : null}
              {hasError ? (
                <Pressable style={styles.emptyRetryButton} onPress={onRefresh}>
                  <Text style={styles.emptyRetryText}>Retry</Text>
                </Pressable>
              ) : null}
            </Card>
          }
          keyboardShouldPersistTaps="handled"
        />
      );
    },
    [
      activeConferenceKey,
      activeConferenceOption?.label,
      applyLiveFilter,
      conferenceBuckets,
      conferenceOptions,
      // Not read directly, but its identity changes whenever the date-rail
      // prefetch effect resolves another date's games into the resource
      // cache — that's the signal to re-render already-mounted adjacent
      // scenes so they pick up the newly-cached data instead of staying on
      // an empty/loading placeholder.
      dateGameCounts,
      games,
      gamesDateKey,
      headerHeight,
      mode,
      error,
      loading,
      loadLeaderboardPlayers,
      leaderboardError,
      leaderboardLoading,
      leaderboardPlayers,
      matchViewMode,
      onRefresh,
      refreshing,
      renderGameGroupItem,
      renderLeaderboardItem,
      selectedDateKey,
      styles,
      theme.colors.accent,
    ],
  );

  const handleDateIndexChange = useCallback(
    (nextIndex: number) => {
      // react-native-tab-view can fire a spurious onIndexChange (typically
      // reporting index 0) whenever `dateRoutes` itself changes shape — e.g.
      // an async game-count fetch resolves and inserts an OLDER date earlier
      // in the array while "today" is still the intended selection. That's
      // the pager re-syncing to a routes-array mutation, not a user swipe —
      // a real swipe can only ever move exactly one page at a time. Trusting
      // a non-adjacent index here permanently corrupted selectedDateKey to
      // whatever stale date happened to land at that index (nothing else
      // ever corrects it afterward), which is what made the app open on a
      // date weeks in the past.
      if (Math.abs(nextIndex - selectedDateIndex) !== 1) {
        return;
      }
      const nextRoute = dateRoutes[nextIndex];
      if (nextRoute && nextRoute.key !== selectedDateKey) {
        setSelectedDateKey(nextRoute.key);
      }
    },
    [dateRoutes, selectedDateIndex, selectedDateKey],
  );

  if (needsManualApiSetup) {
    return (
      <AppScreen
        edges={["top"]}
        padded={false}
        scroll={false}
        style={{ backgroundColor: theme.colors.bg }}
      >
        <ApiSetupScreen
          message={
            healthErrorMessage ??
            API_SETUP_MESSAGE ??
            "Set EXPO_PUBLIC_API_URL=http://<LAN-IP>:4000 for physical devices if auto-detection does not work."
          }
          commands={
            API_SETUP_COMMANDS ??
            [
              "npm run dev:api",
              "npm run dev:mobile",
              "EXPO_PUBLIC_API_URL=http://<LAN-IP>:4000 npm run dev:mobile",
              "npm run dev:mobile:tunnel",
            ].join("\n")
          }
          onRetry={checkApiHealth}
        />
      </AppScreen>
      );
  }

  if ((screenLoading.hasCritical || loading) && games.length === 0 && !error) {
    return (
      <AppScreen
        edges={["top"]}
        padded={false}
        scroll={false}
        style={{ backgroundColor: theme.colors.bg }}
      >
        <AppLoader
          title="Loading games"
          subtitle="Building the slate and preserving the current date context."
        />
      </AppScreen>
    );
  }

  if (!screenLoading.hasCritical && error && games.length === 0) {
    return (
      <ScreenErrorState
        title="Could not load Match View"
        message={error}
        onRetry={() => {
          setLoading(true);
          void loadGames(selectedDateKey, screenKey, { forceRefresh: true }).catch(() => {});
          if (isProEvModalOpen) {
            void loadTopEv(
              selectedDateKey,
              screenKey,
              PRO_EV_MODAL_SECTION_KEY,
              { forceRefresh: true },
            ).catch(() => {});
          }
        }}
      />
    );
  }

  let evEmptyText =
    topEdgeSort === "fairProb"
      ? "No fair win probability lines available for this date."
      : "No Pro EV bets available for this date.";
  if (evLoading) {
    evEmptyText = "Loading highest Pro EV bets...";
  } else if (evError) {
    evEmptyText = evError;
  }

  const modeTitle = "APEX";
  const showConferenceFilter = !showFavoritesOnly && mode !== "nba";
  const onHeaderLayout = (event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    if (nextHeight !== headerHeight) {
      setHeaderHeight(nextHeight);
    }
  };
  return (
    <AppScreen
      edges={["left", "right"]}
      padded={false}
      scroll={false}
      showAmbient={false}
      style={{ backgroundColor: "transparent" }}
    >
      <View style={styles.screen}>
        <View style={styles.headerOverlay} onLayout={onHeaderLayout}>
          {/* Solid black behind the whole header (logo/Live/menu/date row) —
              no blur, no sub-zones, just a flat fill sized to the header's
              own measured height. */}
          <View
            pointerEvents="none"
            style={[styles.headerSolidBlack, { height: headerHeight }]}
          />
          {/* Fade-to-transparent strip right below the header: the list
              scrolls underneath this, so a row passing under the date row
              dissolves into black instead of being cut off by a hard edge.
              pointerEvents="none" so it never intercepts scroll/tap on the
              list underneath it. Neither this nor the solid black view above
              has an explicit zIndex — headerArea (the actual header content,
              rendered right after both) also has none, so plain JSX/paint
              order already puts it on top; giving these two an explicit
              zIndex while headerArea has none would flip that (an unset
              zIndex is treated as lower than any explicit one), which is
              exactly what blanked out the whole header the first time this
              was tried. */}
          <LinearGradient
            pointerEvents="none"
            colors={["#000000", "rgba(0,0,0,0)"]}
            style={[
              styles.headerFadeGradient,
              { top: headerHeight, height: HEADER_FADE_HEIGHT },
            ]}
          />
          <View style={[styles.headerArea, { paddingTop: insets.top }]}>
              {/* Top row: logo on the left, action icons on the right. */}
              <View style={styles.headerTopRow}>
                <Image
                  source={require("@/assets/images/apex-logo.png")}
                  style={styles.brandLogo}
                  resizeMode="contain"
                  accessibilityRole="image"
                  accessibilityLabel={modeTitle}
                />
                <View style={styles.iconRow}>
                  {!showFavoritesOnly ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        applyLiveFilter ? "Show all games" : "Show live games only"
                      }
                      style={[
                        styles.liveBtn,
                        liveFilterOn ? styles.liveBtnOn : null,
                      ]}
                      onPress={onLivePress}
                    >
                      {Platform.OS === "ios" ? (
                        <View pointerEvents="none" style={styles.liveBtnGlassMask}>
                          <GlassView
                            glassEffectStyle="regular"
                            colorScheme="dark"
                            isInteractive={false}
                            style={styles.liveBtnGlass}
                          />
                        </View>
                      ) : (
                        <View pointerEvents="none" style={styles.liveBtnFallbackGlass} />
                      )}
                      {/* Dot reflects filter toggle state: lit when filter is on,
                          dimmed when off. Pulse adds extra energy when live
                          games are actually happening. */}
                      <LiveStatusDot
                        active={liveFilterOn}
                        idleColor={theme.colors.textMuted}
                      />
                      <Text style={styles.liveBtnText}>
                        {liveGameCount > 0 ? `Live · ${liveGameCount}` : "Live"}
                      </Text>
                    </Pressable>
                  ) : null}
                  {/* Default "circle" shape — matches the other circular
                      icon buttons in the header (e.g. the Standings menu
                      item's icon when it was still a standalone header
                      button). The previous "pill" shape widened this into a
                      capsule around the single icon glyph instead of a fixed
                      square, which didn't read as a clean circle. */}
                  <HeaderMenuButton
                    onPress={() => setIsHeaderMenuOpen((current) => !current)}
                    accessibilityLabel="Open menu"
                  />
                </View>
              </View>

              {!showFavoritesOnly ? (
                <>
                  <View style={styles.dateSliderWrap}>
                    <TabBar
                      items={dateTabItems}
                      activeKey={selectedDateKey}
                      variant="flat"
                      textPreset="largeAccent"
                    />
                  </View>

                  {showConferenceFilter ? (
                    <View style={styles.selectorWrap}>
                      <ConferenceFilterBar
                        options={conferenceOptions}
                        selectedKey={activeConferenceKey}
                        onSelect={(option) => {
                          setActiveConferenceKey(option.key);
                          setSelectedConference(option);
                        }}
                      />
                    </View>
                  ) : null}
                </>
              ) : null}

              {healthStatus === "fail" && healthErrorMessage ? (
                <Card>
                  <Text style={styles.errorText}>{healthErrorMessage}</Text>
                </Card>
              ) : null}
            </View>
          </View>

        <View style={styles.body}>
          {showFavoritesOnly ? (
            <FlatList
              data={favoriteGames}
              keyExtractor={(item) => item.key}
              renderItem={renderFavoriteGameItem}
              ItemSeparatorComponent={() => <View style={styles.spacer} />}
              contentContainerStyle={[styles.sceneContent, { paddingTop: headerHeight }]}
              scrollIndicatorInsets={{ top: headerHeight }}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={theme.colors.accent}
                />
              }
              ListEmptyComponent={
                <Card style={styles.emptyStateCard}>
                  <Text style={styles.empty}>
                    No favorited games yet.
                  </Text>
                  <Text style={styles.emptySubtext}>
                    Favorite a game from the in-game star button, then come back here.
                  </Text>
                </Card>
              }
              keyboardShouldPersistTaps="handled"
            />
          ) : (
            <TabView
              navigationState={{
                index: Math.max(0, selectedDateIndex),
                routes: dateRoutes,
              }}
              renderScene={renderDateScene}
              onIndexChange={handleDateIndexChange}
              renderTabBar={() => null}
              initialLayout={{ width: layout.width }}
              animationEnabled={false}
              swipeEnabled
              lazy
              // Matches the in-game Court/Stats/Plays/Odds tab bar's
              // lazyPreloadDistance — pre-mounts the immediately adjacent
              // date(s) with their own real content before the user starts
              // dragging, instead of only rendering them once the drag
              // crosses into that page.
              lazyPreloadDistance={1}
              pagerStyle={{ backgroundColor: theme.colors.bg }}
              style={styles.pager}
            />
          )}
        </View>

        {!showFavoritesOnly && !isToday ? (
          <View
            pointerEvents="box-none"
            style={[styles.jumpTodayWrap, { bottom: insets.bottom + theme.spacing[16] }]}
          >
            <GlassPillButton
              shape="pill"
              size={40}
              style={styles.jumpTodayButton}
              onPress={() => setSelectedDateKey(nextDateKeyWithGames)}
              accessibilityRole="button"
              accessibilityLabel="Jump to today's games"
            >
              <View style={styles.jumpTodayContent}>
                <FontAwesome
                  name="calendar-o"
                  size={13}
                  color={theme.colors.textPrimary}
                />
                <Text style={styles.jumpTodayText}>Today</Text>
              </View>
            </GlassPillButton>
          </View>
        ) : null}

        {isHeaderMenuOpen ? (
          <View pointerEvents="box-none" style={styles.headerMenuOverlay}>
            <Pressable
              style={styles.headerMenuBackdrop}
              onPress={() => setIsHeaderMenuOpen(false)}
            />
            <View style={[styles.headerMenuWrap, { top: headerHeight - theme.spacing[4] }]}>
              <Pressable onPress={() => {}}>
                <Card style={styles.headerMenuCard} padded={false} elevated>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={headerMenuLabel}
                    onPress={() => {
                      setIsHeaderMenuOpen(false);
                      if (showFavoritesOnly) {
                        return;
                      }
                      setMatchViewMode((current) =>
                        current === "leaderboard" ? "normal" : "leaderboard",
                      );
                    }}
                    style={styles.headerMenuItem}
                  >
                    <Text
                      style={[
                        styles.headerMenuItemText,
                        showFavoritesOnly ? styles.headerMenuItemTextMuted : null,
                      ]}
                    >
                      {headerMenuLabel}
                    </Text>
                  </Pressable>
                  {!showFavoritesOnly ? (
                    <>
                      <View style={styles.headerMenuDivider} />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Open calendar"
                        onPress={() => {
                          setIsHeaderMenuOpen(false);
                          setIsCalendarOpen(true);
                        }}
                        style={styles.headerMenuItem}
                      >
                        <Text style={styles.headerMenuItemText}>Calendar</Text>
                      </Pressable>
                    </>
                  ) : null}
                  <View style={styles.headerMenuDivider} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open standings"
                    onPress={() => {
                      setIsHeaderMenuOpen(false);
                      // TODO: open player and conference standings view
                    }}
                    style={styles.headerMenuItem}
                  >
                    <Text style={styles.headerMenuItemText}>Standings</Text>
                  </Pressable>
                  <View style={styles.headerMenuDivider} />
                  {(["college", "nba", "baseball"] as const).map((sportMode) => (
                    <Pressable
                      key={sportMode}
                      accessibilityRole="button"
                      accessibilityLabel={modeLabel(sportMode)}
                      onPress={() => {
                        setIsHeaderMenuOpen(false);
                        setMode(sportMode);
                        setShowFavoritesOnly(false);
                      }}
                      style={styles.headerMenuItem}
                    >
                      <Text
                        style={[
                          styles.headerMenuItemText,
                          !showFavoritesOnly && mode === sportMode
                            ? null
                            : styles.headerMenuItemTextMuted,
                        ]}
                      >
                        {modeLabel(sportMode)}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Show favorites"
                    onPress={() => {
                      setIsHeaderMenuOpen(false);
                      setShowFavoritesOnly(true);
                    }}
                    style={styles.headerMenuItem}
                  >
                    <Text
                      style={[
                        styles.headerMenuItemText,
                        showFavoritesOnly ? null : styles.headerMenuItemTextMuted,
                      ]}
                    >
                      Favorites
                    </Text>
                  </Pressable>
                  <View style={styles.headerMenuDivider} />
                  {/* WNBA-only virtual-currency practice market — see
                      src/features/stockmarket. */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open stock market"
                    onPress={() => {
                      setIsHeaderMenuOpen(false);
                      router.push("/stock-market");
                    }}
                    style={styles.headerMenuItem}
                  >
                    <Text style={styles.headerMenuItemText}>Stock Market</Text>
                  </Pressable>
                  <View style={styles.headerMenuDivider} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open profile"
                    onPress={() => {
                      setIsHeaderMenuOpen(false);
                      router.push("/profile");
                    }}
                    style={styles.headerMenuItem}
                  >
                    <Text style={styles.headerMenuItemText}>Profile</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open settings"
                    onPress={() => {
                      setIsHeaderMenuOpen(false);
                      router.push("/settings");
                    }}
                    style={styles.headerMenuItem}
                  >
                    <Text style={styles.headerMenuItemText}>Settings</Text>
                  </Pressable>
                </Card>
              </Pressable>
            </View>
          </View>
        ) : null}

        <CalendarModal
          visible={isCalendarOpen}
          selectedDateKey={selectedDateKey}
          onSelect={(key) => {
            setSelectedDateKey(key);
            setIsCalendarOpen(false);
          }}
          onClose={() => setIsCalendarOpen(false)}
        />

        <PlayerModal
          visible={isLeaderboardPlayerModalOpen && !!selectedLeaderboardPlayer?.id}
          player={selectedLeaderboardPlayer}
          onClose={() => {
            setIsLeaderboardPlayerModalOpen(false);
            setSelectedLeaderboardPlayer(null);
          }}
        />

        <Modal
          transparent
          animationType="fade"
          visible={isProEvModalOpen}
          onRequestClose={() => setIsProEvModalOpen(false)}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setIsProEvModalOpen(false)}
          >
            <View style={styles.modalSheetWrap} pointerEvents="box-none">
              <Pressable onPress={() => {}}>
                <Card style={styles.modalSheet} padded={false} elevated>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>
                      {topEdgeSort === "fairProb" ? "Fair Win %" : "Pro EV"}
                    </Text>
                    <Text style={styles.modalSubtitle}>
                      Highest ranked {topEdgeSort === "fairProb" ? "fair win probability" : "edges"} across {PRO_BASKETBALL_LABEL} and college basketball on {formattedDateLabel}.
                    </Text>
                    <View style={styles.topEdgeFilterRow}>
                      {([
                        { key: "proEv", label: "Top Pro EV" },
                        { key: "fairProb", label: "Top Fair Win %" },
                      ] as const).map((option) => {
                        const active = topEdgeSort === option.key;
                        return (
                          <Pressable
                            key={option.key}
                            onPress={() => setTopEdgeSort(option.key)}
                            style={[
                              styles.topEdgeFilterChip,
                              active ? styles.topEdgeFilterChipActive : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.topEdgeFilterText,
                                active ? styles.topEdgeFilterTextActive : null,
                              ]}
                            >
                              {option.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  <View style={styles.modalSummaryWrap}>
                    <TrackedBetSummaryCard
                      bets={visibleTrackedTopEvBets}
                      title="Picked Pro EV Bets"
                      subtitle="Projected and settled totals for the Pro EV bets you marked in this board."
                    />
                  </View>
                  <FlatList
                    data={filteredTopEvRows}
                    keyExtractor={(item) =>
                      getTopEdgeRowKey(item)
                    }
                    renderItem={renderEvItem}
                    ItemSeparatorComponent={() => <View style={styles.spacer} />}
                    contentContainerStyle={styles.modalListContent}
                    refreshControl={
                      <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={theme.colors.accent}
                      />
                    }
                    ListEmptyComponent={
                      <Card>
                        <Text style={styles.empty}>{evEmptyText}</Text>
                      </Card>
                    }
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                  />
                </Card>
              </Pressable>
            </View>
          </Pressable>
        </Modal>

      </View>
    </AppScreen>
  );
}
