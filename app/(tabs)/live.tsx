import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useState } from "react";
import { GlassView } from "expo-glass-effect";
import {
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Reanimated, {
  FadeIn,
  FadeInDown,
  Layout,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import FontAwesome from "@expo/vector-icons/FontAwesome";

import { router } from "expo-router";

import BaseballFieldOutline from "@/components/BaseballFieldOutline";
import CourtOverlay, { type CourtRatingMode } from "@/components/CourtOverlay";
import PlayerBubble from "@/components/PlayerBubble";
import PredictionPickerCard from "@/components/profile/PredictionPickerCard";
import Card from "@/components/ui/Card";
import FireRingGlow, { isPlayerOnFire } from "@/components/ui/FireRingGlow";
import SegmentedControl from "@/components/ui/SegmentedControl";
import CourtHistoryScrubber from "@/components/game/CourtHistoryScrubber";
import CourtLineupDock from "@/components/game/CourtLineupDock";
import GameTabScreenScaffold from "@/components/GameTabScreenScaffold";
import TabContentSkeleton from "@/components/loading/TabContentSkeleton";
import ExpandableSection from "@/components/ui/ExpandableSection";
import SectionHeader from "@/components/ui/SectionHeader";
import TopPerformerCrown from "@/components/ui/TopPerformerCrown";
import SharedTopPlayerRow from "@/components/ui/TopPlayerRow";
import { type LiveGamePlay, type LiveGamePlayer, useLiveGame } from "@/hooks/useLiveGame";
import {
  FIELD_SPOTS,
  placeOverlaysAtSpot,
  type FieldSpotKey,
} from "@/src/features/baseball/fieldLayout";
import { formatOverlayPosition } from "@/src/features/baseball/liveFieldState";
import {
  buildCourtHistoryIndex,
  projectPlayersAtSnapshot,
  sampleCourtHistory,
} from "@/src/features/court/courtHistory";
import type { GameMode } from "@/src/mode/gameModeTypes";
import { useProfile } from "@/src/profile/ProfileContext";
import { buildPredictionSnapshotFromLiveGame } from "@/src/profile/predictionResolution";
import { useSettingsState } from "@/src/settings/SettingsContext";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { requestPlayHighlight } from "@/src/ui/inGamePlayHighlight";
import { resolveInGameSectionIds } from "@/src/ui/inGameSectionLayouts";
import { useInGamePlayerModal } from "@/src/ui/inGamePlayerModalContext";
import { useInGameTabNavigation } from "@/src/ui/inGameTabNavigationContext";
import { useRegisterInGameSections } from "@/src/ui/useRegisterInGameSections";
import { getInGameRatingColor } from "@/theme/colors";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
// Season/Age/Momentum always show; Live only makes sense once the game has
// actually started (no live data pre-tipoff), and NIL is a college-specific
// concept that doesn't apply to WNBA/NBA ("nba" mode — see
// PRO_BASKETBALL_LABEL). Momentum shows alongside Season/Age rather than
// being gated like Live — pregame it just reads a neutral 0.0 for everyone
// (same harmless-placeholder precedent as Age, which has no real data wired
// in at all yet), so there's no broken state to gate against.
function buildCourtRatingModeOptions(
  isPreGame: boolean,
  mode: GameMode | undefined,
): { value: CourtRatingMode; label: string }[] {
  const options: { value: CourtRatingMode; label: string }[] = [
    { value: "season", label: "Season" },
  ];
  if (!isPreGame) {
    options.push({ value: "live", label: "Live" });
  }
  options.push({ value: "momentum", label: "Momentum" });
  if (mode !== "nba") {
    options.push({ value: "nil", label: "NIL" });
  }
  options.push({ value: "age", label: "Age" });
  return options;
}
const TOP_PLAYER_RATING_COUNT_DURATION = 400;
const TOP_PLAYER_RATING_GLOW_DURATION = 1300;
const FLOATING_COMMENT_BUTTON_SIZE = 60;

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

function getTopPlayers(players: LiveGamePlayer[], count: number) {
  return [...players]
    .sort((a, b) => {
      const aRating = a.inGameRating10 ?? -1;
      const bRating = b.inGameRating10 ?? -1;
      if (aRating !== bRating) return bRating - aRating;
      return b.points - a.points;
    })
    .slice(0, count);
}

function isPreGameState(state: string | undefined): boolean {
  const normalized = (state ?? "").toLowerCase();
  return (
    normalized === "" ||
    normalized === "pre" ||
    normalized === "scheduled" ||
    normalized === "pregame"
  );
}

// Selects the five players to picture on the court for a team. Pre-game there is
// no live lineup, so we project the highest season-rated players (a projected
// starting five); once the game is live we use the actual on-court players,
// falling back to starters/minutes if fewer than five are flagged.
function pickCourtFive(
  players: LiveGamePlayer[],
  preGame: boolean,
): LiveGamePlayer[] {
  if (players.length === 0) {
    return [];
  }
  if (preGame) {
    return [...players]
      .sort(
        (a, b) =>
          (b.seasonRating10 ?? -1) - (a.seasonRating10 ?? -1) ||
          b.minutes - a.minutes,
      )
      .slice(0, 5);
  }
  const onCourt = players.filter((player) => player.onCourt);
  if (onCourt.length >= 5) {
    return [...onCourt]
      .sort((a, b) => b.minutes - a.minutes || b.points - a.points)
      .slice(0, 5);
  }
  const picked = [...onCourt];
  const taken = new Set(picked.map((player) => player.id));
  [...players]
    .sort(
      (a, b) =>
        Number(b.starter) - Number(a.starter) ||
        b.minutes - a.minutes ||
        b.points - a.points,
    )
    .forEach((player) => {
      if (picked.length >= 5 || taken.has(player.id)) {
        return;
      }
      picked.push(player);
      taken.add(player.id);
    });
  return picked.slice(0, 5);
}

type LatestImpactfulPlay = {
  player: LiveGamePlayer;
  impact: NonNullable<LiveGamePlayer["lastMeaningfulImpact"]>;
  play: LiveGamePlay;
  periodRank: number | null;
  clockRemaining: number | null;
  playIndex: number;
  absDelta: number;
};

type LatestPlayToast = {
  play: LiveGamePlay;
  player: LiveGamePlayer | null;
  impact: NonNullable<LiveGamePlayer["lastMeaningfulImpact"]> | null;
  periodRank: number | null;
  clockRemaining: number | null;
  playIndex: number;
};

type OverlayRole = "defense" | "batter" | "runner";

type FieldOverlayInput = {
  key: string;
  player: LiveGamePlayer;
  spotKey: FieldSpotKey;
  role: OverlayRole;
};

type FieldOverlayPlacement = {
  key: string;
  player: LiveGamePlayer;
  left: `${number}%`;
  top: `${number}%`;
  role: OverlayRole;
};

type TopPlayerRankMovement = {
  direction: "up" | "down";
};

function formatHalf(half: string | undefined): string {
  const normalized = (half ?? "").toLowerCase();
  if (normalized === "top") return "Top";
  if (normalized === "bottom") return "Bot";
  if (normalized === "middle") return "Mid";
  if (normalized === "end") return "End";
  if (normalized === "final") return "Final";
  if (normalized === "pregame") return "Pregame";
  return "Inning";
}

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

type ImpactCardStyles = ReturnType<typeof createStyles>;

// Small live/recency indicator: a pulsing dot + "Xs ago" label. Tracks when the
// current impact play first appeared (keyed by play id) and ticks once a second.
function ImpactLiveIndicator({
  playKey,
  isLive,
  styles,
}: {
  playKey: string;
  isLive: boolean;
  styles: ImpactCardStyles;
}) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  const firstSeenRef = useRef<{ key: string; at: number }>({
    key: playKey,
    at: Date.now(),
  });
  const [, setTick] = useState(0);

  if (firstSeenRef.current.key !== playKey) {
    firstSeenRef.current = { key: playKey, at: Date.now() };
  }

  useEffect(() => {
    if (!isLive) {
      pulse.stopAnimation();
      pulse.setValue(0.4);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [isLive, pulse]);

  useEffect(() => {
    const id = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedSec = Math.max(
    0,
    Math.round((Date.now() - firstSeenRef.current.at) / 1000),
  );
  const label = elapsedSec < 60 ? `${elapsedSec}s ago` : `${Math.floor(elapsedSec / 60)}m ago`;

  return (
    <View style={styles.impactLiveRow}>
      <Animated.View
        style={[
          styles.impactLiveDot,
          {
            opacity: pulse,
            transform: [
              {
                scale: pulse.interpolate({
                  inputRange: [0.4, 1],
                  outputRange: [0.85, 1.15],
                }),
              },
            ],
          },
        ]}
      />
      <Text style={styles.impactLiveText}>{label}</Text>
    </View>
  );
}

// Compact "Latest Play" card. Header row: title left, "Xs ago" indicator right.
// Body is a single tight row: player photo (team-colored ring) + jersey badge,
// then name / play description / quarter+clock, then the current rating with a
// small green-up / red-down trend triangle (matching Live Rankings). A "See all"
// link in the bottom-right navigates to the Plays tab.
// Odometer-style rating: animates from the previously shown value to the new
// value over ~0.7s instead of snapping.
function useCountUpRating(value: number | null): string {
  const initial = typeof value === "number" && Number.isFinite(value) ? value : null;
  const animated = useRef(new Animated.Value(initial ?? 0)).current;
  const previousRef = useRef<number | null>(initial);
  const [text, setText] = useState(initial === null ? "-" : initial.toFixed(1));

  useEffect(() => {
    const id = animated.addListener(({ value: current }) => {
      setText(current.toFixed(1));
    });
    return () => animated.removeListener(id);
  }, [animated]);

  useEffect(() => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      animated.stopAnimation();
      previousRef.current = null;
      setText("-");
      return;
    }
    const previous = previousRef.current;
    previousRef.current = value;
    if (previous === null || Math.abs(previous - value) < 0.05) {
      animated.setValue(value);
      setText(value.toFixed(1));
      return;
    }
    Animated.timing(animated, {
      toValue: value,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [animated, value]);

  return text;
}

function LastPlayerImpactCard({
  impact,
  trend,
  isLive,
  gameEnded = false,
  ringColor,
  primaryColor,
  styles,
}: {
  impact: LatestImpactfulPlay | null;
  trend: "up" | "down" | "neutral" | null;
  isLive: boolean;
  gameEnded?: boolean;
  ringColor?: string;
  primaryColor?: string;
  styles: ImpactCardStyles;
}) {
  const { tokens: theme } = useAppTheme();
  const { goToTab } = useInGameTabNavigation();
  const afterRating = impact
    ? impact.impact.displayRatingAfter ?? impact.impact.ratingAfter
    : null;
  const animatedRatingText = useCountUpRating(
    typeof afterRating === "number" && Number.isFinite(afterRating) ? afterRating : null,
  );

  return (
    <View style={styles.impactCard}>
      <SectionHeader
        title={gameEnded ? "Last Play" : "Latest Play"}
        right={
          impact ? (
            <ImpactLiveIndicator playKey={impact.play.id} isLive={isLive} styles={styles} />
          ) : null
        }
      />

      {impact ? (
        <>
          <View style={styles.impactMainRow}>
            {/* Avatar + copy fade/slide in each time a new play arrives (keyed
                by play id). The rating stays outside so it can count up. */}
            <Reanimated.View
              key={impact.play.id}
              entering={FadeInDown.duration(320)}
              style={styles.impactMainRowInner}
            >
              {/* Player photo + team-colored ring + jersey badge */}
              <View style={styles.impactAvatarStack}>
                <FireRingGlow
                  active={isPlayerOnFire(impact.player)}
                  photoDiameter={36}
                  visualDiameter={40}
                  debugLabel="fire-ring:latest-play"
                />
                <View
                  style={[
                    styles.impactAvatarRing,
                    { backgroundColor: normalizeHexColor(ringColor, theme.colors.borderSoft) },
                  ]}
                >
                  <View
                    style={[
                      styles.impactAvatarClip,
                      { backgroundColor: normalizeHexColor(primaryColor, theme.colors.glassStrong) },
                    ]}
                  >
                    <Image
                      source={{ uri: impact.player.headshot || FALLBACK_IMAGE_URI }}
                      style={styles.impactAvatar}
                    />
                  </View>
                </View>
                <View style={styles.impactJerseyBadge}>
                  <Text style={styles.impactJerseyBadgeText}>
                    #{normalizeJerseyLabel(impact.player.jersey)}
                  </Text>
                </View>
              </View>

              {/* Name, play description, quarter + clock (no score) */}
              <View style={styles.impactMainCopy}>
                <Text style={styles.impactPlayerName} numberOfLines={1}>
                  {impact.player.name}
                </Text>
                <Text style={styles.impactPlayText} numberOfLines={1}>
                  {impact.play.text}
                </Text>
                <Text style={styles.impactMeta} numberOfLines={1}>
                  {impact.play.period || `P${impact.impact.period}`} {impact.play.clock || "-"}
                </Text>
              </View>
            </Reanimated.View>

            {/* Current rating (count-up) + small colored trend arrow */}
            <View style={styles.impactRatingWrap}>
              <Text style={styles.impactRatingValue}>{animatedRatingText}</Text>
              {trend === "up" || trend === "down" ? (
                <View
                  style={[
                    styles.impactTrendTriangle,
                    trend === "up" ? styles.impactTrendUp : styles.impactTrendDown,
                  ]}
                />
              ) : null}
            </View>
          </View>

          {/* See all -> Plays tab, scrolled to and briefly highlighting this play */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="See all plays"
            hitSlop={8}
            onPress={() => {
              requestPlayHighlight(impact.play.id);
              goToTab("playbyplay");
            }}
            style={styles.impactSeeAll}
          >
            <Text style={styles.impactSeeAllText}>See all</Text>
            <FontAwesome name="chevron-right" size={10} color={theme.colors.accent} />
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.impactEmptyTitle}>No play yet</Text>
          <Text style={styles.impactEmptySubtext}>Waiting for a rating-changing event.</Text>
        </>
      )}
    </View>
  );
}

type TeamFilterOption = { value: string; label: string };

// Compact segmented pill used in the Live Rankings header to filter the
// leaderboard by team. Built from existing theme tokens (surfaceAlt track,
// accent-filled selection, micro type) so it matches the rest of the app.
function TeamFilterToggle({
  options,
  value,
  onChange,
}: {
  options: readonly TeamFilterOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createTeamFilterToggleStyles(theme), [theme]);

  return (
    <View style={styles.track}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Show ${option.label} rankings`}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected ? styles.segmentSelected : null]}
          >
            <Text
              style={[styles.segmentText, selected ? styles.segmentTextSelected : null]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createTeamFilterToggleStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    track: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      padding: theme.spacing[2],
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
    },
    segment: {
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[4],
      borderRadius: theme.radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    segmentSelected: {
      backgroundColor: theme.colors.accent,
    },
    segmentText: {
      ...theme.type.micro,
      color: theme.colors.textMuted,
    },
    segmentTextSelected: {
      color: theme.colors.textPrimary,
    },
  });
}

function normalizeHexColor(value: string | undefined | null, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const normalized = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : fallback;
}

function withAlpha(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  if (!/^[0-9A-Fa-f]{6}$/.test(raw)) {
    return `rgba(0,0,0,${alpha})`;
  }
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];

function normalizeJerseyLabel(value: string | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return /^[0-9A-Za-z]{1,4}$/.test(trimmed) ? trimmed : "-";
}

function formatTopPlayerRating(value: number): string {
  return value.toFixed(1);
}

function buildSmoothSparklinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  const path = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`);
  }
  return path.join(" ");
}

function buildSmoothSparklineSegments(
  points: Array<{ x: number; y: number; rating: number }>,
): Array<{ d: string; color: string; key: string }> {
  if (points.length < 2) {
    return [];
  }

  return points.slice(0, -1).map((point, index) => {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = point;
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    const segmentRating = (p1.rating + p2.rating) / 2;

    return {
      d: `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`,
      color: getInGameRatingColor(segmentRating),
      key: `${index}-${p1.x}-${p1.y}-${p2.x}-${p2.y}`,
    };
  });
}

function TopPlayerSparkline({
  points,
  active,
  ratingColor,
  width = 84,
  height = 24,
}: {
  points: Array<{ tSec: number; rating: number }>;
  active: boolean;
  ratingColor: string;
  width?: number;
  height?: number;
}) {
  const { tokens: theme } = useAppTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  const safe = points
    .filter((point) => Number.isFinite(point.tSec) && Number.isFinite(point.rating))
    .map((point) => ({
      tSec: Math.max(0, point.tSec),
      rating: Math.max(0, Math.min(10, point.rating)),
    }))
    .sort((a, b) => a.tSec - b.tSec);
  const fallback = safe.length
    ? safe
    : [
        { tSec: 0, rating: 5 },
        { tSec: 1, rating: 5 },
      ];
  const duration = Math.max(1, fallback[fallback.length - 1]?.tSec ?? 1);
  const ratings = fallback.map((point) => point.rating);
  const minRating = Math.min(...ratings);
  const maxRating = Math.max(...ratings);
  const midRating = (minRating + maxRating) / 2;
  // Use a tighter local rating window so the sparkline shows more meaningful swings.
  const visibleRange = Math.max(0.9, maxRating - minRating);
  const lowerBound = Math.max(0, midRating - visibleRange / 2);
  const upperBound = Math.min(10, midRating + visibleRange / 2);
  const normalizedRange = Math.max(0.9, upperBound - lowerBound);
  const normalized = fallback.map((point) => {
    const x = (point.tSec / duration) * width;
    const relativeRating = (point.rating - lowerBound) / normalizedRange;
    const y = (1 - Math.max(0, Math.min(1, relativeRating))) * height;
    return { ...point, x, y };
  });
  const lastPoint = normalized[normalized.length - 1] ?? { x: width, y: height / 2, rating: 5 };
  const lineColor = ratingColor;
  const segments = buildSmoothSparklineSegments(normalized);
  const fallbackPath = buildSmoothSparklinePath(normalized);
  const fillColor =
    lastPoint.rating >= 8 ? "#00C853" : lastPoint.rating >= 5 ? "#F97316" : "#F44336";
  const fillGradientId = useMemo(
    () =>
      `top-player-sparkline-fill-${normalized
        .map((point) => `${Math.round(point.x)}-${Math.round(point.y)}`)
        .join("_")}`,
    [normalized],
  );
  const fillPath = `${fallbackPath} L ${width} ${height} L 0 ${height} Z`;

  useEffect(() => {
    if (!active) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [active, pulse]);

  const dotScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.65],
  });
  const dotOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 0.35],
  });

  return (
    <View style={{ width, height, justifyContent: "center", overflow: "visible" }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient
            id={fillGradientId}
            x1="0"
            y1="0"
            x2="0"
            y2={height}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={fillColor} stopOpacity="0.25" />
            <Stop offset="1" stopColor={fillColor} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path d={fillPath} fill={`url(#${fillGradientId})`} />
        {segments.length > 0 ? (
          segments.map((segment) => (
            <Path
              key={segment.key}
              d={segment.d}
              fill="none"
              stroke={segment.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))
        ) : (
          <Path
            d={fallbackPath}
            fill="none"
            stroke={lineColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </Svg>
      {active ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: lastPoint.x - 4,
            top: lastPoint.y - 4,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: lineColor,
            borderWidth: theme.borderWidth.normal,
            borderColor: theme.colors.bg,
            opacity: dotOpacity,
            transform: [{ scale: dotScale }],
          }}
        />
      ) : null}
    </View>
  );
}

function TopPlayerRow({
  player,
  teamColor,
  teamPrimaryColor,
  rankMovement,
  onPress,
  isHighestRated,
  sparklinePulseEnabled,
}: {
  player: LiveGamePlayer;
  teamColor?: string | null;
  teamPrimaryColor?: string | null;
  rankMovement?: TopPlayerRankMovement;
  onPress: (player: LiveGamePlayer) => void;
  isHighestRated: boolean;
  sparklinePulseEnabled: boolean;
}) {
  const { tokens: theme, isDark } = useAppTheme();
  const jersey = normalizeJerseyLabel(player.jersey);
  const rating = player.inGameRating10;
  const ratingText = useAnimatedTopPlayerRatingText(rating);
  const ratingGlow = useTopPlayerRatingGlow(rating, {
    down: theme.colors.danger,
    up: theme.colors.success,
  });
  const ratingColor = getInGameRatingColor(rating);
  const headshotUri = player.headshot || FALLBACK_IMAGE_URI;
  const normalizedTeamRingColor = useMemo(() => {
    if (!teamColor || typeof teamColor !== "string") {
      return theme.colors.borderSoft;
    }
    const normalized = teamColor.startsWith("#") ? teamColor : `#${teamColor}`;
    return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : theme.colors.borderSoft;
  }, [teamColor, theme.colors.borderSoft]);
  const normalizedTeamPrimaryColor = useMemo(() => {
    if (!teamPrimaryColor || typeof teamPrimaryColor !== "string") {
      return theme.colors.glassStrong;
    }
    const normalized = teamPrimaryColor.startsWith("#")
      ? teamPrimaryColor
      : `#${teamPrimaryColor}`;
    return /^#[0-9A-Fa-f]{6}$/.test(normalized)
      ? normalized
      : theme.colors.glassStrong;
  }, [teamPrimaryColor, theme.colors.glassStrong]);
  const styles = useMemo(() => createTopPlayerRowStyles(theme, isDark), [isDark, theme]);
  const nameWithPosition = player.position
    ? `${player.name} \u00B7 ${player.position}`
    : player.name;
  const statSubtitle = `${player.points} pts \u00B7 ${player.rebounds} reb \u00B7 ${player.assists} ast`;

  return (
    <Pressable
      onPress={() => onPress(player)}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ratingChangeGlow,
          {
            backgroundColor: ratingGlow.color,
            borderColor: ratingGlow.color,
            opacity: ratingGlow.opacity,
          },
        ]}
      />
      <View style={styles.left}>
        <View style={styles.avatarStack}>
          {isHighestRated ? (
            <View style={styles.crownBadge}>
              <TopPerformerCrown size={28} />
            </View>
          ) : null}
          <View style={[styles.avatarRing, { backgroundColor: normalizedTeamRingColor }]}>
            <View style={[styles.avatarClip, { backgroundColor: normalizedTeamPrimaryColor }]}>
              {isHighestRated ? (
                <Image source={{ uri: headshotUri }} style={styles.avatarGlow} blurRadius={6} />
              ) : null}
              <Image source={{ uri: headshotUri }} style={styles.avatar} />
            </View>
          </View>
          <TopPlayerRankMovementIndicator movement={rankMovement} />
          <View style={[styles.ratingBadge, { backgroundColor: ratingColor }]}>
            <Text style={styles.ratingText}>{ratingText}</Text>
          </View>
          <View style={styles.jerseyBadge}>
            <Text style={styles.jerseyBadgeText}>#{jersey}</Text>
          </View>
        </View>
        <View style={styles.nameWrap}>
          <Text numberOfLines={1} style={styles.name}>
            {nameWithPosition}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {statSubtitle}
          </Text>
        </View>
      </View>

      <View style={styles.right}>
        <TopPlayerSparkline
          points={player.ratingTimelinePoints ?? []}
          active={player.onCourt && sparklinePulseEnabled}
          ratingColor={ratingColor}
        />
      </View>
    </Pressable>
  );
}

function TopPlayerRankMovementIndicator({
  movement,
}: {
  movement?: TopPlayerRankMovement;
}) {
  if (!movement) {
    return null;
  }

  return (
    <Reanimated.View
      pointerEvents="none"
      style={stylesGlobal.rankMoveIndicator}
    >
      <View
        style={[
          stylesGlobal.rankMoveTriangle,
          movement.direction === "up"
            ? stylesGlobal.rankMoveTriangleUp
            : stylesGlobal.rankMoveTriangleDown,
        ]}
      />
    </Reanimated.View>
  );
}

function useTopPlayerRatingGlow(
  rating: number | null | undefined,
  colors: { up: string; down: string },
) {
  const initialRating =
    typeof rating === "number" && Number.isFinite(rating) ? rating : null;
  const previousRatingRef = useRef<number | null>(initialRating);
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const [glowColor, setGlowColor] = useState(colors.up);

  useEffect(() => {
    if (typeof rating !== "number" || !Number.isFinite(rating)) {
      previousRatingRef.current = null;
      glowOpacity.stopAnimation();
      glowOpacity.setValue(0);
      return;
    }

    const clampedRating = Math.max(0, Math.min(10, rating));
    const previousRating = previousRatingRef.current;
    previousRatingRef.current = clampedRating;

    if (previousRating === null || Math.abs(previousRating - clampedRating) < 0.05) {
      return;
    }

    setGlowColor(
      clampedRating > previousRating
        ? colors.up
        : colors.down,
    );
    glowOpacity.stopAnimation();
    glowOpacity.setValue(0.22);
    Animated.timing(glowOpacity, {
      toValue: 0,
      duration: TOP_PLAYER_RATING_GLOW_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [colors.down, colors.up, glowOpacity, rating]);

  return { color: glowColor, opacity: glowOpacity };
}

function useAnimatedTopPlayerRatingText(rating: number | null | undefined): string {
  const initialRating =
    typeof rating === "number" && Number.isFinite(rating) ? rating : null;
  const animatedRating = useRef(new Animated.Value(initialRating ?? 0)).current;
  const previousRatingRef = useRef<number | null>(initialRating);
  const [ratingText, setRatingText] = useState(
    initialRating === null ? "-" : formatTopPlayerRating(initialRating),
  );

  useEffect(() => {
    const listenerId = animatedRating.addListener(({ value }) => {
      setRatingText(formatTopPlayerRating(Math.max(0, Math.min(10, value))));
    });

    return () => {
      animatedRating.removeListener(listenerId);
    };
  }, [animatedRating]);

  useEffect(() => {
    if (typeof rating !== "number" || !Number.isFinite(rating)) {
      animatedRating.stopAnimation();
      previousRatingRef.current = null;
      setRatingText("-");
      return;
    }

    const clampedRating = Math.max(0, Math.min(10, rating));
    const previousRating = previousRatingRef.current;
    previousRatingRef.current = clampedRating;

    if (previousRating === null) {
      animatedRating.setValue(clampedRating);
      setRatingText(formatTopPlayerRating(clampedRating));
      return;
    }

    if (Math.abs(previousRating - clampedRating) < 0.05) {
      animatedRating.setValue(clampedRating);
      setRatingText(formatTopPlayerRating(clampedRating));
      return;
    }

    Animated.timing(animatedRating, {
      toValue: clampedRating,
      duration: TOP_PLAYER_RATING_COUNT_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        setRatingText(formatTopPlayerRating(clampedRating));
      }
    });
  }, [animatedRating, rating]);

  return ratingText;
}

const stylesGlobal = StyleSheet.create({
  rankMoveIndicator: {
    position: "absolute",
    top: -7,
    left: -8,
    zIndex: 5,
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  rankMoveTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  rankMoveTriangleUp: {
    borderBottomWidth: 10,
    borderBottomColor: "#00C853",
  },
  rankMoveTriangleDown: {
    borderTopWidth: 10,
    borderTopColor: "#F44336",
  },
});

function createTopPlayerRowStyles(theme: AppThemeTokens, isDark: boolean) {
  return StyleSheet.create({
    row: {
      position: "relative",
      borderRadius: theme.radius.lg,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[10],
      minHeight: 68,
      paddingHorizontal: theme.spacing[12],
      paddingVertical: theme.spacing[10],
    },
    ratingChangeGlow: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.lg,
      borderWidth: theme.borderWidth.normal,
    },
    left: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[8],
    },
    avatarStack: {
      position: "relative",
    },
    avatarRing: {
      width: 44.5,
      height: 44.5,
      borderRadius: 22.25,
      padding: 2.25,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarClip: {
      width: 40,
      height: 40,
      borderRadius: theme.radius.pill,
      overflow: "hidden",
      backgroundColor: theme.colors.glassStrong,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: theme.radius.pill,
      ...StyleSheet.absoluteFillObject,
      zIndex: 2,
    },
    avatarGlow: {
      ...StyleSheet.absoluteFillObject,
      opacity: isDark ? 0.52 : 0.46,
      tintColor: theme.colors.warning,
      transform: [{ scale: 1.12 }],
      zIndex: 1,
    },
    crownBadge: {
      position: "absolute",
      left: -2,
      top: -13,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 4,
    },
    jerseyBadge: {
      position: "absolute",
      left: 5,
      right: 5,
      bottom: -7,
      minWidth: 24,
      minHeight: 14,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.bg,
      borderWidth: theme.borderWidth.hairline,
      borderColor: theme.colors.borderSoft,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 3,
    },
    ratingBadge: {
      position: "absolute",
      top: -7,
      right: -8,
      zIndex: 5,
      minWidth: 32,
      height: 18,
      paddingHorizontal: 6,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    jerseyBadgeText: {
      color: theme.colors.textPrimary,
      fontSize: 9,
      lineHeight: 11,
      fontWeight: "800",
    },
    nameWrap: {
      flex: 1,
      minWidth: 0,
    },
    name: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "700",
      color: theme.colors.textPrimary,
    },
    meta: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      letterSpacing: 0.2,
      color: theme.colors.textMuted,
    },
    right: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    ratingText: {
      fontSize: 10,
      lineHeight: 12,
      fontWeight: "800",
      letterSpacing: 0.2,
      color: theme.colors.bg,
    },
    pressed: {
      opacity: theme.opacity.pressed,
    },
  });
}

function createStyles(theme: ReturnType<typeof useAppTheme>["tokens"], isDark: boolean) {
  return StyleSheet.create({
    screen: {
      flex: 1,
    },
    courtBody: {
      paddingHorizontal: 0,
      paddingVertical: 0,
    },
    // Transparent container (no card/border/elevation) holding the court + the
    // docked bench/coaches, spaced as one continuous section on the dark bg.
    courtSection: {
      backgroundColor: "transparent",
      gap: theme.spacing[20],
    },
    // Matches CardContainer.borderRadius (12) so the court reads as the same
    // card shape as Last Play / Final Rankings / Bench, sitting at the
    // scaffold's standard horizontal padding rather than full-bleed.
    courtShell: {
      position: "relative",
      overflow: "hidden",
      borderRadius: 12,
    },
    predictedLineupHeader: {
      alignItems: "center",
      paddingHorizontal: theme.spacing[4],
    },
    // Matches the SectionHeader title treatment used by "Bench" / "Final
    // Rankings" elsewhere on this screen, instead of a muted uppercase caption.
    predictedLineupLabel: {
      fontSize: 14,
      lineHeight: 17,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      letterSpacing: 0.2,
    },
    // Sits between the court and the Bench dock. Wide + short: the toggle
    // itself spans the row's full width (equalWidth on SegmentedControl)
    // instead of sizing to its content, so it reads as a long wide bar
    // rather than the old compact/square control that lived above the court.
    courtToggleRow: {
      paddingHorizontal: theme.spacing[4],
    },
    scrubberContextRow: {
      paddingHorizontal: theme.spacing[16],
      alignItems: "center",
    },
    scrubberContextText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textSecondary,
      fontVariant: ["tabular-nums"],
    },
    overlaysLayer: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 3,
    },
    skeletonDot: {
      position: "absolute",
      width: 52,
      height: 52,
      marginLeft: -26,
      marginTop: -26,
      borderRadius: 26,
      backgroundColor: theme.colors.cardElevated,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.border,
      opacity: 0.74,
    },
    courtTintTop: {
      position: "absolute",
      left: 0,
      right: 0,
      top: 0,
      height: "28%",
    },
    courtTintBottom: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: "28%",
    },
    courtCenterGlow: {
      position: "absolute",
      left: "26%",
      right: "26%",
      top: "37%",
      bottom: "37%",
      borderRadius: 999,
      borderWidth: 1,
    },
    courtMinimalVeil: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: isDark
        ? "rgba(6, 12, 21, 0.22)"
        : "rgba(244, 247, 251, 0.3)",
    },
    impactCard: {
      gap: theme.spacing[8],
    },
    impactMainRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    impactMainRowInner: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    impactAvatarStack: {
      position: "relative",
    },
    impactAvatarRing: {
      width: 40,
      height: 40,
      borderRadius: 20,
      padding: 2,
      alignItems: "center",
      justifyContent: "center",
      // Explicit zIndex so the photo layers above FireRingGlow (zIndex 0).
      zIndex: 2,
    },
    impactAvatarClip: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.pill,
      overflow: "hidden",
      backgroundColor: theme.colors.glassStrong,
    },
    impactAvatar: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.pill,
    },
    impactJerseyBadge: {
      position: "absolute",
      left: 4,
      right: 4,
      bottom: -6,
      minWidth: 22,
      minHeight: 13,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.bg,
      borderWidth: theme.borderWidth.hairline,
      borderColor: theme.colors.borderSoft,
      alignItems: "center",
      justifyContent: "center",
      // Must be above impactAvatarRing's zIndex (2) — without an explicit
      // value here this defaults to 0 and sinks behind the photo despite
      // being declared later in JSX.
      zIndex: 3,
    },
    impactJerseyBadgeText: {
      color: theme.colors.textPrimary,
      fontSize: 9,
      lineHeight: 11,
      fontWeight: "800",
    },
    impactMainCopy: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[2],
    },
    impactPlayerName: {
      fontSize: 15,
      lineHeight: 19,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    impactPlayText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textSecondary,
    },
    impactMeta: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
    impactRatingWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[4],
      flexShrink: 0,
    },
    impactRatingValue: {
      fontSize: 26,
      lineHeight: 30,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      fontVariant: ["tabular-nums"],
    },
    impactTrendTriangle: {
      width: 0,
      height: 0,
      borderLeftWidth: 5,
      borderRightWidth: 5,
      borderLeftColor: "transparent",
      borderRightColor: "transparent",
    },
    impactTrendUp: {
      borderBottomWidth: 8,
      borderBottomColor: "#00C853",
    },
    impactTrendDown: {
      borderTopWidth: 8,
      borderTopColor: "#F44336",
    },
    impactLiveRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
    },
    impactLiveDot: {
      width: 7,
      height: 7,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.success,
    },
    impactLiveText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    impactSeeAll: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-end",
      gap: theme.spacing[4],
    },
    impactSeeAllText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.accent,
    },
    impactToastWrap: {
      position: "absolute",
      left: theme.spacing[16],
      right:
        theme.spacing[24] + FLOATING_COMMENT_BUTTON_SIZE + theme.spacing[10],
      zIndex: 30,
    },
    impactToastCard: {
      minHeight: FLOATING_COMMENT_BUTTON_SIZE,
      borderRadius: theme.radius.lg,
      overflow: "hidden",
      justifyContent: "center",
      paddingHorizontal: theme.spacing[14],
      paddingVertical: theme.spacing[10],
      gap: theme.spacing[4],
      shadowColor: "#000000",
      shadowOpacity: 0.16,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 7 },
      elevation: 12,
    },
    impactToastGlassMask: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.lg,
      overflow: "hidden",
    },
    impactToastGlass: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.lg,
      overflow: "hidden",
    },
    impactToastFallbackGlass: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.lg,
      backgroundColor: "rgba(255,255,255,0.14)",
      borderWidth: theme.borderWidth.normal,
      borderColor: "rgba(255,255,255,0.12)",
    },
    impactToastContent: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: theme.spacing[14],
      gap: theme.spacing[4],
    },
    impactToastTopRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    impactToastEyebrow: {
      flex: 1,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      letterSpacing: 0.3,
      color: theme.colors.textMuted,
      textTransform: "uppercase",
    },
    impactToastTitle: {
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    impactToastRatingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[4],
      flexShrink: 0,
    },
    impactEmptyTitle: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "700",
      color: theme.colors.textPrimary,
    },
    impactEmptySubtext: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textSecondary,
    },
    empty: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
    helperCard: {
      gap: theme.spacing[8],
    },
    helperText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textSecondary,
    },
    helperButton: {
      alignSelf: "flex-start",
      minHeight: 34,
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceAlt,
      justifyContent: "center",
      paddingHorizontal: theme.spacing[12],
    },
    helperButtonText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textPrimary,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[8],
    },
    statusText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textPrimary,
    },
    statusSubtext: {
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
  });
}

export default function LiveTabOverview() {
  const { state: settingsState } = useSettingsState();
  const { tokens: theme, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  const { data, loading, error, refresh } = useLiveGame();
  const { state: profileState, savePrediction, syncPredictionsFromSnapshots } =
    useProfile();
  const { openPlayerModal } = useInGamePlayerModal();
  const [fieldSize, setFieldSize] = useState({ width: 0, height: 0 });
  const [impactToastPlay, setImpactToastPlay] = useState<LatestPlayToast | null>(null);
  const impactToastOpacity = useRef(new Animated.Value(0)).current;
  const impactToastTranslateY = useRef(new Animated.Value(28)).current;
  const impactToastLastKeyRef = useRef<string | null>(null);
  const teams = data?.teams ?? [];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];
  const homeLogoUri = normalizeTeamLogoUri(home?.logo) || FALLBACK_IMAGE_URI;
  const playersByTeam = data?.playersByTeam ?? {};
  const fieldState = data?.baseballOnField ?? null;
  const allPlayers = useMemo(() => Object.values(playersByTeam).flat(), [playersByTeam]);

  // Pre-game shows projected starters (by season rating) with season-rating
  // pills; once the game is live it switches to the actual on-court players with
  // live-rating pills. The court selection is also the single source of truth
  // for who is excluded from the bench.
  const isPreGame = isPreGameState(data?.status.state);
  const courtRatingModeOptions = useMemo(
    () => buildCourtRatingModeOptions(isPreGame, data?.mode),
    [isPreGame, data?.mode],
  );
  // Lazy initializer (not a hardcoded "season") because `isPreGame` is
  // frequently already correct on the very first render: opening a game from
  // the Home Screen seeds `data` (and thus `status.state`) before navigating
  // here, so a game that's already live or final often never has an
  // isPreGame TRUE→FALSE transition for the effect below to catch — it's
  // simply false from the start, and the old hardcoded "season" default was
  // left standing with nothing to ever switch it to "live". This lazy
  // initializer covers that already-resolved case; the effect below still
  // covers a game going pregame → live while the user is already on this
  // screen.
  const [courtRatingMode, setCourtRatingMode] = useState<CourtRatingMode>(() =>
    isPreGame ? "season" : "live",
  );
  const prevIsPreGameRef = useRef(isPreGame);
  useEffect(() => {
    if (prevIsPreGameRef.current && !isPreGame) {
      setCourtRatingMode("live");
    }
    prevIsPreGameRef.current = isPreGame;
  }, [isPreGame]);

  // --- Historical scrubber (completed games only) --------------------------
  // Declared here (not reusing the later `gameEnded`, which is defined after
  // this point in the file) since courtSelectionByTeam below needs to know
  // this immediately. Same underlying check either way.
  const isFinalForScrub = data?.status?.state === "post";
  const isBaseballForScrub = data?.sport === "baseball";
  const courtHistoryIndex = useMemo(() => {
    if (!data || !isFinalForScrub || isBaseballForScrub) {
      return null;
    }
    return buildCourtHistoryIndex(data);
  }, [data, isFinalForScrub, isBaseballForScrub]);
  // null = parked at the actual final state; a number = actively scrubbed to
  // that elapsed-game-second. Reset whenever a different game loads.
  const [scrubElapsedSec, setScrubElapsedSec] = useState<number | null>(null);
  useEffect(() => {
    setScrubElapsedSec(null);
  }, [data?.eventId]);
  const courtHistorySnapshot = useMemo(() => {
    if (!courtHistoryIndex || scrubElapsedSec === null) {
      return null;
    }
    return sampleCourtHistory(courtHistoryIndex, scrubElapsedSec);
  }, [courtHistoryIndex, scrubElapsedSec]);
  // The single override point: every downstream consumer below (court
  // placements, on-court/bench split, the court's own "highest rated" crown,
  // the bench dock) reads player.onCourt/inGameRating10/momentum off THIS
  // map instead of the live `playersByTeam` — when not scrubbing it's the
  // exact same reference, so nothing changes; while scrubbing, every one of
  // those consumers reflects the scrubbed instant with no changes needed in
  // CourtOverlay/CourtLineupDock/pickCourtFive themselves.
  const courtDisplayPlayersByTeam = useMemo(
    () =>
      courtHistorySnapshot ? projectPlayersAtSnapshot(playersByTeam, courtHistorySnapshot) : playersByTeam,
    [courtHistorySnapshot, playersByTeam],
  );

  const courtSelectionByTeam = useMemo(() => {
    const result: Record<string, LiveGamePlayer[]> = {};
    teams.forEach((team) => {
      result[team.id] = pickCourtFive(courtDisplayPlayersByTeam[team.id] ?? [], isPreGame);
    });
    return result;
  }, [teams, courtDisplayPlayersByTeam, isPreGame]);
  const courtHighestRatedPlayerId = useMemo(() => {
    const flat = Object.values(courtDisplayPlayersByTeam).flat();
    return getTopPlayers(flat, 1)[0]?.id ?? null;
  }, [courtDisplayPlayersByTeam]);
  const handleScrub = useCallback((elapsedSec: number) => {
    setScrubElapsedSec(elapsedSec);
  }, []);
  const handleScrubRelease = useCallback((elapsedSec: number) => {
    setScrubElapsedSec(elapsedSec);
  }, []);
  const handleSnapToLive = useCallback(() => {
    setScrubElapsedSec(null);
  }, []);
  // "Q2 · 6:45 — PHX 34, LA 28" context readout above the scrubber. Compact
  // period label derived from which marker segment the scrub position falls
  // in (same labeling PointDifferentialChart uses), not the raw ESPN period
  // text, so it reads consistently with the rest of the app.
  const scrubContextLabel = useMemo(() => {
    if (!courtHistoryIndex) {
      return null;
    }
    if (!courtHistorySnapshot) {
      const awayScore = away?.score ?? "-";
      const homeScore = home?.score ?? "-";
      return `Final — ${away?.abbreviation ?? "AWAY"} ${awayScore}, ${home?.abbreviation ?? "HOME"} ${homeScore}`;
    }
    let periodLabel = courtHistoryIndex.periodMarkers[0]?.label ?? "";
    for (const marker of courtHistoryIndex.periodMarkers) {
      if (marker.elapsedSec <= courtHistorySnapshot.elapsedSec) {
        periodLabel = marker.label;
      }
    }
    return `${periodLabel} · ${courtHistorySnapshot.clock || "0:00"} — ${away?.abbreviation ?? "AWAY"} ${courtHistorySnapshot.awayScore}, ${home?.abbreviation ?? "HOME"} ${courtHistorySnapshot.homeScore}`;
  }, [away?.abbreviation, away?.score, courtHistoryIndex, courtHistorySnapshot, home?.abbreviation, home?.score]);
  const courtPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    Object.values(courtSelectionByTeam).forEach((list) =>
      list.forEach((player) => ids.add(player.id)),
    );
    return ids;
  }, [courtSelectionByTeam]);

  // Pre-game: tap navigates to player profile. Live: opens the in-game modal.
  const handlePlayerPress = useCallback(
    (player: LiveGamePlayer) => {
      if (isPreGame && player.id) {
        router.push(`/player/${player.id}` as never);
        return;
      }
      openPlayerModal(player);
    },
    [isPreGame, openPlayerModal],
  );

  const topRated = useMemo(() => getTopPlayers(allPlayers, 8), [allPlayers]);
  // Global ranking across ALL players (unfiltered), so a player keeps their
  // overall rank number even when the list is filtered to a single team.
  const globalRankById = useMemo(() => {
    const map = new Map<string, number>();
    getTopPlayers(allPlayers, allPlayers.length).forEach((player, index) => {
      map.set(player.id, index + 1);
    });
    return map;
  }, [allPlayers]);
  // Rankings leaderboard tap: always opens the default Rating page — this
  // list is hardcoded to Impact Rating now (the Momentum toggle that used to
  // live here was removed; Momentum still lives under the court diagram's
  // own Season/Live/Momentum/NIL/Age toggle, a separate control).
  const handleRankedPlayerPress = useCallback(
    (player: LiveGamePlayer) => {
      openPlayerModal(player);
    },
    [openPlayerModal],
  );
  const [rankingsFilter, setRankingsFilter] = useState<string>("all");
  const rankingsFilterOptions = useMemo<TeamFilterOption[]>(() => {
    const opts: TeamFilterOption[] = [{ value: "all", label: "All" }];
    if (away?.id) {
      opts.push({
        value: away.id,
        label: away.abbreviation || away.shortDisplayName || "Away",
      });
    }
    if (home?.id) {
      opts.push({
        value: home.id,
        label: home.abbreviation || home.shortDisplayName || "Home",
      });
    }
    return opts;
  }, [
    away?.id,
    away?.abbreviation,
    away?.shortDisplayName,
    home?.id,
    home?.abbreviation,
    home?.shortDisplayName,
  ]);
  // Reset to "All" whenever the matchup changes so a stale team id can't linger.
  useEffect(() => {
    setRankingsFilter("all");
  }, [away?.id, home?.id]);
  const rankedPlayers = useMemo(() => {
    const pool =
      rankingsFilter === "all"
        ? allPlayers
        : allPlayers.filter((player) => player.teamId === rankingsFilter);
    return getTopPlayers(pool, 8);
  }, [allPlayers, rankingsFilter]);
  const highestRatedPlayer = useMemo(
    () => getTopPlayers(allPlayers, 1)[0] ?? null,
    [allPlayers],
  );
  const highestRatedPlayerId = highestRatedPlayer?.id ?? null;
  const showLiveImpact = settingsState.inGame.sections.liveImpact;
  const isBaseball = data?.sport === "baseball";
  const sparklinePulseEnabled = data?.status.state === "in";
  const awayCourtColor = normalizeHexColor(away?.color, theme.colors.accent);
  const homeCourtColor = normalizeHexColor(home?.color, theme.colors.accentStrong);
  const teamPrimaryColorById = useMemo(
    () => {
      const map = new Map<string, string>();
      teams.forEach((team) => {
        if (!team?.id) {
          return;
        }
        map.set(team.id, normalizeHexColor(team.color || team.alternateColor, theme.colors.accentStrong));
      });
      return map;
    },
    [teams, theme.colors.accentStrong],
  );
  const teamSecondaryColorById = useMemo(
    () => {
      const map = new Map<string, string>();
      teams.forEach((team) => {
        if (!team?.id) {
          return;
        }
        map.set(team.id, normalizeHexColor(team.alternateColor || team.color, theme.colors.accentStrong));
      });
      return map;
    },
    [teams, theme.colors.accentStrong],
  );

  const predictionSnapshot = useMemo(
    () => buildPredictionSnapshotFromLiveGame(data),
    [data],
  );
  const existingPrediction = useMemo(
    () =>
      predictionSnapshot
        ? profileState.predictions.find(
            (prediction) => prediction.gameId === predictionSnapshot.gameId,
          ) ?? null
        : null,
    [predictionSnapshot, profileState.predictions],
  );

  const latestImpactfulPlay = useMemo<LatestImpactfulPlay | null>(() => {
    const plays = data?.plays ?? [];
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

        const playIndex = plays.findIndex(
          (play) => play.id === impact.eventId || impact.eventId.startsWith(`${play.id}:`),
        );
        if (playIndex < 0) {
          return;
        }

        const play = plays[playIndex];
        const resolvedDelta = impact.displayDelta ?? impact.delta;
        const absDelta =
          typeof resolvedDelta === "number" && Number.isFinite(resolvedDelta)
            ? Math.abs(resolvedDelta)
            : 0;

        candidates.push({
          player,
          impact,
          play,
          periodRank: parsePeriodRank(play.period),
          clockRemaining: parseClockRemaining(play.clock),
          playIndex,
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
  }, [data?.plays, playersByTeam]);
  const latestPlayToast = useMemo<LatestPlayToast | null>(() => {
    const plays = data?.plays ?? [];
    if (plays.length === 0) {
      return null;
    }

    const latestPlayEntry = plays
      .map((play, index) => ({
        play,
        index,
        periodRank: parsePeriodRank(play.period),
        clockRemaining: parseClockRemaining(play.clock),
      }))
      .sort((a, b) => {
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

        return b.index - a.index;
      })[0];

    if (!latestPlayEntry) {
      return null;
    }

    let matchedPlayer: LiveGamePlayer | null = null;
    let matchedImpact: NonNullable<LiveGamePlayer["lastMeaningfulImpact"]> | null = null;
    Object.values(playersByTeam).some((teamPlayers) =>
      teamPlayers.some((player) => {
        const impact = player.lastMeaningfulImpact;
        if (!impact) {
          return false;
        }
        const matchesPlay =
          latestPlayEntry.play.id === impact.eventId ||
          impact.eventId.startsWith(`${latestPlayEntry.play.id}:`);
        if (!matchesPlay) {
          return false;
        }
        matchedPlayer = player;
        matchedImpact = impact;
        return true;
      }),
    );

    return {
      play: latestPlayEntry.play,
      player: matchedPlayer,
      impact: matchedImpact,
      periodRank: latestPlayEntry.periodRank,
      clockRemaining: latestPlayEntry.clockRemaining,
      playIndex: latestPlayEntry.index,
    };
  }, [data?.plays, playersByTeam]);
  const highlightedPlayerId = latestImpactfulPlay?.player.id ?? null;
  const impactIsLive = data?.status?.state === "in";
  const gameEnded = data?.status?.state === "post";
  const highlightedTrend = useMemo<"up" | "down" | "neutral" | null>(() => {
    if (!latestImpactfulPlay) {
      return null;
    }
    const delta =
      latestImpactfulPlay.impact.displayDelta ?? latestImpactfulPlay.impact.delta;
    if (typeof delta !== "number" || !Number.isFinite(delta)) {
      return "neutral";
    }
    if (delta > 0) {
      return "up";
    }
    if (delta < 0) {
      return "down";
    }
    return "neutral";
  }, [latestImpactfulPlay]);
  useEffect(() => {
    if (isBaseball || !latestPlayToast) {
      return;
    }

    const nextKey = [
      latestPlayToast.play.id,
      latestPlayToast.play.period,
      latestPlayToast.play.clock,
      latestPlayToast.play.homeScore,
      latestPlayToast.play.awayScore,
    ].join(":");

    if (impactToastLastKeyRef.current === null) {
      impactToastLastKeyRef.current = nextKey;
      setImpactToastPlay(latestPlayToast);
      impactToastOpacity.setValue(1);
      impactToastTranslateY.setValue(0);
      return;
    }

    if (impactToastLastKeyRef.current === nextKey) {
      return;
    }

    impactToastLastKeyRef.current = nextKey;
    setImpactToastPlay(latestPlayToast);
    impactToastOpacity.stopAnimation();
    impactToastTranslateY.stopAnimation();
    impactToastOpacity.setValue(0);
    impactToastTranslateY.setValue(28);
    Animated.parallel([
      Animated.timing(impactToastOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(impactToastTranslateY, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    impactToastOpacity,
    impactToastTranslateY,
    isBaseball,
    latestPlayToast,
  ]);
  const showPredictionModule =
    predictionSnapshot !== null &&
    (predictionSnapshot.gameStatus === "pre" || existingPrediction !== null);

  const rawFieldOverlays = useMemo<FieldOverlayInput[]>(() => {
    if (!isBaseball || !fieldState) {
      return [];
    }

    const overlays: FieldOverlayInput[] = [];
    const defense = fieldState.defense;
    const add = (
      player: LiveGamePlayer | null | undefined,
      spotKey: FieldSpotKey,
      role: OverlayRole,
      keyPrefix: string,
    ) => {
      if (!player) {
        return;
      }
      overlays.push({
        key: `${keyPrefix}:${player.id}:${spotKey}`,
        player,
        spotKey,
        role,
      });
    };

    add(defense.P, "P", "defense", "P");
    add(defense.C, "C", "defense", "C");
    add(defense["1B"], "BASE1", "defense", "1B");
    add(defense["2B"], "2B", "defense", "2B");
    add(defense.SS, "SS", "defense", "SS");
    add(defense["3B"], "BASE3", "defense", "3B");
    add(defense.LF, "LF", "defense", "LF");
    add(defense.CF, "CF", "defense", "CF");
    add(defense.RF, "RF", "defense", "RF");
    add(fieldState.batter, "BATTER", "batter", "BATTER");
    add(fieldState.runners.first, "BASE1", "runner", "R1");
    add(fieldState.runners.second, "BASE2", "runner", "R2");
    add(fieldState.runners.third, "BASE3", "runner", "R3");

    return overlays;
  }, [fieldState, isBaseball]);

  const fieldOverlays = useMemo<FieldOverlayPlacement[]>(() => {
    if (rawFieldOverlays.length === 0) {
      return [];
    }
    const bySpot = new Map<FieldSpotKey, FieldOverlayInput[]>();
    rawFieldOverlays.forEach((row) => {
      const list = bySpot.get(row.spotKey) ?? [];
      list.push(row);
      bySpot.set(row.spotKey, list);
    });

    const placed: FieldOverlayPlacement[] = [];
    bySpot.forEach((rows, spotKey) => {
      const placements = placeOverlaysAtSpot(spotKey, rows, {
        containerWidth: fieldSize.width,
        containerHeight: fieldSize.height,
      });
      placements.forEach((placement, index) => {
        placed.push({
          key: `${placement.item.key}:${index}`,
          player: placement.item.player,
          role: placement.item.role,
          left: formatOverlayPosition(placement.leftPct),
          top: formatOverlayPosition(placement.topPct),
        });
      });
    });

    return placed.sort((left, right) => {
      const rank = (role: OverlayRole) =>
        role === "runner" ? 3 : role === "batter" ? 2 : 1;
      return rank(left.role) - rank(right.role);
    });
  }, [fieldSize.height, fieldSize.width, rawFieldOverlays]);

  const onFieldLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== fieldSize.width || height !== fieldSize.height) {
      setFieldSize({ width, height });
    }
  };

  const showFieldSkeletons = isBaseball && (loading || fieldOverlays.length === 0);

  const fieldStatusTitle = useMemo(() => {
    if (!fieldState) {
      return "Live field positions";
    }
    const half = formatHalf(fieldState.meta.half);
    const inning = fieldState.meta.inning ? `${fieldState.meta.inning}` : "-";
    return `${half} ${inning}`;
  }, [fieldState]);

  const fieldStatusSubtitle = useMemo(() => {
    if (!fieldState) {
      return "Waiting for live tracking data.";
    }
    const outs = fieldState.meta.outs ?? "-";
    const balls = fieldState.meta.balls ?? "-";
    const strikes = fieldState.meta.strikes ?? "-";
    const onBase = fieldState.meta.onBaseCount;
    return `Outs ${outs} | Count ${balls}-${strikes} | On base ${onBase}`;
  }, [fieldState]);

  useEffect(() => {
    if (!predictionSnapshot) {
      return;
    }
    syncPredictionsFromSnapshots([predictionSnapshot]);
  }, [predictionSnapshot, syncPredictionsFromSnapshots]);

  const availableSectionIds = useMemo(() => {
    const ids: string[] = [];
    if (showPredictionModule && predictionSnapshot) {
      ids.push("prediction");
    }
    ids.push("court");
    if (isBaseball) {
      ids.push("field-status");
      if (error) {
        ids.push("field-error");
      }
    }
    // Before the game starts, the Court tab shows only the visual court —
    // no Latest Play or Live Rankings. (Momentum lives on the Odds tab.)
    if (showLiveImpact && !isPreGame) {
      ids.push("live-impact");
    }
    if (!isPreGame) {
      ids.push("top-players");
    }
    return ids;
  }, [
    error,
    isBaseball,
    isPreGame,
    predictionSnapshot,
    showLiveImpact,
    showPredictionModule,
  ]);
  useRegisterInGameSections("live", availableSectionIds);
  const visibleSectionIds = useMemo(
    () =>
      resolveInGameSectionIds(
        "live",
        settingsState.inGame.sectionLayoutsByTab,
        availableSectionIds,
      ).visibleIds,
    [availableSectionIds, settingsState.inGame.sectionLayoutsByTab],
  );
  const sectionNodes = useMemo<Record<string, ReactNode>>(
    () => ({
      prediction:
        showPredictionModule && predictionSnapshot ? (
          <PredictionPickerCard
            key="prediction"
            snapshot={predictionSnapshot}
            prediction={existingPrediction}
            onSavePrediction={(pickedTeamId) =>
              savePrediction(predictionSnapshot, pickedTeamId)
            }
          />
        ) : null,
      court: (
        // No card/elevated surface — the court floats directly on the screen's
        // dark base background, with the bench + coaches docked below it in the
        // same scroll.
        <View key="court" style={styles.courtSection}>
          {!isBaseball && isPreGame ? (
            <View style={styles.predictedLineupHeader}>
              <Text style={styles.predictedLineupLabel}>Predicted Lineup</Text>
            </View>
          ) : null}
          <View
            style={styles.courtShell}
            onLayout={isBaseball ? onFieldLayout : undefined}
          >
            {isBaseball ? (
              <BaseballFieldOutline variant="game" />
            ) : (
              <CourtOverlay
                teams={teams}
                playersByTeam={courtSelectionByTeam}
                ratingMode={courtRatingMode}
                // Deliberate 30% vertical-only shrink (width/aspect of the
                // court itself is unaffected). Unlike the old 0.75 value,
                // avatar size and the edge/logo-protection buffers inside
                // CourtOverlay now scale linearly with heightScale, so
                // players, photos, and rating pills stay proportional and
                // non-overlapping at this smaller height.
                heightScale={0.7}
                homeLogoUri={
                  settingsState.courtStyle === "minimal"
                    ? null
                    : homeLogoUri
                }
                highlightedPlayerId={highlightedPlayerId}
                highlightTrend={highlightedTrend}
                highestRatedPlayerId={courtHighestRatedPlayerId}
                onPlayerPress={handlePlayerPress}
              />
            )}
            {isBaseball ? (
              <View pointerEvents="box-none" style={styles.overlaysLayer}>
                {showFieldSkeletons
                  ? (["P", "C", "BASE1", "BASE2", "BASE3", "LF", "CF", "RF"] as FieldSpotKey[]).map(
                      (spot) => (
                        <View
                          key={`sk-${spot}`}
                          style={[
                            styles.skeletonDot,
                            {
                              left: `${FIELD_SPOTS[spot].xPct}%`,
                              top: `${FIELD_SPOTS[spot].yPct}%`,
                            },
                          ]}
                        />
                      ),
                    )
                  : null}
                {fieldOverlays.map((entry) => (
                  <PlayerBubble
                    key={entry.key}
                    player={entry.player}
                    left={entry.left}
                    top={entry.top}
                    teamColor={teamPrimaryColorById.get(entry.player.teamId)}
                    teamSecondaryColor={teamSecondaryColorById.get(entry.player.teamId)}
                    isHighestRated={entry.player.id === highestRatedPlayerId}
                    onPress={openPlayerModal}
                    leadingScorer={entry.role !== "defense"}
                  />
                ))}
              </View>
            ) : null}
            {settingsState.useTeamColorsOnCourt && !isBaseball ? (
              <>
                <View
                  pointerEvents="none"
                  style={[
                    styles.courtTintTop,
                    { backgroundColor: withAlpha(awayCourtColor, isDark ? 0.14 : 0.08) },
                  ]}
                />
                <View
                  pointerEvents="none"
                  style={[
                    styles.courtTintBottom,
                    { backgroundColor: withAlpha(homeCourtColor, isDark ? 0.18 : 0.1) },
                  ]}
                />
                <View
                  pointerEvents="none"
                  style={[
                    styles.courtCenterGlow,
                    {
                      backgroundColor: withAlpha(homeCourtColor, isDark ? 0.08 : 0.04),
                      borderColor: withAlpha(homeCourtColor, isDark ? 0.22 : 0.14),
                    },
                  ]}
                />
              </>
            ) : null}
            {settingsState.courtStyle === "minimal" && !isBaseball ? (
              <View pointerEvents="none" style={styles.courtMinimalVeil} />
            ) : null}
          </View>
          {/* Pregame has no live rating to toggle against — Season is the
              only meaningful mode then, and courtRatingMode already defaults
              to (and stays) "season" until kickoff, so hiding the control
              here doesn't strand the court/bench on the wrong mode. */}
          {!isBaseball && !isPreGame ? (
            <View style={styles.courtToggleRow}>
              <SegmentedControl
                value={courtRatingMode}
                options={courtRatingModeOptions}
                onChange={setCourtRatingMode}
                size="xs"
                equalWidth
                variant="glass"
              />
            </View>
          ) : null}
          {courtHistoryIndex ? (
            <>
              <View style={styles.scrubberContextRow}>
                <Text style={styles.scrubberContextText}>{scrubContextLabel}</Text>
              </View>
              <CourtHistoryScrubber
                index={courtHistoryIndex}
                elapsedSec={scrubElapsedSec}
                onScrub={handleScrub}
                onRelease={handleScrubRelease}
                onSnapToLive={handleSnapToLive}
                isFinal
              />
            </>
          ) : null}
          {!isBaseball ? (
            <CourtLineupDock
              teams={teams}
              playersByTeam={courtDisplayPlayersByTeam}
              courtPlayerIds={courtPlayerIds}
              ratingMode={courtRatingMode}
              substitutions={scrubElapsedSec === null ? data?.substitutions ?? [] : []}
              onPlayerPress={handlePlayerPress}
            />
          ) : null}
        </View>
      ),
      "field-status": isBaseball ? (
        <Card key="field-status" style={styles.helperCard}>
          <View style={styles.statusRow}>
            <Text style={styles.statusText}>{fieldStatusTitle}</Text>
            <Text style={styles.statusSubtext}>{fieldStatusSubtitle}</Text>
          </View>
          {!fieldState && !loading ? (
            <Text style={styles.helperText}>
              Live field positions are temporarily unavailable for this game.
            </Text>
          ) : null}
        </Card>
      ) : null,
      "field-error": isBaseball && error ? (
        <Card key="field-error" style={styles.helperCard}>
          <SectionHeader
            title="Could not refresh field view"
            subtitle="Live data fallback is active."
          />
          <Text style={styles.helperText}>{error}</Text>
          <Pressable style={styles.helperButton} onPress={refresh}>
            <Text style={styles.helperButtonText}>Retry</Text>
          </Pressable>
        </Card>
      ) : null,
      "live-impact": showLiveImpact ? (
        <Card key="live-impact">
          <LastPlayerImpactCard
            impact={latestImpactfulPlay}
            trend={highlightedTrend}
            isLive={impactIsLive}
            gameEnded={gameEnded}
            ringColor={
              latestImpactfulPlay
                ? teamSecondaryColorById.get(latestImpactfulPlay.player.teamId)
                : undefined
            }
            primaryColor={
              latestImpactfulPlay
                ? teamPrimaryColorById.get(latestImpactfulPlay.player.teamId)
                : undefined
            }
            styles={styles}
          />
        </Card>
      ) : null,
      "top-players": (
        <ExpandableSection
          key="top-players"
          title={gameEnded ? "Final Rankings" : "Live Rankings"}
          defaultExpanded
          collapsible={false}
          showHeaderDivider={false}
          right={
            <TeamFilterToggle
              options={rankingsFilterOptions}
              value={rankingsFilter}
              onChange={setRankingsFilter}
            />
          }
        >
          {rankedPlayers.length === 0 ? (
            <Text style={styles.empty}>No player ratings available yet.</Text>
          ) : null}
          <View>
            {rankedPlayers.map((player) => (
              <Reanimated.View
                entering={FadeIn.duration(180)}
                key={player.id}
                layout={Layout.springify().damping(30).stiffness(85)}
              >
                <SharedTopPlayerRow
                  player={player}
                  metric="impact"
                  rank={globalRankById.get(player.id)}
                  teamColor={teamSecondaryColorById.get(player.teamId)}
                  teamPrimaryColor={teamPrimaryColorById.get(player.teamId)}
                  isHighestRated={player.id === highestRatedPlayerId}
                  sparklinePulseEnabled={sparklinePulseEnabled}
                  onPress={handleRankedPlayerPress}
                  gameEnded={gameEnded}
                />
              </Reanimated.View>
            ))}
          </View>
        </ExpandableSection>
      ),
    }),
    [
      away?.abbreviation,
      away?.color,
      away?.id,
      away?.shortDisplayName,
      awayCourtColor,
      courtPlayerIds,
      courtRatingMode,
      handleRankedPlayerPress,
      courtRatingModeOptions,
      courtSelectionByTeam,
      data?.meta?.startDateTime,
      data?.status,
      data?.winProbability,
      error,
      existingPrediction,
      fieldOverlays,
      fieldState,
      fieldStatusSubtitle,
      fieldStatusTitle,
      gameEnded,
      globalRankById,
      highlightedPlayerId,
      highlightedTrend,
      highestRatedPlayerId,
      home?.abbreviation,
      home?.color,
      home?.id,
      home?.shortDisplayName,
      homeCourtColor,
      homeLogoUri,
      impactIsLive,
      isBaseball,
      isDark,
      latestImpactfulPlay,
      loading,
      openPlayerModal,
      playersByTeam,
      predictionSnapshot,
      refresh,
      savePrediction,
      settingsState.courtStyle,
      settingsState.useTeamColorsOnCourt,
      showFieldSkeletons,
      showLiveImpact,
      showPredictionModule,
      sparklinePulseEnabled,
      styles,
      teamPrimaryColorById,
      teamSecondaryColorById,
      teams,
      rankedPlayers,
      rankingsFilter,
      rankingsFilterOptions,
    ],
  );

  return (
    <View style={styles.screen}>
      <GameTabScreenScaffold>
        {data ? (
          visibleSectionIds.map((sectionId) => sectionNodes[sectionId] ?? null)
        ) : (
          // Brief window before any data has arrived (seed/shell/cache all
          // still pending) — skeleton instead of empty court/leaderboard
          // sections.
          <TabContentSkeleton cards={4} />
        )}
      </GameTabScreenScaffold>
      {impactToastPlay && !isBaseball ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.impactToastWrap,
            {
              bottom: Math.max(insets.bottom - theme.spacing[18], -theme.spacing[14]),
              opacity: impactToastOpacity,
              transform: [{ translateY: impactToastTranslateY }],
            },
          ]}
        >
          <View style={styles.impactToastCard}>
            {Platform.OS === "ios" ? (
              <View pointerEvents="none" style={styles.impactToastGlassMask}>
                <GlassView
                  glassEffectStyle="regular"
                  colorScheme="dark"
                  isInteractive={false}
                  style={styles.impactToastGlass}
                />
              </View>
            ) : (
              <View pointerEvents="none" style={styles.impactToastFallbackGlass} />
            )}
            <Text style={styles.impactToastTitle}>
              {impactToastPlay.play.text}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}
