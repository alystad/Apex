import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";

import BaseballFieldOutline from "@/components/BaseballFieldOutline";
import CourtOverlay from "@/components/CourtOverlay";
import MomentumTopStatsCard, {
  mockMomentumData,
} from "@/components/MomentumTopStatsCard";
import ApiSetupScreen from "@/components/ApiSetupScreen";
import PlayerModal from "@/components/PlayerModal";
import TeamLogoLink from "@/components/TeamLogoLink";
import { SkeletonCard, SkeletonText } from "@/components/loading/SkeletonPrimitives";
import GlassButton from "@/apps/mobile/src/ui/GlassButton";
import {
  useLiveGame,
  type LiveGamePlayer,
  type LiveGamePlay,
  type LiveGameTeam,
} from "@/hooks/useLiveGame";
import { useGameModeState } from "@/src/mode/GameModeContext";
import type { GameMode } from "@/src/mode/gameModeTypes";
import CollapsibleScorebug, {
  type CollapsibleScorebugAnchorFrame,
  type CollapsibleScorebugAnchorMeasurement,
  type CollapsibleScorebugAnchorTransform,
  type CollapsibleScorebugGameData,
} from "@/apps/mobile/src/components/scorebug/CollapsibleScorebug";
import {
  API_SETUP_COMMANDS,
  API_SETUP_MESSAGE,
  checkApiHealth as checkApiHealthOnce,
  getApiBaseUrl,
  isLanHttpUrl,
} from "@/src/config/api";
import { getJerseyTheme, type JerseyTheme } from "@/src/lib/jerseyTheme";
import { colors, getInGameRatingColor } from "@/theme/colors";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

type SnapshotRowConfig = {
  label: string;
  away: string;
  home: string;
  lowerIsBetter?: boolean;
};

type LatestImpactfulPlay = {
  player: LiveGamePlayer;
  impact: NonNullable<LiveGamePlayer["lastMeaningfulImpact"]>;
  play: LiveGamePlay;
  periodRank: number | null;
  clockRemaining: number | null;
  playIndex: number;
  absDelta: number;
};

function parseClockRemaining(clock: string): number | null {
  const match = clock.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number.parseInt(match[1], 10);
  const seconds = Number.parseInt(match[2], 10);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds < 0 || seconds > 59) {
    return null;
  }
  return minutes * 60 + seconds;
}

function parsePeriodRank(period: string): number | null {
  const upper = period.toUpperCase();
  const otMatch = upper.match(/OT\s*(\d+)?/);
  if (otMatch) {
    const otNumber = otMatch[1] ? Number.parseInt(otMatch[1], 10) : 1;
    return 100 + (Number.isFinite(otNumber) ? otNumber : 1);
  }

  const numMatch = upper.match(/(\d+)/);
  if (!numMatch) return null;
  const periodNumber = Number.parseInt(numMatch[1], 10);
  return Number.isFinite(periodNumber) ? periodNumber : null;
}

function formatImpactRatingValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(1);
}

function formatTimeIso(isoString: string | null): string {
  if (!isoString) {
    return "-";
  }

  const date = new Date(isoString);
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  const ss = `${date.getSeconds()}`.padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function isPregameStatus(state?: string): boolean {
  const normalized = (state ?? "").toLowerCase();
  return normalized === "pre" || normalized === "pregame" || normalized === "scheduled";
}

function formatGameClockText(status?: {
  state?: string;
  periodLabel?: string;
  displayClock?: string;
}, startDateTime?: string): string {
  if (!status) {
    return "-";
  }

  const state = (status.state ?? "").toLowerCase();
  if (isPregameStatus(state)) {
    if (typeof startDateTime === "string" && startDateTime.length > 0) {
      const start = new Date(startDateTime);
      if (!Number.isNaN(start.getTime())) {
        return start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      }
    }
    return "Pregame";
  }

  if (state === "post" || state === "final" || state === "complete") {
    return "Final";
  }

  return `${status.periodLabel ?? "-"} - ${status.displayClock ?? "-"}`;
}

function formatScorebugMeta(startDateTime?: string, venue?: string): string {
  if (!startDateTime) {
    return venue ?? "";
  }

  const date = new Date(startDateTime);
  if (Number.isNaN(date.getTime())) {
    return venue ?? "";
  }

  const dateText = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return venue ? `${dateText} Ã¢â‚¬Â¢ ${venue}` : dateText;
}

function formatLiveRating(rating: number | null): string {
  if (rating === null || !Number.isFinite(rating)) {
    return "-";
  }

  return rating.toFixed(1);
}

function liveRatingColor(rating: number | null): string {
  return getInGameRatingColor(rating);
}

function isConferenceSideLabel(value: string | null | undefined): boolean {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+conference$/, "");
  return normalized === "eastern" || normalized === "western";
}

function teamDisplayName(team: LiveGameTeam | undefined, fallback: string): string {
  const candidates = [
    team?.shortDisplayName,
    team?.displayName,
    team?.abbreviation,
  ];
  return candidates.find((candidate) => candidate && !isConferenceSideLabel(candidate)) ?? fallback;
}

function teamCompactName(team: LiveGameTeam | undefined, fallback: string): string {
  const candidates = [
    team?.abbreviation,
    team?.shortDisplayName,
    team?.displayName,
  ];
  return candidates.find((candidate) => candidate && !isConferenceSideLabel(candidate)) ?? fallback;
}

function isResolvedTeamLogoUri(uri: string | undefined): boolean {
  if (typeof uri !== "string") {
    return false;
  }
  const trimmed = uri.trim();
  if (!trimmed || trimmed === FALLBACK_IMAGE_URI) {
    return false;
  }
  return trimmed.startsWith("https://");
}

function normalizeTeamLogoUri(uri: string | undefined): string {
  if (typeof uri !== "string") {
    return "";
  }
  const trimmed = uri.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("http://")) {
    return `https://${trimmed.slice("http://".length)}`;
  }
  return trimmed;
}

function isAnchorFrameNearlyEqual(
  a: CollapsibleScorebugAnchorFrame | undefined,
  b: CollapsibleScorebugAnchorFrame,
): boolean {
  if (!a) {
    return false;
  }
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function toStatNumber(value: string): number {
  const parsed = Number.parseFloat(value.replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareByLiveRating(a: LiveGamePlayer, b: LiveGamePlayer): number {
  const aRating = a.inGameRating10;
  const bRating = b.inGameRating10;

  if (aRating === null && bRating === null) {
    return 0;
  }
  if (aRating === null) {
    return 1;
  }
  if (bRating === null) {
    return -1;
  }

  return bRating - aRating;
}

function formatLastImpact(player: LiveGamePlayer): string {
  const impact = player.lastMeaningfulImpact;
  if (!impact) {
    return "Last impact: -";
  }

  const minutes = Math.floor(impact.clockSec / 60);
  const seconds = impact.clockSec % 60;
  const clock = `${minutes}:${`${seconds}`.padStart(2, "0")}`;
  const ratingBefore =
    impact.displayRatingBefore !== undefined
      ? impact.displayRatingBefore
      : impact.ratingBefore;
  const ratingAfter =
    impact.displayRatingAfter !== undefined
      ? impact.displayRatingAfter
      : impact.ratingAfter;
  const delta = impact.displayDelta !== undefined ? impact.displayDelta : impact.delta;
  const beforeText =
    typeof ratingBefore === "number" && Number.isFinite(ratingBefore)
      ? ratingBefore.toFixed(2)
      : "-";
  const afterText =
    typeof ratingAfter === "number" && Number.isFinite(ratingAfter)
      ? ratingAfter.toFixed(2)
      : "-";
  const deltaText =
    typeof delta === "number" && Number.isFinite(delta)
      ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`
      : "-";
  return `Last impact: ${player.name} - ${impact.description} - ${beforeText} -> ${afterText} (Delta ${deltaText}) [P${impact.period} ${clock}]`;
}

function leadColor(
  away: string,
  home: string,
  side: "away" | "home",
  lowerIsBetter = false,
): string {
  const awayValue = toStatNumber(away);
  const homeValue = toStatNumber(home);

  if (awayValue === homeValue) {
    return "#e6f1ff";
  }

  const awayLeads = lowerIsBetter ? awayValue < homeValue : awayValue > homeValue;
  const homeLeads = lowerIsBetter ? homeValue < awayValue : homeValue > awayValue;

  if ((side === "away" && awayLeads) || (side === "home" && homeLeads)) {
    return "#4fd38e";
  }

  return "#9ab3d5";
}

function TeamTotalsCard({ team }: { team: LiveGameTeam }) {
  const teamLogoUri = normalizeTeamLogoUri(team.logo) || FALLBACK_IMAGE_URI;
  return (
    <View style={styles.card}>
      <View style={styles.totalsHeader}>
        <TeamLogoLink teamId={team.id} uri={teamLogoUri} style={styles.totalsLogo} />
        <Text style={styles.cardTitle}>{teamDisplayName(team, "Team")}</Text>
      </View>
      <View style={styles.totalsGrid}>
        <View style={styles.totalCell}>
          <Text style={styles.totalLabel}>FG</Text>
          <Text style={styles.totalValue}>{team.totals.fg}</Text>
          <Text style={styles.totalSub}>{team.totals.fgPct}%</Text>
        </View>
        <View style={styles.totalCell}>
          <Text style={styles.totalLabel}>3PT</Text>
          <Text style={styles.totalValue}>{team.totals.threePt}</Text>
          <Text style={styles.totalSub}>{team.totals.threePtPct}%</Text>
        </View>
        <View style={styles.totalCell}>
          <Text style={styles.totalLabel}>FT</Text>
          <Text style={styles.totalValue}>{team.totals.ft}</Text>
          <Text style={styles.totalSub}>{team.totals.ftPct}%</Text>
        </View>
        <View style={styles.totalCell}>
          <Text style={styles.totalLabel}>REB</Text>
          <Text style={styles.totalValue}>{team.totals.rebounds}</Text>
        </View>
        <View style={styles.totalCell}>
          <Text style={styles.totalLabel}>AST</Text>
          <Text style={styles.totalValue}>{team.totals.assists}</Text>
        </View>
        <View style={styles.totalCell}>
          <Text style={styles.totalLabel}>TO</Text>
          <Text style={styles.totalValue}>{team.totals.turnovers}</Text>
        </View>
      </View>
    </View>
  );
}

function SnapshotCard({ away, home }: { away: LiveGameTeam; home: LiveGameTeam }) {
  const rows: SnapshotRowConfig[] = [
    { label: "FG%", away: away.totals.fgPct, home: home.totals.fgPct },
    { label: "3PT%", away: away.totals.threePtPct, home: home.totals.threePtPct },
    { label: "FT%", away: away.totals.ftPct, home: home.totals.ftPct },
    { label: "Rebounds", away: away.totals.rebounds, home: home.totals.rebounds },
    { label: "Assists", away: away.totals.assists, home: home.totals.assists },
    {
      label: "Turnovers",
      away: away.totals.turnovers,
      home: home.totals.turnovers,
      lowerIsBetter: true,
    },
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Game Snapshot</Text>
      {rows.map((row) => (
        <View key={row.label} style={styles.snapshotRow}>
          <Text
            style={[
              styles.snapshotValue,
              { color: leadColor(row.away, row.home, "away", row.lowerIsBetter) },
            ]}
          >
            {row.away}
          </Text>
          <Text style={styles.snapshotLabel}>{row.label}</Text>
          <Text
            style={[
              styles.snapshotValue,
              styles.snapshotValueRight,
              { color: leadColor(row.away, row.home, "home", row.lowerIsBetter) },
            ]}
          >
            {row.home}
          </Text>
        </View>
      ))}
    </View>
  );
}

function PlayerList({
  title,
  players,
  onSelect,
}: {
  title: string;
  players: LiveGamePlayer[];
  onSelect: (player: LiveGamePlayer) => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {players.length === 0 && <Text style={styles.placeholderText}>No player stats available.</Text>}
      {players.map((player) => (
        <Pressable key={player.id} style={styles.playerRow} onPress={() => onSelect(player)}>
          <View style={styles.playerNameWrap}>
            <Text style={styles.playerName} numberOfLines={1}>
              {player.name}
            </Text>
            <Text style={styles.playerMeta}>
              #{player.jersey || "-"} - {player.position || "-"} - MIN {player.minutesDisplay}
            </Text>
            <Text style={styles.playerImpact} numberOfLines={2}>
              {formatLastImpact(player)}
            </Text>
          </View>
          <View style={styles.playerStatPill}>
            <Text style={styles.playerPts}>{player.points}</Text>
            <Text style={styles.playerPtsLabel}>PTS</Text>
          </View>
          <View style={[styles.playerRatingPill, { backgroundColor: liveRatingColor(player.inGameRating10) }]}>
            <Text style={styles.playerRatingText}>{formatLiveRating(player.inGameRating10)}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function fallbackTheme(eventId: string): JerseyTheme {
  return {
    homeJersey: "#ffffff",
    awayJersey: "#111111",
    homeAccent: "#d9d9d9",
    awayAccent: "#2a2a2a",
    lineColor: "#111111",
    homeTint: "rgba(255, 255, 255, 0.10)",
    awayTint: "rgba(17, 17, 17, 0.10)",
    textOnHome: "#000000",
    textOnAway: "#FFFFFF",
    confidence: "low",
    reason: `fallback theme for ${eventId}`,
  };
}

export default function MatchDetailsScreen() {
  if (__DEV__) console.log("MATCH ID SOURCE ACTIVE");
  const renderStartRef = useRef(performance.now());
  renderStartRef.current = performance.now();

  const { mode: activeMode } = useGameModeState();
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const needsManualApiSetup = !apiBaseUrl;
  const isFocused = useIsFocused();
  const { gameId: gameIdParam, mode: routeMode } = useLocalSearchParams<{
    gameId?: string;
    mode?: GameMode;
  }>();

  const {
    gameId,
    data,
    loading,
    error,
    isOffline,
    isFromCache,
    isReconnecting,
    lastUpdated,
    refresh,
    setGameId,
    setPollingEnabled,
  } = useLiveGame();
  const resolvedMode =
    routeMode === "nba" || routeMode === "college" || routeMode === "baseball"
      ? routeMode
      : activeMode;

  const [healthStatus, setHealthStatus] = useState<"idle" | "ok" | "fail">("idle");
  const [healthErrorMessage, setHealthErrorMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showLists, setShowLists] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState<LiveGamePlayer | null>(null);
  const [isPlayerModalOpen, setIsPlayerModalOpen] = useState(false);
  const [overlayTheme, setOverlayTheme] = useState<JerseyTheme>(fallbackTheme(gameId));
  const [logosPrefetched, setLogosPrefetched] = useState(false);
  const [courtLogoReady, setCourtLogoReady] = useState(false);
  const [scorebugAnchorFrames, setScorebugAnchorFrames] = useState<{
    full?: CollapsibleScorebugAnchorFrame;
    compact?: CollapsibleScorebugAnchorFrame;
  }>({});
  const scrollRef = useRef<any>(null);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = Math.max(0, event.contentOffset.y);
    },
  });

  useEffect(() => {
    if (typeof gameIdParam === "string" && gameIdParam.length > 0) {
      setGameId(gameIdParam, resolvedMode);
    }
  }, [gameIdParam, resolvedMode, setGameId]);

  useEffect(() => {
    setLogosPrefetched(false);
    setCourtLogoReady(false);
  }, [gameId]);

  const checkApiHealth = useCallback(async () => {
    const result = await checkApiHealthOnce(apiBaseUrl);
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
  }, [apiBaseUrl]);

  useEffect(() => {
    checkApiHealth();
  }, [checkApiHealth]);

  useEffect(() => {
    if (!apiBaseUrl || healthStatus !== "ok") {
      setPollingEnabled(false);
      return;
    }
    setPollingEnabled(isFocused);
    return () => setPollingEnabled(false);
  }, [apiBaseUrl, healthStatus, isFocused, setPollingEnabled]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([checkApiHealth(), refresh()]);
    setRefreshing(false);
  };

  const openPlayerModal = (player: LiveGamePlayer) => {
    if (__DEV__) {
      console.log(`[timing] openPlayerModal (match screen) called ${player.id} @ ${performance.now().toFixed(1)}ms`);
      console.time(`[timing] player-modal-open:${player.id}`);
    }
    setSelectedPlayer(player);
    setIsPlayerModalOpen(true);
  };

  const closePlayerModal = () => {
    setIsPlayerModalOpen(false);
    setSelectedPlayer(null);
  };

  useEffect(() => {
    if (__DEV__) {
      const now = performance.now();
      console.log(
        `[timing] MatchDetailsScreen committed+painted isPlayerModalOpen=${isPlayerModalOpen} selectedPlayer=${selectedPlayer?.id ?? "none"} @ ${now.toFixed(1)}ms (this render body took ${(now - renderStartRef.current).toFixed(1)}ms)`,
      );
    }
  });

  const showSetupScreen = needsManualApiSetup || healthStatus === "fail";
  if (showSetupScreen) {
    return (
      <SafeAreaView edges={["top"]} style={styles.screen}>
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
      </SafeAreaView>
    );
  }

  const teams = data?.teams ?? [];
  const isBaseball = data?.sport === "baseball";
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];

  useEffect(() => {
    if (!data) {
      setOverlayTheme(fallbackTheme(gameId));
      return;
    }
    const homeTeam = data.teams.find((team) => team.homeAway === "home") ?? data.teams[1] ?? data.teams[0];
    const awayTeam = data.teams.find((team) => team.homeAway === "away") ?? data.teams[0] ?? data.teams[1];
    if (!homeTeam || !awayTeam) {
      setOverlayTheme(fallbackTheme(data.eventId));
      return;
    }
    setOverlayTheme(
      getJerseyTheme({
        eventId: data.eventId,
        home: {
          id: homeTeam.id,
          abbreviation: homeTeam.abbreviation ?? homeTeam.shortDisplayName,
          color: homeTeam.color,
          alternateColor: homeTeam.alternateColor,
        },
        away: {
          id: awayTeam.id,
          abbreviation: awayTeam.abbreviation ?? awayTeam.shortDisplayName,
          color: awayTeam.color,
          alternateColor: awayTeam.alternateColor,
        },
      }),
    );
  }, [data, gameId]);

  const playersByTeam = data?.playersByTeam ?? {};
  const awayPlayers = useMemo(
    () => (away ? [...(playersByTeam[away.id] ?? [])].sort(compareByLiveRating) : []),
    [away, playersByTeam],
  );
  const homePlayers = useMemo(
    () => (home ? [...(playersByTeam[home.id] ?? [])].sort(compareByLiveRating) : []),
    [home, playersByTeam],
  );
  const latestImpactfulPlay = useMemo<LatestImpactfulPlay | null>(() => {
    if (!data) {
      return null;
    }

    const plays = data.plays ?? [];
    if (plays.length === 0) {
      return null;
    }

    const candidates: LatestImpactfulPlay[] = [];
    Object.values(playersByTeam).forEach((teamPlayers) => {
      teamPlayers.forEach((player) => {
        const impact = player.lastMeaningfulImpact;
        if (!impact) {
          return;
        }

        const matchingPlayIndex = plays.findIndex(
          (play) => play.id === impact.eventId || impact.eventId.startsWith(`${play.id}:`),
        );
        if (matchingPlayIndex < 0) {
          return;
        }

        const matchingPlay = plays[matchingPlayIndex];
        const resolvedDelta = impact.displayDelta ?? impact.delta;
        const absDelta =
          typeof resolvedDelta === "number" && Number.isFinite(resolvedDelta) ? Math.abs(resolvedDelta) : 0;

        candidates.push({
          player,
          impact,
          play: matchingPlay,
          periodRank: parsePeriodRank(matchingPlay.period),
          clockRemaining: parseClockRemaining(matchingPlay.clock),
          playIndex: matchingPlayIndex,
          absDelta,
        });
      });
    });

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => {
      if (a.periodRank !== null && b.periodRank !== null && a.periodRank !== b.periodRank) {
        return b.periodRank - a.periodRank;
      }
      if (a.periodRank !== null && b.periodRank === null) return -1;
      if (a.periodRank === null && b.periodRank !== null) return 1;

      if (a.clockRemaining !== null && b.clockRemaining !== null && a.clockRemaining !== b.clockRemaining) {
        return a.clockRemaining - b.clockRemaining;
      }
      if (a.clockRemaining !== null && b.clockRemaining === null) return -1;
      if (a.clockRemaining === null && b.clockRemaining !== null) return 1;

      if (a.playIndex !== b.playIndex) {
        return b.playIndex - a.playIndex;
      }

      return b.absDelta - a.absDelta;
    });

    return candidates[0];
  }, [data, playersByTeam]);

  const momentumPoints = useMemo(
    () =>
      (data?.winProbability ?? []).map((point) => ({
        t: point.time,
        v: (point.homeWinProb - 0.5) * 2,
      })),
    [data?.winProbability],
  );

  const momentumEvents = useMemo(() => {
    const rows = data?.keyEvents ?? [];
    const total = Math.max(1, rows.length - 1);
    return rows.slice(-24).map((event, index) => ({
      t: (index / total) * Math.max(1, momentumPoints.length - 1),
      type:
        event.eventType === "foul"
          ? "foul"
          : event.eventType === "timeout"
            ? "timeout"
            : event.eventType === "substitution"
              ? "sub"
              : "score",
      team: event.description.toLowerCase().includes("home") ? "home" : "away",
    })) as Array<{
      t: number;
      type: "score" | "foul" | "timeout" | "sub";
      team: "home" | "away";
    }>;
  }, [data?.keyEvents, momentumPoints.length]);

  const clockText = formatGameClockText(data?.status, data?.meta?.startDateTime);
  const scorebugMetaText = isPregameStatus(data?.status.state)
    ? ""
    : formatScorebugMeta(data?.meta?.startDateTime, data?.meta?.venue);
  const awayLogoUri = normalizeTeamLogoUri(away?.logo) || FALLBACK_IMAGE_URI;
  const homeLogoUri = normalizeTeamLogoUri(home?.logo) || FALLBACK_IMAGE_URI;
  const hasTeamsLoaded = Boolean(away && home);
  const hasTeamLogosLoaded = Boolean(
    away &&
      home &&
      isResolvedTeamLogoUri(awayLogoUri) &&
      isResolvedTeamLogoUri(homeLogoUri),
  );
  const hasPlayersLoaded = Boolean(
    away &&
      home &&
      Array.isArray(playersByTeam[away.id]) &&
      Array.isArray(playersByTeam[home.id]),
  );
  const hasCorePayload = Boolean(data) && hasTeamsLoaded && hasPlayersLoaded;
  useEffect(() => {
    let cancelled = false;

    if (!hasCorePayload || !hasTeamLogosLoaded) {
      setLogosPrefetched(false);
      return () => {
        cancelled = true;
      };
    }

    const prefetch = async () => {
      try {
        const [awayReady, homeReady] = await Promise.all([
          Image.prefetch(awayLogoUri),
          Image.prefetch(homeLogoUri),
        ]);
        if (!cancelled) {
          setLogosPrefetched(awayReady && homeReady);
        }
      } catch {
        if (!cancelled) {
          setLogosPrefetched(false);
        }
      }
    };

    void prefetch();
    return () => {
      cancelled = true;
    };
  }, [awayLogoUri, hasCorePayload, hasTeamLogosLoaded, homeLogoUri]);
  const requiresCourtLogoReady = hasCorePayload && !isBaseball;
  const hasVisualAssetsReady =
    hasTeamLogosLoaded &&
    logosPrefetched &&
    (!requiresCourtLogoReady || courtLogoReady);
  const shouldShowGameLoader =
    !error && (loading || !hasCorePayload || !hasVisualAssetsReady);
  const scorebugGame = useMemo<CollapsibleScorebugGameData>(
    () => ({
      away: {
        label: teamDisplayName(away, "Away"),
        compactLabel: teamCompactName(away, "AWY"),
        logoUri: awayLogoUri,
      },
      home: {
        label: teamDisplayName(home, "Home"),
        compactLabel: teamCompactName(home, "HME"),
        logoUri: homeLogoUri,
      },
      awayScore: away?.score ?? "-",
      homeScore: home?.score ?? "-",
      metaText: scorebugMetaText,
      statusText: clockText,
    }),
    [away, away?.score, awayLogoUri, clockText, home, home?.score, homeLogoUri, scorebugMetaText],
  );

  const onCompactScorebugPress = useCallback(() => {
    scrollRef.current?.scrollTo?.({ y: 0, animated: true });
  }, []);
  const onScorebugAnchorMeasured = useCallback(
    (measurement: CollapsibleScorebugAnchorMeasurement) => {
      setScorebugAnchorFrames((prev) => {
        const current = prev[measurement.mode];
        if (isAnchorFrameNearlyEqual(current, measurement.frame)) {
          return prev;
        }
        return {
          ...prev,
          [measurement.mode]: measurement.frame,
        };
      });
    },
    [],
  );
  const scorebugAnchorTransform = useMemo<CollapsibleScorebugAnchorTransform | undefined>(() => {
    const fullAnchor = scorebugAnchorFrames.full;
    const compactAnchor = scorebugAnchorFrames.compact;
    if (!fullAnchor || !compactAnchor) {
      return undefined;
    }

    const fullCenterX = fullAnchor.x + fullAnchor.width * 0.5;
    const fullCenterY = fullAnchor.y + fullAnchor.height * 0.5;
    const compactCenterX = compactAnchor.x + compactAnchor.width * 0.5;
    const compactCenterY = compactAnchor.y + compactAnchor.height * 0.5;
    const rawScaleRatio = fullAnchor.width > 0 ? compactAnchor.width / fullAnchor.width : 0.84;

    return {
      deltaX: compactCenterX - fullCenterX,
      deltaY: compactCenterY - fullCenterY,
      scaleRatio: Math.max(0.65, Math.min(1, rawScaleRatio)),
    };
  }, [scorebugAnchorFrames.compact, scorebugAnchorFrames.full]);

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      {__DEV__ ? (
        <View pointerEvents="none" style={styles.uiTestBanner}>
          <Text style={styles.uiTestBannerText}>MATCH ID SOURCE ACTIVE</Text>
        </View>
      ) : null}

      <View style={styles.scrollHost}>
        <CollapsibleScorebug
          mode="compact"
          game={scorebugGame}
          scrollY={scrollY}
          onPress={onCompactScorebugPress}
          onAnchorMeasured={onScorebugAnchorMeasured}
        />
        <Animated.ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          onScroll={onScroll}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
        >
          <CollapsibleScorebug
            mode="full"
            game={scorebugGame}
            scrollY={scrollY}
            onAnchorMeasured={onScorebugAnchorMeasured}
            anchorTransform={scorebugAnchorTransform}
          />

        {isOffline && (
          <View style={styles.card}>
            <Text style={styles.placeholderText}>
              {isFromCache ? "Offline: showing cached data." : "Offline mode active."}
            </Text>
          </View>
        )}

        {/* Subtle, non-alarming signal that live updates have gone quiet
            longer than expected — the hook is already auto-retrying in the
            background (see the watchdog in useLiveGame), this is purely
            user feedback so a stalled screen doesn't look identical to a
            healthy quiet moment in the game. Suppressed while the louder
            isOffline banner is already showing to avoid stacking two
            messages that say roughly the same thing. */}
        {isReconnecting && !isOffline && (
          <View style={styles.card}>
            <Text style={styles.placeholderText}>Reconnecting…</Text>
          </View>
        )}

        {error && (
          <View style={styles.card}>
            <Text style={styles.placeholderText}>{error}</Text>
            <GlassButton onPress={refresh} label="Retry" variant="primary" size="sm" />
          </View>
        )}

        {data && (
          <>
            <View style={styles.courtOverlayWrap}>
              {isBaseball ? (
                <BaseballFieldOutline variant="game" />
              ) : (
                <CourtOverlay
                  key={`${data.eventId}-${overlayTheme.homeJersey}-${overlayTheme.awayJersey}`}
                  teams={teams}
                  playersByTeam={playersByTeam}
                  onPlayerPress={openPlayerModal}
                  theme={overlayTheme}
                  homeLogoUri={homeLogoUri}
                  onHomeLogoReadyChange={setCourtLogoReady}
                  showSeating
                />
              )}
            </View>

            <View style={[styles.card, styles.impactCard]}>
              <View style={styles.impactHeaderRow}>
                <Text style={styles.impactTitle}>Last Impactful Play</Text>
                <View style={styles.impactBadge}>
                  <Text style={styles.impactBadgeText}>Live Impact</Text>
                </View>
              </View>

              {latestImpactfulPlay ? (
                <View style={styles.impactLine}>
                  <Text style={styles.impactPlayText} numberOfLines={1}>
                    {latestImpactfulPlay.play.text}
                  </Text>
                  <View
                    style={[
                      styles.impactRatingPill,
                      {
                        backgroundColor: getInGameRatingColor(
                          latestImpactfulPlay.impact.displayRatingBefore ??
                            latestImpactfulPlay.impact.ratingBefore,
                        ),
                      },
                    ]}
                  >
                    <Text style={styles.impactRatingPillText}>
                      {formatImpactRatingValue(
                        latestImpactfulPlay.impact.displayRatingBefore ??
                          latestImpactfulPlay.impact.ratingBefore,
                      )}
                    </Text>
                  </View>
                  <Text style={styles.impactArrow}>{"->"}</Text>
                  <View
                    style={[
                      styles.impactRatingPill,
                      {
                        backgroundColor: getInGameRatingColor(
                          latestImpactfulPlay.impact.displayRatingAfter ??
                            latestImpactfulPlay.impact.ratingAfter,
                        ),
                      },
                    ]}
                  >
                    <Text style={styles.impactRatingPillText}>
                      {formatImpactRatingValue(
                        latestImpactfulPlay.impact.displayRatingAfter ??
                          latestImpactfulPlay.impact.ratingAfter,
                      )}
                    </Text>
                  </View>
                  <Text style={styles.impactMeta} numberOfLines={1}>
                    {latestImpactfulPlay.play.period || `P${latestImpactfulPlay.impact.period}`}{" "}
                    {latestImpactfulPlay.play.clock || "-"} | {latestImpactfulPlay.play.awayScore || "-"}-
                    {latestImpactfulPlay.play.homeScore || "-"}
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={styles.impactEmptyTitle}>No impactful play yet</Text>
                  <Text style={styles.impactEmptySubtext}>Waiting for a rating-changing event.</Text>
                </>
              )}
            </View>

            <MomentumTopStatsCard
              title="Momentum"
              timelineLabels={{ start: "Q1", mid: "HT", end: "Final" }}
              momentumPoints={momentumPoints.length > 0 ? momentumPoints : mockMomentumData.momentumPoints}
              startDateTime={data.meta.startDateTime}
              events={momentumEvents.length > 0 ? momentumEvents : mockMomentumData.events}
              topBar={{
                label: "Win probability",
                homePct: (data.winProbability.at(-1)?.homeWinProb ?? 0.61) * 100,
                awayPct: 100 - (data.winProbability.at(-1)?.homeWinProb ?? 0.61) * 100,
              }}
              statRows={[]}
              homeTeam={{
                id: home?.id ?? "home",
                name: teamCompactName(home, "Home"),
                color: home?.color ?? "#3da5ff",
                alternateColor: home?.alternateColor ?? null,
              }}
              awayTeam={{
                id: away?.id ?? "away",
                name: teamCompactName(away, "Away"),
                color: away?.color ?? "#f45a7a",
                alternateColor: away?.alternateColor ?? null,
              }}
              isLive={data.status.state === "in"}
            />

            {away && home && <SnapshotCard away={away} home={home} />}
            {away && <TeamTotalsCard team={away} />}
            {home && <TeamTotalsCard team={home} />}

            <View style={styles.card}>
              <View style={styles.topRow}>
                <Text style={styles.cardTitle}>Full player list</Text>
                <GlassButton
                  onPress={() => setShowLists((prev) => !prev)}
                  style={styles.listToggleButton}
                  label={showLists ? "Collapse" : "Expand"}
                  size="sm"
                  variant="secondary"
                />
              </View>
            </View>

            {showLists && (
              <>
                <PlayerList
                  title={`${teamDisplayName(away, "Away")} Player Stats`}
                  players={awayPlayers}
                  onSelect={openPlayerModal}
                />
                <PlayerList
                  title={`${teamDisplayName(home, "Home")} Player Stats`}
                  players={homePlayers}
                  onSelect={openPlayerModal}
                />
              </>
            )}
          </>
        )}

        <View style={styles.card}>
          <Text style={styles.metaText}>Last updated: {formatTimeIso(lastUpdated)}</Text>
        </View>
        </Animated.ScrollView>
      </View>

      {shouldShowGameLoader ? (
        <View style={styles.loadingOverlay} pointerEvents="auto">
          <View style={styles.loadingTopCopy}>
            <Text style={styles.loadingTitle}>Loading game</Text>
            <Text style={styles.loadingSubtitle}>
              Loading team logos, court assets, player lists, and live game data.
            </Text>
          </View>
          <View style={styles.loadingSkeletonStack}>
            <SkeletonText width="58%" height={28} />
            <SkeletonText width="42%" height={16} />
            <SkeletonCard rows={3} />
            <SkeletonCard rows={4} />
            <SkeletonCard rows={4} />
          </View>
        </View>
      ) : null}

      <PlayerModal visible={isPlayerModalOpen} player={selectedPlayer} onClose={closePlayerModal} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  uiTestBanner: {
    position: "absolute",
    top: 8,
    left: 8,
    zIndex: 9999,
    backgroundColor: "#ff2d55",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  uiTestBannerText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
  },
  scrollHost: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    elevation: 999,
    backgroundColor: "rgba(8, 17, 28, 0.98)",
    paddingHorizontal: 14,
    paddingVertical: 24,
  },
  loadingTopCopy: {
    flexShrink: 0,
  },
  loadingTitle: {
    color: "#f2f7ff",
    fontSize: 18,
    fontWeight: "800",
  },
  loadingSubtitle: {
    marginTop: 6,
    color: "#b2c7e0",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  loadingSkeletonStack: {
    marginTop: 14,
    gap: 12,
  },
  swipeLayer: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 8,
    paddingTop: 0,
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  courtOverlayWrap: {
    position: "relative",
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  totalsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  totalsLogo: {
    width: 20,
    height: 20,
  },
  totalsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  totalCell: {
    width: "30%",
    borderRadius: 10,
    backgroundColor: colors.cardSoft,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  totalLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
  },
  totalValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 3,
  },
  totalSub: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: "600",
    marginTop: 1,
  },
  snapshotRow: {
    borderRadius: 10,
    backgroundColor: colors.cardSoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  snapshotLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  snapshotValue: {
    minWidth: 52,
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  snapshotValueRight: {
    textAlign: "right",
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    backgroundColor: colors.cardSoft,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 8,
  },
  playerNameWrap: {
    flex: 1,
    gap: 2,
  },
  playerName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  playerMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  playerImpact: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "600",
  },
  impactCard: {
    borderWidth: 1,
    borderColor: "#2f4666",
    backgroundColor: colors.card,
    gap: 10,
  },
  impactHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  impactTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  impactBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "#1e3550",
  },
  impactBadgeText: {
    color: "#9ed0ff",
    fontSize: 10,
    fontWeight: "800",
  },
  impactLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  impactRatingPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  impactRatingPillText: {
    color: "#102131",
    fontSize: 11,
    fontWeight: "800",
  },
  impactPlayText: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  impactArrow: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
  },
  impactMeta: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "600",
  },
  impactEmptyTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  impactEmptySubtext: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  playerStatPill: {
    minWidth: 48,
    borderRadius: 10,
    backgroundColor: "#2e3f59",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  playerPts: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  playerPtsLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: "700",
  },
  playerRatingPill: {
    borderRadius: 999,
    backgroundColor: "#f6c85f",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  playerRatingText: {
    color: "#102131",
    fontSize: 11,
    fontWeight: "800",
  },
  listToggleButton: {
    borderRadius: 8,
    backgroundColor: "#e9f2ff",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  listToggleButtonText: {
    color: "#13263d",
    fontSize: 12,
    fontWeight: "800",
  },
  retryButton: {
    alignSelf: "flex-start",
    borderRadius: 8,
    backgroundColor: "#f0f5ff",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  retryText: {
    color: "#122338",
    fontSize: 12,
    fontWeight: "800",
  },
  metaText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
  },
});



