import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  FadeInUp,
  Layout,
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { periodShortLabel } from "@/components/game/PointDifferentialChart";
import {
  getStickyHeaderExpandedHeight,
  IN_GAME_HEADER_COLLAPSE_RANGE,
} from "@/components/ui/inGameHeaderMetrics";
import TabContentSkeleton from "@/components/loading/TabContentSkeleton";
import ExpandableSection from "@/components/ui/ExpandableSection";
import FireRingGlow, { isPlayerOnFire } from "@/components/ui/FireRingGlow";
import type { LiveGamePlay, LiveGamePlayer } from "@/hooks/useLiveGame";
import { getPeriodTimingForMode, useLiveGame } from "@/hooks/useLiveGame";
import { isImpactClutchContext, type GameContext } from "@/apps/mobile/src/ratings/impactRating";
import { buildHighlightClusters } from "@/src/features/recap/highlightReel";
import { useAiGameSummary } from "@/src/features/summary/aiGameSummary";
import { normalizeRemoteUri, TRANSPARENT_FALLBACK_IMAGE_URI } from "@/src/loading/bootstrapAssets";
import { useSettingsState } from "@/src/settings/SettingsContext";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { consumePendingPlayHighlight } from "@/src/ui/inGamePlayHighlight";
import { useInGameHeaderScroll } from "@/src/ui/inGameHeaderScrollContext";
import { resolveInGameSectionIds } from "@/src/ui/inGameSectionLayouts";
import { useInGamePlayerModal } from "@/src/ui/inGamePlayerModalContext";
import { useRegisterInGameSections } from "@/src/ui/useRegisterInGameSections";
import { getInGameRatingColor } from "@/theme/colors";

// Large enough to distinguish a real rating-swing play from routine
// possession-to-possession noise (most single-play deltas are 0.1-0.2).
const SIGNIFICANT_RATING_SWING = 0.3;
// Percentage points of home win-probability movement needed for the compact
// win-prob indicator to call attention to itself instead of sitting quiet.
const SIGNIFICANT_WIN_PROB_SWING_PCT = 3;

const PLAY_HIGHLIGHT_FADE_MS = 1500;

// A new play arriving via live poll slides down + fades in over this long;
// existing rows shift to make room over the same rough window, so the two
// read as one fluid push-down rather than a new item popping in and a
// separate, differently-timed reflow.
const PLAY_ENTER_DURATION_MS = 320;
const PLAY_LAYOUT_SHIFT_DURATION_MS = 300;
const newPlayEnteringAnimation = FadeInUp.duration(PLAY_ENTER_DURATION_MS);
const playRowLayoutTransition = Layout.duration(PLAY_LAYOUT_SHIFT_DURATION_MS);

type IndexedPlay = {
  play: LiveGamePlay;
  index: number;
  periodRank: number | null;
  clockRemaining: number | null;
};

type PlayFeedItem =
  | {
      key: string;
      kind: "header";
      period: string;
    }
  | {
      key: string;
      kind: "play";
      play: LiveGamePlay;
    };

type PlayTypeInfo = {
  title: string;
  kind:
    | "scoring"
    | "foul"
    | "turnover"
    | "substitution"
    | "rebound"
    | "timeout"
    | "other"
    // Non-play markers (end/start of period, end of game) — rendered as a
    // plain centered divider breaking the timeline, never a dot or a card.
    | "system";
  points?: number;
};

type PlayPlayerCard = {
  key: string;
  player: LiveGamePlayer;
  label: string;
};

type PlayRatingChange = {
  key: string;
  player: LiveGamePlayer;
  before: number | null;
  after: number | null;
  delta: number | null;
};

function parseClockRemaining(clock: string): number | null {
  const match = clock.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
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
  if (!numMatch) {
    return null;
  }
  const periodNumber = Number.parseInt(numMatch[1], 10);
  return Number.isFinite(periodNumber) ? periodNumber : null;
}

function parsePeriodClockToElapsedSeconds(periodLabelRaw: string, clockRaw: string): number | null {
  const periodMatch = periodLabelRaw.match(/(\d+)/);
  if (!periodMatch) {
    return null;
  }

  const period = Number.parseInt(periodMatch[1], 10);
  if (!Number.isFinite(period) || period <= 0) {
    return null;
  }

  const [mRaw, sRaw] = clockRaw.split(":");
  const minutes = Number.parseInt(mRaw ?? "", 10);
  const seconds = Number.parseInt(sRaw ?? "", 10);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }

  const regulationPeriodSeconds = 20 * 60;
  const overtimeSeconds = 5 * 60;
  const elapsedCurrent = Math.max(0, regulationPeriodSeconds - (minutes * 60 + seconds));

  if (period <= 2) {
    return (period - 1) * regulationPeriodSeconds + elapsedCurrent;
  }

  return (
    2 * regulationPeriodSeconds +
    (period - 3) * overtimeSeconds +
    Math.max(0, overtimeSeconds - (minutes * 60 + seconds))
  );
}

function withAlpha(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `rgba(0,0,0,${alpha})`;
  }
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function normalizeTeamColor(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function getTeamLogoUri(uri: string | undefined): string {
  return normalizeRemoteUri(uri) || TRANSPARENT_FALLBACK_IMAGE_URI;
}

function normalizeForMatch(value: string | undefined | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findPlayPlayer(play: LiveGamePlay, teamPlayers: LiveGamePlayer[]): LiveGamePlayer | null {
  if (teamPlayers.length === 0) {
    return null;
  }

  const normalizedText = normalizeForMatch(play.text);
  if (!normalizedText) {
    return null;
  }

  const matches = teamPlayers.filter((player) => {
    const fullName = normalizeForMatch(player.name);
    const lastName = normalizeForMatch(player.lastName);
    const shortName = normalizeForMatch(player.shortName);
    return (
      (fullName.length > 0 && normalizedText.includes(fullName)) ||
      (shortName.length > 0 && normalizedText.includes(shortName)) ||
      (lastName.length > 2 && normalizedText.includes(lastName))
    );
  });

  if (matches.length === 0) {
    return null;
  }

  return [...matches].sort((left, right) => {
    const leftName = normalizeForMatch(left.name).length;
    const rightName = normalizeForMatch(right.name).length;
    if (rightName !== leftName) {
      return rightName - leftName;
    }
    return (right.inGameRating10 ?? -1) - (left.inGameRating10 ?? -1);
  })[0] ?? null;
}

function findPlayerByNameText(
  text: string,
  players: LiveGamePlayer[],
  excludedIds = new Set<string>(),
): LiveGamePlayer | null {
  const normalizedText = normalizeForMatch(text);
  if (!normalizedText) {
    return null;
  }

  const matches = players.filter((player) => {
    if (excludedIds.has(player.id)) {
      return false;
    }
    const fullName = normalizeForMatch(player.name);
    const lastName = normalizeForMatch(player.lastName);
    const shortName = normalizeForMatch(player.shortName);
    return (
      (fullName.length > 0 && normalizedText.includes(fullName)) ||
      (shortName.length > 0 && normalizedText.includes(shortName)) ||
      (lastName.length > 2 && normalizedText.includes(lastName))
    );
  });

  if (matches.length === 0) {
    return null;
  }

  return [...matches].sort((left, right) => {
    const leftName = normalizeForMatch(left.name).length;
    const rightName = normalizeForMatch(right.name).length;
    if (rightName !== leftName) {
      return rightName - leftName;
    }
    return (right.inGameRating10 ?? -1) - (left.inGameRating10 ?? -1);
  })[0] ?? null;
}

function parseSubstitutionText(text: string): { inPlayer: string; outPlayer: string } | null {
  const lower = text.toLowerCase();
  if (!lower.includes("substitution") && !lower.includes("enters") && !lower.includes("checks in")) {
    return null;
  }

  const inForMatch = text.match(/(.+?)\s+in\s+for\s+(.+)/i);
  if (inForMatch) {
    return {
      inPlayer: inForMatch[1].replace(/substitution[:\s-]*/i, "").trim(),
      outPlayer: inForMatch[2].trim(),
    };
  }

  const normalizedMatch = text.match(/(.+?)\s+IN\s+[-–]\s+(.+?)\s+OUT/i);
  if (normalizedMatch) {
    return {
      inPlayer: normalizedMatch[1].trim(),
      outPlayer: normalizedMatch[2].trim(),
    };
  }

  return null;
}

function getPlayTypeInfo(play: LiveGamePlay): PlayTypeInfo {
  const text = play.text.toLowerCase();
  // Non-play markers — "End of 4th Quarter", "End of Game", "Start of 2nd
  // Quarter" — aren't something that happened on the floor, so they get
  // pulled out of the timeline entirely (see the "system" render path).
  if (text.startsWith("end of") || text.startsWith("start of")) {
    return { title: play.text, kind: "system" };
  }
  if (text.includes("substitution") || text.includes("enters") || text.includes("checks in")) {
    return { title: "Substitution", kind: "substitution" };
  }
  if (text.includes("foul") || text.includes("technical") || text.includes("flagrant")) {
    if (text.includes("shooting")) return { title: "Shooting Foul", kind: "foul" };
    if (text.includes("personal")) return { title: "Personal Foul", kind: "foul" };
    if (text.includes("technical")) return { title: "Technical Foul", kind: "foul" };
    return { title: "Foul", kind: "foul" };
  }
  if (text.includes("turnover") || text.includes("bad pass") || text.includes("travel")) {
    return { title: "Turnover", kind: "turnover" };
  }
  if (text.includes("steal")) {
    return { title: "Steal", kind: "other" };
  }
  if (text.includes("block")) {
    return { title: "Block", kind: "other" };
  }
  if (text.includes("rebound")) {
    return { title: "Rebound", kind: "rebound" };
  }
  if (text.includes("timeout") || text.includes("time-out")) {
    return { title: "Timeout", kind: "timeout" };
  }
  if (play.scoringPlay || text.includes("makes")) {
    const points = text.includes("free throw") ? 1 : text.includes("3-pt") || text.includes("three") ? 3 : 2;
    return { title: `+${points} ${points === 1 ? "Point" : "Points"}`, kind: "scoring", points };
  }
  if (text.includes("misses")) {
    return { title: "Missed Shot", kind: "scoring" };
  }
  return { title: "Play", kind: "other" };
}

function getAssistText(playText: string): string | null {
  const parentheticalAssistMatch = playText.match(/\(([^()]+?)\s+assists?\)/i);
  if (parentheticalAssistMatch?.[1]) {
    return parentheticalAssistMatch[1].trim();
  }

  const assistedByMatch = playText.match(/assisted by\s+([^)\\.]+)/i);
  if (assistedByMatch?.[1]) {
    return assistedByMatch[1].trim();
  }

  const assistsMatch = playText.match(/assists?:\s*([^)\\.]+)/i);
  return assistsMatch?.[1]?.trim() ?? null;
}

function getPrimaryScoringText(playText: string): string {
  return playText
    .replace(/\([^)]*assists?[^)]*\)/i, "")
    .replace(/assisted by.+$/i, "")
    .trim();
}

function getFoulLabel(playText: string): string {
  const lower = playText.toLowerCase();
  if (lower.includes("technical")) return "Technical foul";
  if (lower.includes("flagrant")) return "Flagrant foul";
  if (lower.includes("shooting")) return "Shooting foul";
  if (lower.includes("personal")) return "Personal foul";
  return "Foul";
}

function resolveTimelineRatingForPlay(player: LiveGamePlayer, play: LiveGamePlay): number | null {
  const elapsedSec = parsePeriodClockToElapsedSeconds(play.period, play.clock);
  const timeline = (player.ratingTimelinePoints ?? [])
    .filter((point) => Number.isFinite(point.tSec) && Number.isFinite(point.rating))
    .sort((left, right) => left.tSec - right.tSec);

  if (timeline.length === 0) {
    return player.inGameRating10 ?? null;
  }

  if (elapsedSec === null) {
    return timeline[timeline.length - 1]?.rating ?? player.inGameRating10 ?? null;
  }

  let resolved = timeline[0]?.rating ?? null;
  for (const point of timeline) {
    if (point.tSec > elapsedSec) {
      break;
    }
    resolved = point.rating;
  }

  return typeof resolved === "number" && Number.isFinite(resolved)
    ? Number(resolved.toFixed(1))
    : player.inGameRating10 ?? null;
}

function createPlayMomentPlayer(player: LiveGamePlayer, play: LiveGamePlay): LiveGamePlayer {
  return {
    ...player,
    inGameRating10: resolveTimelineRatingForPlay(player, play),
    gameRating: resolveTimelineRatingForPlay(player, play),
    liveDisplay: resolveTimelineRatingForPlay(player, play) ?? "-",
  };
}

function findWinProbabilityForPlay(
  play: LiveGamePlay,
  winProbability: NonNullable<ReturnType<typeof useLiveGame>["data"]>["winProbability"],
) {
  if (winProbability.length === 0) {
    return null;
  }

  const elapsedSec = parsePeriodClockToElapsedSeconds(play.period, play.clock);
  if (elapsedSec === null) {
    return winProbability[winProbability.length - 1] ?? null;
  }

  return [...winProbability].sort(
    (left, right) => Math.abs(left.time - elapsedSec) - Math.abs(right.time - elapsedSec),
  )[0] ?? null;
}

function buildExpandedPlayerCards({
  play,
  playType,
  allPlayers,
  teamPlayers,
}: {
  play: LiveGamePlay;
  playType: PlayTypeInfo;
  allPlayers: LiveGamePlayer[];
  teamPlayers: LiveGamePlayer[];
}): PlayPlayerCard[] {
  if (playType.kind === "system") {
    return [];
  }

  if (playType.kind === "substitution") {
    const parsed = parseSubstitutionText(play.text);
    if (!parsed) {
      return [];
    }
    const subIn = findPlayerByNameText(parsed.inPlayer, allPlayers);
    const subOut = findPlayerByNameText(parsed.outPlayer, allPlayers, new Set(subIn ? [subIn.id] : []));
    return [
      subIn ? { key: `${play.id}:sub-in`, player: subIn, label: "Sub in" } : null,
      subOut ? { key: `${play.id}:sub-out`, player: subOut, label: "Sub out" } : null,
    ].filter((entry): entry is PlayPlayerCard => Boolean(entry));
  }

  if (playType.kind === "foul") {
    const foulingPlayer = findPlayPlayer(play, teamPlayers) ?? findPlayerByNameText(play.text, allPlayers);
    return foulingPlayer
      ? [{ key: `${play.id}:foul`, player: foulingPlayer, label: getFoulLabel(play.text) }]
      : [];
  }

  if (playType.kind === "scoring" && (play.scoringPlay || playType.points)) {
    const scorerText = getPrimaryScoringText(play.text);
    const scorer =
      findPlayerByNameText(scorerText, teamPlayers) ??
      findPlayerByNameText(scorerText, allPlayers) ??
      findPlayPlayer(play, teamPlayers) ??
      findPlayerByNameText(play.text, allPlayers);
    const assistText = getAssistText(play.text);
    const assister =
      assistText && scorer
        ? findPlayerByNameText(assistText, allPlayers, new Set([scorer.id]))
        : assistText
          ? findPlayerByNameText(assistText, allPlayers)
          : null;
    return [
      scorer
        ? {
            key: `${play.id}:scorer`,
            player: scorer,
            label: playType.points ? `+${playType.points} PTS` : "Score",
          }
        : null,
      assister ? { key: `${play.id}:assist`, player: assister, label: "AST" } : null,
    ].filter((entry): entry is PlayPlayerCard => Boolean(entry));
  }

  // Timeouts are a team-level event with no specific player to show.
  if (playType.kind === "timeout") {
    return [];
  }

  // Every remaining play kind — missed shots (scoring plays that didn't go
  // in), rebounds, turnovers, steals, blocks, and anything else — gets the
  // same photo treatment as scoring/foul/substitution plays instead of
  // rendering text-only, so every play type is consistent.
  const actor = findPlayPlayer(play, teamPlayers) ?? findPlayerByNameText(play.text, allPlayers);
  return actor ? [{ key: `${play.id}:actor`, player: actor, label: playType.title }] : [];
}

type PlayPlayerCardWithDelta = PlayPlayerCard & { delta: number | null };

// Attaches each player card's rating-delta pill (if this play changed their
// rating) by matching on player id. Any rating change whose player ISN'T
// already one of the play's cards (rare — e.g. a leadership-driven shift on
// a teammate) still gets its own compact card rather than being silently
// dropped.
function mergePlayerCardsWithRatingChanges(
  playerCards: PlayPlayerCard[],
  ratingChanges: PlayRatingChange[],
): PlayPlayerCardWithDelta[] {
  const deltaByPlayerId = new Map(ratingChanges.map((change) => [change.player.id, change.delta]));
  const usedPlayerIds = new Set(playerCards.map((card) => card.player.id));
  const merged: PlayPlayerCardWithDelta[] = playerCards.map((card) => ({
    ...card,
    delta: deltaByPlayerId.get(card.player.id) ?? null,
  }));
  ratingChanges.forEach((change) => {
    if (usedPlayerIds.has(change.player.id)) {
      return;
    }
    usedPlayerIds.add(change.player.id);
    merged.push({
      key: change.key,
      player: change.player,
      label: "Rating",
      delta: change.delta,
    });
  });
  return merged;
}

function buildRatingChangesForPlay(play: LiveGamePlay, allPlayers: LiveGamePlayer[]): PlayRatingChange[] {
  return allPlayers
    .flatMap((player) =>
      (player.ratingTimelinePoints ?? [])
        .filter((point) => point.eventId?.startsWith(`${play.id}:`))
        .map((point): PlayRatingChange | null => {
          const before = point.displayRatingBefore ?? point.ratingBefore ?? null;
          const after = point.displayRatingAfter ?? point.ratingAfter ?? point.rating ?? null;
          const delta =
            point.displayDelta ??
            point.delta ??
            (typeof before === "number" && typeof after === "number"
              ? Number((after - before).toFixed(1))
              : null);

          if (before === null && after === null && delta === null) {
            return null;
          }

          return {
            key: `${play.id}:${player.id}:${point.eventId ?? point.tSec}`,
            player,
            before,
            after,
            delta,
          };
        }),
    )
    .filter((entry): entry is PlayRatingChange => Boolean(entry));
}

// Compact "Q4 · 5.7" style unit combining period + clock into one line,
// reusing periodShortLabel (the same period-abbreviation logic the Point
// Differential chart already uses) so the two stay consistent.
function formatCompactPeriodClock(play: LiveGamePlay, regulationPeriods: number): string {
  const periodRank = parsePeriodRank(play.period);
  const shortPeriod =
    periodRank !== null
      ? periodShortLabel(periodRank - 1, regulationPeriods)
      : play.period || "Game";
  const clock = play.clock || "-";
  return `${shortPeriod} · ${clock}`;
}

// Formats the "— End of 4th Quarter · 84-92 —" system-divider label.
function formatSystemDividerLabel(play: LiveGamePlay): string {
  const score = `${play.awayScore}-${play.homeScore}`;
  return `— ${play.text} · ${score} —`;
}

function formatRatingDelta(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

type PlayWinProbDisplay = {
  percent: number;
  teamAbbr: string;
  swingPct: number;
  significant: boolean;
};

// One pass over the CHRONOLOGICAL play order (oldest first, regardless of
// display order) so each play's win-prob swing is measured against the play
// that actually happened right before it. Previously this searched the
// whole winProbability array fresh on every single row render; now it's
// computed once per data update and looked up by play id.
function buildWinProbDisplaysByPlayId(
  chronologicalPlays: LiveGamePlay[],
  winProbability: NonNullable<ReturnType<typeof useLiveGame>["data"]>["winProbability"],
  homeTeam: { shortDisplayName: string; abbreviation: string } | null,
  awayTeam: { shortDisplayName: string; abbreviation: string } | null,
): Map<string, PlayWinProbDisplay> {
  const result = new Map<string, PlayWinProbDisplay>();
  if (!winProbability || winProbability.length === 0) {
    return result;
  }

  let previousHomeProb: number | null = null;
  chronologicalPlays.forEach((play) => {
    const point = findWinProbabilityForPlay(play, winProbability);
    if (!point) {
      return;
    }
    const homeProb = Math.max(0, Math.min(1, point.homeWinProb));
    const isHomeLeading = homeProb >= 0.5;
    const team = isHomeLeading ? homeTeam : awayTeam;
    const teamAbbr = team?.abbreviation || team?.shortDisplayName || (isHomeLeading ? "HOME" : "AWAY");
    const percent = (isHomeLeading ? homeProb : 1 - homeProb) * 100;
    const swingPct = previousHomeProb === null ? 0 : Math.abs(homeProb - previousHomeProb) * 100;
    result.set(play.id, {
      percent,
      teamAbbr,
      swingPct,
      significant: swingPct >= SIGNIFICANT_WIN_PROB_SWING_PCT,
    });
    previousHomeProb = homeProb;
  });

  return result;
}

// Same GameContext shape the rating engine itself builds from a play (see
// hooks/useLiveGame.tsx's replay loop) — kept minimal here since
// isImpactClutchContext only reads period/clockSec/homeScore/awayScore/
// regulationPeriods.
function buildPlayGameContext(play: LiveGamePlay, regulationPeriods: number): GameContext {
  const periodMatch = play.period.match(/(\d+)/);
  const period = periodMatch ? Number.parseInt(periodMatch[1], 10) : 1;
  return {
    period: Number.isFinite(period) && period > 0 ? period : 1,
    clockSec: parseClockRemaining(play.clock) ?? 0,
    homeScore: Number.parseInt(play.homeScore, 10) || 0,
    awayScore: Number.parseInt(play.awayScore, 10) || 0,
    regulationPeriods,
  };
}

// Reuses the SAME significance signals the rest of the app already surfaces
// elsewhere, rather than inventing new thresholds: a large rating swing (the
// same per-event delta the rating engine computes), clutch context (the
// exact isImpactClutchContext check the Impact model itself uses), or
// membership in a highlight/run cluster (buildHighlightClusters — the same
// deterministic detector that drives the Highlights/Biggest Moments
// sections). Any one of the three is enough to mark a play as significant.
function isPlaySignificant({
  play,
  ratingChanges,
  regulationPeriods,
  significantPlayIds,
}: {
  play: LiveGamePlay;
  ratingChanges: PlayRatingChange[];
  regulationPeriods: number;
  significantPlayIds: Set<string>;
}): boolean {
  const hasLargeRatingSwing = ratingChanges.some(
    (change) => typeof change.delta === "number" && Math.abs(change.delta) >= SIGNIFICANT_RATING_SWING,
  );
  if (hasLargeRatingSwing) {
    return true;
  }
  if (significantPlayIds.has(play.id)) {
    return true;
  }
  return isImpactClutchContext(buildPlayGameContext(play, regulationPeriods));
}

function createStyles(theme: ReturnType<typeof useAppTheme>["tokens"]) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.bg,
    },
    body: {
      flex: 1,
      backgroundColor: theme.colors.bg,
    },
    timelineList: {
      flex: 1,
      backgroundColor: theme.colors.bg,
    },
    timelineContent: {
      paddingTop: theme.spacing[10],
      paddingBottom: theme.spacing[28],
      paddingHorizontal: theme.spacing[12],
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing[12],
      paddingVertical: theme.spacing[10],
      marginTop: theme.spacing[8],
      marginBottom: theme.spacing[8],
      backgroundColor: theme.colors.bg,
      borderBottomWidth: theme.borderWidth.hairline,
      borderColor: theme.colors.borderSoft,
    },
    headerTitle: {
      fontSize: 15,
      lineHeight: 19,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    headerLegend: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    headerLogo: {
      width: 20,
      height: 20,
    },
    // --- Timeline rail (standard + significant rows both use this) -------
    timelineRow: {
      flexDirection: "row",
    },
    // Tight, near-zero vertical margin so consecutive STANDARD rows'
    // rail lines butt up against each other and read as one continuous
    // line, rather than each row being an isolated segment.
    timelineRowStandard: {
      marginBottom: 1,
    },
    // Significant cards and system dividers get real spacing — these are
    // deliberate breaks in the timeline's rhythm, not routine entries.
    timelineRowSignificant: {
      marginVertical: theme.spacing[8],
    },
    timelineRail: {
      width: 22,
      alignItems: "center",
    },
    timelineRailLine: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 10,
      width: 2,
      borderRadius: 1,
      // theme.colors.borderSoft is a near-invisible 5%-opacity hairline,
      // fine for card dividers but not visible enough to read as a
      // standalone connector line against the black background — use a
      // stronger tint of the same muted tone instead.
      backgroundColor: withAlpha(theme.colors.textMuted, 0.3),
    },
    timelineDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginTop: theme.spacing[8],
      zIndex: 1,
    },
    // Significant plays get a bigger dot with a soft warning-colored halo —
    // the same "this mattered" gold tone the card itself uses — so the
    // rail alone hints at a standout moment even before the card registers.
    timelineDotSignificantRing: {
      width: 16,
      height: 16,
      borderRadius: 8,
      marginTop: theme.spacing[6],
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: withAlpha(theme.colors.warning, 0.3),
      zIndex: 1,
    },
    timelineDotSignificantCore: {
      width: 9,
      height: 9,
      borderRadius: 5,
    },
    // --- Standard (plain-text, non-card) row -------------------------------
    standardContent: {
      flex: 1,
      minWidth: 0,
      paddingLeft: theme.spacing[8],
      paddingVertical: theme.spacing[4],
    },
    standardHeaderLine: {
      fontSize: 13,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
    standardDescription: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "600",
      color: theme.colors.textPrimary,
      marginTop: 2,
    },
    // --- Significant play card (inset beside the rail, not full-bleed) ----
    significantCard: {
      flex: 1,
      minWidth: 0,
      position: "relative",
      marginLeft: theme.spacing[8],
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.normal,
      borderColor: withAlpha(theme.colors.warning, 0.55),
      backgroundColor: withAlpha(theme.colors.warning, 0.08),
      overflow: "hidden",
    },
    significantCardHighlightOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.colors.accent,
    },
    significantCardInner: {
      paddingHorizontal: theme.spacing[14],
      paddingVertical: theme.spacing[12],
      gap: theme.spacing[10],
    },
    playHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[10],
    },
    playTypeTitleSignificant: {
      flex: 1,
      fontSize: 17,
      lineHeight: 21,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    significantDescription: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "600",
      color: theme.colors.textPrimary,
    },
    // Inline win-prob swing badge — ONLY rendered on a significant card, and
    // only when THIS play itself swung the number by a meaningful amount
    // (see PlayWinProbDisplay.significant). Never shown on standard rows.
    winProbSwingBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[6],
      paddingVertical: 2,
      borderRadius: theme.radius.pill,
      backgroundColor: withAlpha(theme.colors.accent, 0.16),
    },
    winProbSwingBadgeText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      color: theme.colors.accent,
    },
    // --- Compact player block (used inside BOTH standard rows and
    // significant cards, at different sizes) — one stacked row per player
    // instead of the old side-by-side two-column boxes.
    compactPlayerBlock: {
      gap: theme.spacing[6],
      marginTop: theme.spacing[6],
    },
    compactPlayerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    compactPlayerPhotoWrapSmall: {
      width: 28,
      height: 28,
      borderRadius: theme.radius.pill,
      position: "relative",
    },
    compactPlayerPhotoSmall: {
      width: 28,
      height: 28,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.glassStrong,
      zIndex: 2,
    },
    compactPlayerPhotoWrapLarge: {
      width: 48,
      height: 48,
      borderRadius: theme.radius.pill,
      position: "relative",
    },
    compactPlayerPhotoLarge: {
      width: 48,
      height: 48,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.glassStrong,
      zIndex: 2,
    },
    ratingPillSmall: {
      position: "absolute",
      right: -3,
      bottom: -2,
      minWidth: 20,
      height: 13,
      borderRadius: theme.radius.pill,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 3,
      borderWidth: theme.borderWidth.hairline,
      borderColor: theme.colors.bg,
      zIndex: 3,
    },
    ratingPillTextSmall: {
      fontSize: 8,
      lineHeight: 10,
      fontWeight: "800",
      color: theme.colors.bg,
    },
    ratingPillLarge: {
      position: "absolute",
      right: -4,
      bottom: -3,
      minWidth: 26,
      height: 16,
      borderRadius: theme.radius.pill,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spacing[4],
      borderWidth: theme.borderWidth.hairline,
      borderColor: theme.colors.bg,
      zIndex: 3,
    },
    ratingPillTextLarge: {
      fontSize: 9,
      lineHeight: 11,
      fontWeight: "800",
      color: theme.colors.bg,
    },
    // flex-wrap so a long full name (see requirement: never truncated) just
    // wraps onto a second line instead of being cut off or squeezing the
    // delta pill.
    compactPlayerInfo: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: theme.spacing[6],
      rowGap: 2,
    },
    compactPlayerName: {
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    compactPlayerNameLarge: {
      fontSize: 15,
      lineHeight: 19,
    },
    compactPlayerLabel: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    // Rating-delta pill shown next to a player's name — a small colored
    // badge (green ▲ / red ▼) instead of "+0.1 (6.5 -> 6.6)" text.
    ratingDeltaPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingHorizontal: theme.spacing[4],
      paddingVertical: 1,
      borderRadius: theme.radius.pill,
    },
    ratingDeltaPillPositive: {
      backgroundColor: "rgba(34,197,94,0.16)",
    },
    ratingDeltaPillNegative: {
      backgroundColor: "rgba(239,68,68,0.16)",
    },
    ratingDeltaPillText: {
      fontSize: 10,
      lineHeight: 12,
      fontWeight: "800",
    },
    ratingDeltaPillTextPositive: {
      color: "#22c55e",
    },
    ratingDeltaPillTextNegative: {
      color: "#ef4444",
    },
    // --- System event divider (End of Quarter / End of Game) --------------
    // No rail, no dot, no card — a plain centered line that breaks the
    // timeline, with real spacing above/below to separate segments.
    systemDivider: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: theme.spacing[14],
    },
    systemDividerText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textMuted,
      letterSpacing: 0.4,
    },
    emptyState: {
      paddingHorizontal: theme.spacing[24],
      paddingVertical: theme.spacing[36],
      gap: theme.spacing[8],
      alignItems: "center",
    },
    emptyTitle: {
      fontSize: 18,
      lineHeight: 22,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      textAlign: "center",
    },
    emptyText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      color: theme.colors.textSecondary,
      textAlign: "center",
    },
  });
}

// Collapsible AI recap shown at the very top of the Plays feed. Collapsed by
// default; expands to reveal the shared AI game summary (same content/source as
// the Summary tab). No "last updated" line — this is a quick catch-up here.
function PlaysAiSummaryCard() {
  const { tokens: theme } = useAppTheme();
  const { summary, isGenerating, unavailable, loading } = useAiGameSummary();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          marginBottom: theme.spacing[10],
        },
        body: {
          ...theme.type.body,
          color: theme.colors.textPrimary,
          fontSize: 15,
          lineHeight: 22,
        },
        muted: {
          color: theme.colors.textMuted,
        },
      }),
    [theme],
  );

  const hasSummary = Boolean(summary) && !unavailable;
  const bodyText = hasSummary
    ? (summary as string)
    : unavailable
      ? "Summary unavailable"
      : isGenerating
        ? "Generating summary…"
        : loading
          ? "Watching for live game data"
          : "Waiting for summary";

  return (
    <View style={styles.wrap}>
      <ExpandableSection title="AI Summary" defaultExpanded={false}>
        <Text style={[styles.body, hasSummary ? null : styles.muted]}>{bodyText}</Text>
      </ExpandableSection>
    </View>
  );
}

// Soft, momentary glow used to draw the eye to a play landed on via
// "See all" from the Court tab's Last Play card. Fades out on its own so it
// never reads as a persistent selected/active state.
function PlayHighlightFlash({
  active,
  style,
}: {
  active: boolean;
  style: StyleProp<ViewStyle>;
}) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      return;
    }
    opacity.value = 0.32;
    opacity.value = withTiming(0, { duration: PLAY_HIGHLIGHT_FADE_MS });
  }, [active, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View pointerEvents="none" style={[style, animatedStyle]} />;
}

export default function PlayByPlayTab() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { data, refresh } = useLiveGame();
  const { state: settingsState } = useSettingsState();
  const { sharedHeaderScrollY } = useInGameHeaderScroll();
  const { openPlayerModal } = useInGamePlayerModal();
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const headerSpace = getStickyHeaderExpandedHeight(insets.top);
  const listRef = useRef<FlatList<PlayFeedItem>>(null);
  const isFocusedRef = useRef(isFocused);
  const isFocusedShared = useSharedValue(isFocused ? 1 : 0);
  const localScrollYRef = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [highlightedPlayId, setHighlightedPlayId] = useState<string | null>(null);
  const pendingHighlightPlayIdRef = useRef<string | null>(null);
  const availableSectionIds = useMemo(() => ["commentary"], []);
  useRegisterInGameSections("playbyplay", availableSectionIds);
  const visibleSectionIds = useMemo(
    () =>
      resolveInGameSectionIds(
        "playbyplay",
        settingsState.inGame.sectionLayoutsByTab,
        availableSectionIds,
      ).visibleIds,
    [availableSectionIds, settingsState.inGame.sectionLayoutsByTab],
  );

  const teams = data?.teams ?? [];
  const homeTeam = teams.find((team) => team.homeAway === "home") ?? teams[1] ?? null;
  const awayTeam = teams.find((team) => team.homeAway === "away") ?? teams[0] ?? null;
  const teamById = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams],
  );
  const playersByTeam = data?.playersByTeam ?? {};
  const allPlayers = useMemo(() => Object.values(playersByTeam).flat(), [playersByTeam]);
  const regulationPeriods = useMemo(
    () => (data?.mode ? getPeriodTimingForMode(data.mode).regulationPeriods : 2),
    [data?.mode],
  );
  // Same deterministic cluster detector that drives the Highlights/Biggest
  // Moments sections — reused here (not reimplemented) purely to know which
  // play ids are part of a run/lead-change/clutch/surge cluster, for the
  // significant-card styling below.
  const significantPlayIds = useMemo(() => {
    const clusters = buildHighlightClusters(data ?? null);
    return new Set(clusters.flatMap((cluster) => cluster.playIds));
  }, [data]);

  const setLocalScrollY = useCallback((value: number) => {
    localScrollYRef.current = value;
  }, []);

  // Oldest-first — the true chronological order. Kept separately from the
  // DISPLAY order below because win-prob swing detection and the
  // significance pass need to walk plays in the order they actually
  // happened, regardless of which direction the list itself renders in.
  const chronologicalPlays = useMemo(() => {
    const indexed: IndexedPlay[] = (data?.plays ?? []).map((play, index) => ({
      play,
      index,
      periodRank: parsePeriodRank(play.period),
      clockRemaining: parseClockRemaining(play.clock),
    }));

    // True chronological order (1st period first; within a period, the game
    // clock counts DOWN so a higher remaining time happened EARLIER) — was
    // previously sorted the opposite way on both axes (latest period first,
    // ascending clock within a period), which put a period's closing plays
    // at the top of its section instead of the bottom.
    indexed.sort((a, b) => {
      if (a.periodRank !== null && b.periodRank !== null && a.periodRank !== b.periodRank) {
        return a.periodRank - b.periodRank;
      }
      if (a.periodRank !== null && b.periodRank === null) {
        return -1;
      }
      if (a.periodRank === null && b.periodRank !== null) {
        return 1;
      }

      if (
        a.clockRemaining !== null &&
        b.clockRemaining !== null &&
        a.clockRemaining !== b.clockRemaining
      ) {
        return b.clockRemaining - a.clockRemaining;
      }
      if (a.clockRemaining !== null && b.clockRemaining === null) {
        return -1;
      }
      if (a.clockRemaining === null && b.clockRemaining !== null) {
        return 1;
      }

      return a.index - b.index;
    });

    return indexed.map((entry) => entry.play);
  }, [data?.plays]);

  // Most-recent-first for actual display — a premium live-viewing feed
  // shouldn't require scrolling to see the latest play. This is the ONLY
  // place the reversal happens; every other computation (win-prob swing,
  // significance) walks chronologicalPlays untouched.
  const displayPlays = useMemo(
    () => [...chronologicalPlays].reverse(),
    [chronologicalPlays],
  );

  const winProbDisplaysByPlayId = useMemo(
    () =>
      buildWinProbDisplaysByPlayId(chronologicalPlays, data?.winProbability ?? [], homeTeam, awayTeam),
    [chronologicalPlays, data?.winProbability, homeTeam, awayTeam],
  );

  const feedItems = useMemo<PlayFeedItem[]>(() => {
    const items: PlayFeedItem[] = [];
    let lastPeriod = "";

    displayPlays.forEach((play, index) => {
      const period = play.period || "Game";
      if (period !== lastPeriod) {
        items.push({
          key: `header-${period}-${index}`,
          kind: "header",
          period,
        });
        lastPeriod = period;
      }
      items.push({
        key: play.id,
        kind: "play",
        play,
      });
    });

    return items;
  }, [displayPlays]);

  // Plays that just arrived via a live poll get a slide-down + fade-in
  // entrance (see the "entering" prop below); the initial load, a game
  // switch, and anything merely scrolled into view must never animate.
  // knownPlayIdsRef/trackedEventIdRef hold the previous pass's state so this
  // is a diff against "what was already on screen a moment ago," not against
  // scroll position. This runs synchronously as part of the same render pass
  // that produced the new feedItems (not in a useEffect, which would fire a
  // render too late for renderItem to see it on the item's very first mount).
  const isLiveGame = data?.status.state === "in";
  const knownPlayIdsRef = useRef<Set<string> | null>(null);
  const trackedEventIdRef = useRef<string | null>(null);
  const newlyArrivedPlayIdsRef = useRef<Set<string>>(new Set());
  useMemo(() => {
    const currentIds = new Set(displayPlays.map((play) => play.id));
    const eventId = data?.eventId ?? null;
    const isSameGame = trackedEventIdRef.current === eventId;
    const previousIds = isSameGame ? knownPlayIdsRef.current : null;
    const newIds = new Set<string>();
    if (previousIds && isLiveGame) {
      currentIds.forEach((id) => {
        if (!previousIds.has(id)) {
          newIds.add(id);
        }
      });
    }
    trackedEventIdRef.current = eventId;
    knownPlayIdsRef.current = currentIds;
    newlyArrivedPlayIdsRef.current = newIds;
  }, [displayPlays, isLiveGame, data?.eventId]);

  // Consume a pending "scroll to and highlight" request left by the Court
  // tab's Last Play "See all" button. Runs on focus (to pick up a fresh
  // request) and whenever feedItems changes (in case the target play hadn't
  // loaded into `data.plays` yet the first time this ran).
  useEffect(() => {
    if (isFocused) {
      const requestedId = consumePendingPlayHighlight();
      if (requestedId) {
        pendingHighlightPlayIdRef.current = requestedId;
      }
    }

    const targetId = pendingHighlightPlayIdRef.current;
    if (!targetId) {
      return;
    }
    const targetIndex = feedItems.findIndex(
      (item) => item.kind === "play" && item.play.id === targetId,
    );
    if (targetIndex === -1) {
      return;
    }

    pendingHighlightPlayIdRef.current = null;
    const raf = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        index: targetIndex,
        animated: true,
        viewPosition: 0.3,
      });
    });
    setHighlightedPlayId(targetId);
    const clearTimer = setTimeout(() => setHighlightedPlayId(null), PLAY_HIGHLIGHT_FADE_MS);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clearTimer);
    };
  }, [isFocused, feedItems]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const onTimelineScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      const offsetY = event.contentOffset.y;
      if (isFocusedShared.value === 1) {
        sharedHeaderScrollY.value = offsetY;
        runOnJS(setLocalScrollY)(offsetY);
      }
    },
  });

  useEffect(() => {
    isFocusedRef.current = isFocused;
    isFocusedShared.value = isFocused ? 1 : 0;
  }, [isFocused, isFocusedShared]);

  const syncCollapsedOffset = useCallback((sourceOffset: number) => {
    if (isFocusedRef.current) {
      return;
    }
    const targetOffset = Math.min(
      Math.max(sourceOffset, 0),
      IN_GAME_HEADER_COLLAPSE_RANGE[1],
    );
    if (Math.abs(localScrollYRef.current - targetOffset) < 1) {
      return;
    }
    localScrollYRef.current = targetOffset;
    listRef.current?.scrollToOffset({ offset: targetOffset, animated: false });
  }, []);

  useAnimatedReaction(
    () => sharedHeaderScrollY.value,
    (value) => {
      runOnJS(syncCollapsedOffset)(value);
    },
    [sharedHeaderScrollY, syncCollapsedOffset],
  );

  useLayoutEffect(() => {
    if (!isFocused) {
      return;
    }
    // Reconcile in both directions on focus (see GameTabScreenScaffold for
    // why the "already scrolled" guard was removed): a stale scrolled-down
    // offset must snap back to 0 when another tab expanded the header,
    // otherwise this tab keeps re-forcing the header back into collapsed.
    const targetOffset = Math.min(
      Math.max(sharedHeaderScrollY.value, 0),
      IN_GAME_HEADER_COLLAPSE_RANGE[1],
    );
    if (Math.abs(localScrollYRef.current - targetOffset) < 1) {
      return;
    }
    localScrollYRef.current = targetOffset;
    listRef.current?.scrollToOffset({ offset: targetOffset, animated: false });
  }, [isFocused, sharedHeaderScrollY]);

  // One compact photo+name+delta row, reused for BOTH standard timeline rows
  // (small) and significant cards (large) so multi-player plays render as one
  // cohesive stacked block instead of the old two-column side-by-side boxes.
  const renderCompactPlayerRow = useCallback(
    (entry: PlayPlayerCardWithDelta, size: "small" | "large") => {
      const { key, player, label, delta } = entry;
      const rating =
        typeof player.inGameRating10 === "number" && Number.isFinite(player.inGameRating10)
          ? player.inGameRating10
          : null;
      const hasDelta = typeof delta === "number" && Number.isFinite(delta) && delta !== 0;
      const deltaPositive = hasDelta && delta > 0;
      const isLarge = size === "large";
      const photoDiameter = isLarge ? 48 : 28;

      return (
        <View key={key} style={styles.compactPlayerRow}>
          <Pressable
            onPress={() => openPlayerModal(player)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${player.name}'s player card`}
            style={isLarge ? styles.compactPlayerPhotoWrapLarge : styles.compactPlayerPhotoWrapSmall}
          >
            <FireRingGlow
              active={isPlayerOnFire(player)}
              photoDiameter={photoDiameter}
              debugLabel="fire-ring:playbyplay-timeline"
            />
            <Image
              source={{ uri: normalizeRemoteUri(player.headshot) || TRANSPARENT_FALLBACK_IMAGE_URI }}
              style={isLarge ? styles.compactPlayerPhotoLarge : styles.compactPlayerPhotoSmall}
            />
            <View
              style={[
                isLarge ? styles.ratingPillLarge : styles.ratingPillSmall,
                { backgroundColor: getInGameRatingColor(rating) },
              ]}
            >
              <Text style={isLarge ? styles.ratingPillTextLarge : styles.ratingPillTextSmall}>
                {rating === null ? "-" : rating.toFixed(1)}
              </Text>
            </View>
          </Pressable>
          <View style={styles.compactPlayerInfo}>
            <Text style={[styles.compactPlayerName, isLarge ? styles.compactPlayerNameLarge : null]}>
              {player.name}
            </Text>
            <Text style={styles.compactPlayerLabel}>{label}</Text>
            {hasDelta ? (
              <View
                style={[
                  styles.ratingDeltaPill,
                  deltaPositive ? styles.ratingDeltaPillPositive : styles.ratingDeltaPillNegative,
                ]}
              >
                <FontAwesome
                  name={deltaPositive ? "caret-up" : "caret-down"}
                  size={9}
                  color={deltaPositive ? "#22c55e" : "#ef4444"}
                />
                <Text
                  style={[
                    styles.ratingDeltaPillText,
                    deltaPositive ? styles.ratingDeltaPillTextPositive : styles.ratingDeltaPillTextNegative,
                  ]}
                >
                  {formatRatingDelta(delta)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      );
    },
    [openPlayerModal, styles],
  );

  const renderItem = useCallback(
    ({ item }: { item: PlayFeedItem }) => {
      if (item.kind === "header") {
        return (
          <Animated.View layout={playRowLayoutTransition} style={styles.headerRow}>
            <Text style={styles.headerTitle}>{item.period}</Text>
          </Animated.View>
        );
      }

      const play = item.play;
      const playType = getPlayTypeInfo(play);
      // Only a play that just arrived via live poll gets the slide-down +
      // fade-in entrance — never the initial load, a game switch, or a play
      // merely scrolled into view (see the diff that fills this ref, above).
      const isNewArrival = newlyArrivedPlayIdsRef.current.has(play.id);

      // Non-play markers ("End of 4th Quarter", "Start of 2nd Quarter") break
      // the timeline entirely — no rail, no dot, no card, just centered text.
      if (playType.kind === "system") {
        return (
          <Animated.View layout={playRowLayoutTransition} style={styles.systemDivider}>
            <Text style={styles.systemDividerText}>{formatSystemDividerLabel(play)}</Text>
          </Animated.View>
        );
      }

      const team = play.teamId ? teamById.get(play.teamId) ?? null : null;
      const teamPlayers = play.teamId ? playersByTeam[play.teamId] ?? [] : [];
      const accentColor = normalizeTeamColor(team?.color, theme.colors.accentStrong);
      const playerCards = buildExpandedPlayerCards({
        play,
        playType,
        allPlayers,
        teamPlayers,
      });
      const ratingChanges = buildRatingChangesForPlay(play, allPlayers);
      const playerCardsWithDelta = mergePlayerCardsWithRatingChanges(playerCards, ratingChanges);
      const winProbDisplay = winProbDisplaysByPlayId.get(play.id) ?? null;
      const significant = isPlaySignificant({
        play,
        ratingChanges,
        regulationPeriods,
        significantPlayIds,
      });

      // Significant plays (big rating swing, clutch context, or part of a
      // highlight/run) break from the plain timeline text and render as an
      // actual card, inset beside a larger, warning-ringed dot.
      if (significant) {
        return (
          <Animated.View
            layout={playRowLayoutTransition}
            entering={isNewArrival ? newPlayEnteringAnimation : undefined}
            style={[styles.timelineRow, styles.timelineRowSignificant]}
          >
            <View style={styles.timelineRail}>
              <View style={styles.timelineRailLine} />
              <View style={styles.timelineDotSignificantRing}>
                <View style={[styles.timelineDotSignificantCore, { backgroundColor: accentColor }]} />
              </View>
            </View>
            <View style={styles.significantCard}>
              <PlayHighlightFlash
                active={play.id === highlightedPlayId}
                style={styles.significantCardHighlightOverlay}
              />
              <View style={styles.significantCardInner}>
                <View style={styles.playHeaderRow}>
                  <Text style={styles.playTypeTitleSignificant}>{playType.title}</Text>
                  {winProbDisplay?.significant ? (
                    <View style={styles.winProbSwingBadge}>
                      <FontAwesome name="line-chart" size={9} color={theme.colors.accent} />
                      <Text style={styles.winProbSwingBadgeText}>
                        {winProbDisplay.teamAbbr} {winProbDisplay.percent.toFixed(0)}%
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.standardHeaderLine}>
                  {formatCompactPeriodClock(play, regulationPeriods)}
                </Text>
                <Text style={styles.significantDescription}>{play.text}</Text>
                {playerCardsWithDelta.length > 0 ? (
                  <View style={styles.compactPlayerBlock}>
                    {playerCardsWithDelta.map((entry) => renderCompactPlayerRow(entry, "large"))}
                  </View>
                ) : null}
              </View>
            </View>
          </Animated.View>
        );
      }

      // Standard play — no card chrome, just a dot on the rail and compact
      // text sitting directly on the background.
      return (
        <Animated.View
          layout={playRowLayoutTransition}
          entering={isNewArrival ? newPlayEnteringAnimation : undefined}
          style={[styles.timelineRow, styles.timelineRowStandard]}
        >
          <View style={styles.timelineRail}>
            <View style={styles.timelineRailLine} />
            <View style={[styles.timelineDot, { backgroundColor: accentColor }]} />
          </View>
          <View style={styles.standardContent}>
            <Text style={styles.standardHeaderLine}>
              {playType.title} · {formatCompactPeriodClock(play, regulationPeriods)}
            </Text>
            <Text style={styles.standardDescription}>{play.text}</Text>
            {playerCardsWithDelta.length > 0 ? (
              <View style={styles.compactPlayerBlock}>
                {playerCardsWithDelta.map((entry) => renderCompactPlayerRow(entry, "small"))}
              </View>
            ) : null}
          </View>
        </Animated.View>
      );
    },
    [
      allPlayers,
      highlightedPlayId,
      regulationPeriods,
      renderCompactPlayerRow,
      significantPlayIds,
      styles,
      playersByTeam,
      teamById,
      theme.colors.accent,
      theme.colors.accentStrong,
      winProbDisplaysByPlayId,
    ],
  );

  // Play cards have variable heights, so FlatList's first scrollToIndex
  // attempt can under/overshoot before it has measured everything. Land on
  // an estimated offset, then retry the precise scroll once layout settles.
  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      listRef.current?.scrollToOffset({
        offset: info.averageItemLength * info.index,
        animated: false,
      });
      setTimeout(() => {
        listRef.current?.scrollToIndex({
          index: info.index,
          animated: true,
          viewPosition: 0.3,
        });
      }, 50);
    },
    [],
  );

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {visibleSectionIds.includes("commentary") ? (
          <Animated.FlatList
            ref={listRef}
            data={feedItems}
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            ListHeaderComponent={PlaysAiSummaryCard}
            contentContainerStyle={[
              styles.timelineContent,
              { paddingTop: headerSpace + theme.spacing[10] },
            ]}
            style={styles.timelineList}
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            scrollEventThrottle={16}
            onScroll={onTimelineScroll}
            onScrollToIndexFailed={onScrollToIndexFailed}
            ListEmptyComponent={
              data ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>No plays yet</Text>
                  <Text style={styles.emptyText}>
                    Live possessions, whistles, rebounds, and score updates will appear here.
                  </Text>
                </View>
              ) : (
                // Distinct from the "no plays yet" state above: this is
                // "we don't even have the game loaded yet," not "the game
                // hasn't started."
                <View style={{ paddingTop: headerSpace + theme.spacing[10] }}>
                  <TabContentSkeleton cards={3} rowsPerCard={2} />
                </View>
              )
            }
          />
        ) : (
          <View style={[styles.emptyState, { paddingTop: headerSpace + theme.spacing[24] }]}>
            <Text style={styles.emptyTitle}>Plays Hidden</Text>
            <Text style={styles.emptyText}>
              Use Edit Screen to show this section again.
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
