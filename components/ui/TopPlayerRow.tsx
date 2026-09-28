import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";

import FireRingGlow, {
  getMomentumFireTierForPlayer,
  getMomentumFireTierVisual,
} from "@/components/ui/FireRingGlow";
import CrownPinBadge from "@/components/ui/CrownPinBadge";
import {
  buildMonotoneLinePath,
  smoothRatingColor,
} from "@/components/ui/PlayerRatingGraph";
import type { LiveGamePlayer } from "@/hooks/useLiveGame";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { getInGameRatingColor } from "@/theme/colors";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const TOP_PLAYER_RATING_COUNT_DURATION = 400;
const TOP_PLAYER_RATING_GLOW_DURATION = 1300;

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];

type TopPlayerRowProps = {
  player: LiveGamePlayer;
  teamColor?: string | null;
  teamPrimaryColor?: string | null;
  onPress: (player: LiveGamePlayer) => void;
  isHighestRated: boolean;
  sparklinePulseEnabled: boolean;
  /** 1-based ranking position, rendered to the left of the player. */
  rank?: number;
  /**
   * True once the game is final. The bench/starter distinction (BENCH tag +
   * dimmed row opacity) only makes sense while the game is live — after the
   * fact, a bench player's performance stands on its own (e.g. a 36-point
   * game off the bench shouldn't read as visually secondary), so both are
   * suppressed here regardless of `player.onCourt`.
   */
  gameEnded?: boolean;
  /**
   * Which metric the leaderboard is currently sorted by. In "momentum" mode the
   * 0-10 Impact rating badge is replaced by the signed momentum value and the
   * #1 crown becomes a flame. In "impact" mode a small flame badge still appears
   * on anyone whose current momentum exceeds +3.0 ("ranked #4 but on fire").
   */
  metric?: "impact" | "momentum";
};

// "On fire" glow (fire-ring image behind the avatar). The threshold + the
// visual itself now live in components/ui/FireRingGlow.tsx, shared by every
// in-game location that shows a player photo — this row passes its own
// photo (40px) and outer decorative ring (44.5px) diameters.
const PHOTO_DIAMETER = 40;
const AVATAR_RING_DIAMETER = 44.5;
// The #1 row (isHighestRated) gets a modest size bump so it stands out from
// the rest of the leaderboard at a glance — same ~4.5px ring-to-photo gap as
// the base sizes above, just scaled up.
const PHOTO_DIAMETER_HIGHEST = 46;
const AVATAR_RING_DIAMETER_HIGHEST = 50.5;

// Toggle: in Momentum mode, show the rolling "last 3 min" stat line (matching
// Momentum's own trailing window) instead of full-game cumulative stats.
// Flip to "full-game" to revert to the same pts/reb/ast line Impact mode
// uses, with no other code changes needed.
const MOMENTUM_STATS_DISPLAY_MODE: "recent" | "full-game" = "recent";

// "Last 3 min" (rounds to whole minutes) — makes it explicit this stat line
// is a rolling recent window, not the full-game total, since the numbers
// alone (e.g. "3 pts · 1 reb") read identically to a box-score line otherwise.
function formatWindowLabel(windowSec: number | undefined): string {
  const minutes = Math.max(1, Math.round((windowSec ?? 180) / 60));
  return `Last ${minutes} min`;
}

export function formatMomentumValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0.0";
  }
  const clamped = Math.max(-5, Math.min(5, value));
  return `${clamped > 0 ? "+" : ""}${clamped.toFixed(1)}`;
}

type RecentStats = NonNullable<LiveGamePlayer["momentumRecentStats"]>;
type RecentStatEntry = { label: string; value: number };

// "Top 3 stats from the last N minutes": points always first (even at 0, so
// the line never looks broken/empty), then the two most notable NON-ZERO
// categories from the window, ranked by VALUE — never padding with "0 reb ·
// 0 ast" just because those happen to be the traditional next two box-score
// columns. Ties broken by this fixed priority order (reb/ast/stl/blk/TO), so
// the line doesn't reorder from tick to tick when two categories are equal.
function buildRecentStatEntries(stats: RecentStats | undefined): RecentStatEntry[] {
  if (!stats) {
    return [];
  }
  const candidates: RecentStatEntry[] = [
    { label: "reb", value: stats.rebounds },
    { label: "ast", value: stats.assists },
    { label: "stl", value: stats.steals },
    { label: "blk", value: stats.blocks },
    { label: "TO", value: stats.turnovers },
  ];
  return candidates
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2);
}

function normalizeJerseyLabel(value: string | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return /^[0-9A-Za-z]{1,4}$/.test(trimmed) ? trimmed : "-";
}

function formatTopPlayerRating(value: number): string {
  return value.toFixed(1);
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
  // Same interpolation + color + fill treatment as the detailed player-detail
  // chart, scaled down (see PlayerRatingGraph).
  const linePath = buildMonotoneLinePath(normalized);
  const currentColor = smoothRatingColor(lastPoint.rating);
  const plotXStart = normalized[0]?.x ?? 0;
  const plotXEnd = lastPoint.x;
  const xSpan = Math.max(1e-6, plotXEnd - plotXStart);
  const minLineY = Math.min(...normalized.map((point) => point.y));
  const lineStops =
    normalized.length <= 1
      ? [
          { offset: 0, color: currentColor },
          { offset: 1, color: currentColor },
        ]
      : (() => {
          let lastOffset = -1;
          return normalized.map((point) => {
            let offset = Math.max(0, Math.min(1, (point.x - plotXStart) / xSpan));
            if (offset <= lastOffset) {
              offset = Math.min(1, lastOffset + 1e-4);
            }
            lastOffset = offset;
            return { offset, color: smoothRatingColor(point.rating) };
          });
        })();
  const gradientKey = useMemo(
    () =>
      normalized
        .map((point) => `${Math.round(point.x)}-${Math.round(point.y)}`)
        .join("_"),
    [normalized],
  );
  const lineGradientId = `top-player-line-${gradientKey}`;
  const fillGradientId = `top-player-fill-${gradientKey}`;
  const fillPath = `${linePath} L ${plotXEnd} ${height} L ${plotXStart} ${height} Z`;

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
            id={lineGradientId}
            x1={plotXStart}
            y1="0"
            x2={plotXEnd}
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            {lineStops.map((stop, index) => (
              <Stop
                key={`line-stop-${index}`}
                offset={stop.offset}
                stopColor={stop.color}
                stopOpacity="1"
              />
            ))}
          </LinearGradient>
          <LinearGradient
            id={fillGradientId}
            x1="0"
            y1={minLineY}
            x2="0"
            y2={height}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={currentColor} stopOpacity="0.24" />
            <Stop offset="0.28" stopColor={currentColor} stopOpacity="0.05" />
            <Stop offset="0.5" stopColor={currentColor} stopOpacity="0" />
            <Stop offset="1" stopColor={currentColor} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path d={fillPath} fill={`url(#${fillGradientId})`} />
        {/* Glassy glow: wide, low-opacity strokes under the crisp line */}
        <Path
          d={linePath}
          fill="none"
          stroke={`url(#${lineGradientId})`}
          strokeWidth={6}
          strokeOpacity={0.1}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d={linePath}
          fill="none"
          stroke={`url(#${lineGradientId})`}
          strokeWidth={4}
          strokeOpacity={0.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Crisp gradient line */}
        <Path
          d={linePath}
          fill="none"
          stroke={`url(#${lineGradientId})`}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
            backgroundColor: ratingColor,
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

// MOMENTUM-only mini chart: zero-centered, signed -5..+5, with green fill
// above the zero line and red fill below it — deliberately a different SHAPE
// from TopPlayerSparkline (which is a 0-10 ascending-style line), so the
// leaderboard's mini chart matches the full Momentum chart in the player
// modal (PlayerModal.tsx's PlayerMomentumChart) instead of just re-skinning
// the Impact/Rating sparkline in a different color.
const MOMENTUM_SPARK_RANGE = 5;
// Floor for the per-instance y-domain (see `domain` below) — without this, a
// player sitting near 0 the whole window would have their +/-0.05 noise
// scaled up to fill the whole chart height, looking like dramatic swings
// that aren't real.
const MOMENTUM_SPARK_MIN_DOMAIN = 0.35;
// Default trailing window (game seconds) the mini chart plots, matching
// Momentum's own ~3-minute window — see `windowSec` prop, which prefers the
// exact value from player.momentumRecentStats.windowSec when available.
const MOMENTUM_SPARK_DEFAULT_WINDOW_SEC = 180;

function MomentumSparkline({
  points,
  active,
  width = 84,
  height = 24,
  windowSec = MOMENTUM_SPARK_DEFAULT_WINDOW_SEC,
}: {
  points: Array<{ tSec: number; momentum: number }>;
  active: boolean;
  width?: number;
  height?: number;
  windowSec?: number;
}) {
  const { tokens: theme } = useAppTheme();
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const pulse = useRef(new Animated.Value(0)).current;
  const zeroY = height / 2;
  // Small enough that the line can swing almost the full chart height —
  // "more freedom vertically" — while still leaving the stroke itself
  // visible instead of clipped exactly at the edge.
  const padV = 1;
  const allPoints = points
    .filter((point) => Number.isFinite(point.tSec) && Number.isFinite(point.momentum))
    .map((point) => ({
      tSec: Math.max(0, point.tSec),
      momentum: Math.max(-MOMENTUM_SPARK_RANGE, Math.min(MOMENTUM_SPARK_RANGE, point.momentum)),
    }))
    .sort((a, b) => a.tSec - b.tSec);
  // Only plot the TRAILING WINDOW, not the whole game — a big spike from
  // much earlier in the game would otherwise dominate the domain below and
  // flatten the currently-relevant recent movement into a near-flat line
  // near the top, exactly the "always green, no visible dips" bug this is
  // fixing. This also keeps the mini chart honest about "momentum right
  // now," matching the row's own recent-stats framing.
  const latestTSec = allPoints.at(-1)?.tSec ?? 0;
  const windowed = allPoints.filter((point) => point.tSec >= latestTSec - windowSec);
  const safe = windowed.length >= 2 ? windowed : allPoints;
  const fallback =
    safe.length >= 2
      ? safe
      : [
          { tSec: 0, momentum: 0 },
          { tSec: 1, momentum: 0 },
        ];
  const duration = Math.max(1, fallback[fallback.length - 1]?.tSec ?? 1);
  // Scale tightly to THIS player's own min/max WITHIN THE WINDOW (zero-
  // centered, since the chart is signed), not a fixed -5..+5 domain — on the
  // fixed domain, real swings within the more common +/-1..2 range barely
  // move off the midline and read as flat. MOMENTUM_SPARK_MIN_DOMAIN keeps a
  // near-zero, barely-active player from having tiny +/-0.05 noise scaled up
  // into a dramatic-looking line.
  const observedAbsMax = fallback.reduce(
    (max, point) => Math.max(max, Math.abs(point.momentum)),
    0,
  );
  const domain = Math.max(MOMENTUM_SPARK_MIN_DOMAIN, observedAbsMax);
  const yFor = (momentum: number) => zeroY - (momentum / domain) * (zeroY - padV);
  const normalized = fallback.map((point) => ({
    ...point,
    x: (point.tSec / duration) * width,
    y: yFor(point.momentum),
  }));
  const lastPoint = normalized[normalized.length - 1] ?? { x: width, y: zeroY, momentum: 0 };
  const lineColor = lastPoint.momentum >= 0 ? theme.colors.success : theme.colors.danger;
  const linePath = buildMonotoneLinePath(normalized.map((point) => ({ x: point.x, y: point.y })));
  const firstX = normalized[0]?.x ?? 0;
  const lastX = lastPoint.x;
  const areaPath = (mode: "pos" | "neg"): string => {
    const clampMomentum = (momentum: number) =>
      mode === "pos" ? Math.max(momentum, 0) : Math.min(momentum, 0);
    const clamped = normalized.map((point) => ({
      x: point.x,
      y: yFor(clampMomentum(point.momentum)),
    }));
    const curve = buildMonotoneLinePath(clamped);
    if (!curve) {
      return "";
    }
    return `${curve} L ${lastX} ${zeroY} L ${firstX} ${zeroY} Z`;
  };
  const posGradientId = `top-player-momentum-pos-${instanceId}`;
  const negGradientId = `top-player-momentum-neg-${instanceId}`;

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

  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.65] });
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.95, 0.35] });

  return (
    <View style={{ width, height, justifyContent: "center", overflow: "visible" }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient
            id={posGradientId}
            x1="0"
            y1="0"
            x2="0"
            y2={zeroY}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={theme.colors.success} stopOpacity={0.55} />
            <Stop offset="1" stopColor={theme.colors.success} stopOpacity={0.05} />
          </LinearGradient>
          <LinearGradient
            id={negGradientId}
            x1="0"
            y1={height}
            x2="0"
            y2={zeroY}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={theme.colors.danger} stopOpacity={0.55} />
            <Stop offset="1" stopColor={theme.colors.danger} stopOpacity={0.05} />
          </LinearGradient>
        </Defs>
        <Path d={areaPath("pos")} fill={`url(#${posGradientId})`} />
        <Path d={areaPath("neg")} fill={`url(#${negGradientId})`} />
        <Line
          x1={0}
          y1={zeroY}
          x2={width}
          y2={zeroY}
          stroke={theme.colors.textMuted}
          strokeOpacity={0.3}
          strokeWidth={1}
        />
        <Path
          d={linePath}
          fill="none"
          stroke={lineColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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

    setGlowColor(clampedRating > previousRating ? colors.up : colors.down);
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

export default function TopPlayerRow({
  player,
  teamColor,
  teamPrimaryColor,
  onPress,
  isHighestRated,
  sparklinePulseEnabled,
  rank,
  metric = "impact",
  gameEnded = false,
}: TopPlayerRowProps) {
  const { tokens: theme, isDark } = useAppTheme();
  const jersey = normalizeJerseyLabel(player.jersey);
  const rating = player.inGameRating10;
  const ratingText = useAnimatedTopPlayerRatingText(rating);
  const ratingGlow = useTopPlayerRatingGlow(rating, {
    down: theme.colors.danger,
    up: theme.colors.success,
  });
  const ratingColor = getInGameRatingColor(rating);
  // MOMENTUM presentation (never mixed into the Impact rating/color above).
  const isMomentumMetric = metric === "momentum";
  const momentumValue = player.momentum ?? 0;
  const showRecentStats = isMomentumMetric && MOMENTUM_STATS_DISPLAY_MODE === "recent";
  const recentStats = player.momentumRecentStats;
  const recentStatEntries = buildRecentStatEntries(recentStats);
  const recentPoints = recentStats?.points ?? 0;
  // Literally "0 pts" alone (per the spec) only when there's truly nothing
  // else to show — points are 0 AND no other category registered.
  const isRecentActivityAllZero = recentPoints === 0 && recentStatEntries.length === 0;
  const badgeText = isMomentumMetric ? formatMomentumValue(momentumValue) : ratingText;
  const badgeColor = isMomentumMetric
    ? momentumValue > 0
      ? theme.colors.success
      : momentumValue < 0
        ? theme.colors.danger
        : theme.colors.textMuted
    : ratingColor;
  // "On fire" glow (fire-ring image behind the avatar): purely a function of
  // this player's own momentum VALUE, in either mode — not rank/position, so
  // on any given poll zero, one, or several rows can each show their own
  // tier independently (no "only #1 glows" restriction) — except a benched
  // player, whose momentum is stale and never earns a tier regardless of
  // value (see getMomentumFireTierForPlayer).
  const fireTier = getMomentumFireTierForPlayer(player);
  const showFireRingGlow = fireTier !== null;
  const fireTierVisual = fireTier ? getMomentumFireTierVisual(fireTier) : null;
  // The crown itself only makes sense in Impact mode now — Momentum's #1 is
  // signified entirely by the fire-ring glow, not a badge icon.
  const showCrownBadge = isHighestRated && !isMomentumMetric;
  if (__DEV__ && (isHighestRated || showFireRingGlow)) {
    console.log(
      `[fire-ring] player=${player.name} metric=${metric} isHighestRated=${isHighestRated} momentum=${momentumValue.toFixed(2)} fireTier=${fireTier ?? "none"} showCrownBadge=${showCrownBadge}`,
    );
  }
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
  const styles = useMemo(() => createStyles(theme, isDark), [isDark, theme]);
  const jerseyLabel = jersey !== "-" ? ` #${jersey}` : "";
  const nameLine = player.position
    ? `${player.name}${jerseyLabel} \u00B7 ${player.position}`
    : `${player.name}${jerseyLabel}`;
  const isBaseball = player.sport === "baseball";
  const baseballStatLine = isBaseball
    ? player.baseball?.primaryLine || `#${player.jersey || "-"} ${player.position || "-"}`
    : null;
  // Same `onCourt` flag that already drives the Court tab's on-court vs.
  // Bench grouping (see pickCourtFive/onCourtSet in app/(tabs)/live.tsx) —
  // bench players are visually de-emphasized here rather than filtered out,
  // so the leaderboard still shows the full roster.
  const isBench = !player.onCourt && !gameEnded;
  const photoDiameter = isHighestRated ? PHOTO_DIAMETER_HIGHEST : PHOTO_DIAMETER;
  const avatarRingDiameter = isHighestRated
    ? AVATAR_RING_DIAMETER_HIGHEST
    : AVATAR_RING_DIAMETER;

  return (
    <Pressable
      onPress={() => onPress(player)}
      style={({ pressed }) => [
        styles.row,
        {
          // Multiplied (not just swapped) so the press-state dim still reads
          // as a press on an already-dimmed bench row, instead of one
          // opacity silently overriding the other.
          opacity: (pressed ? theme.opacity.pressed : 1) * (isBench ? 0.55 : 1),
        },
      ]}
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
        {typeof rank === "number" ? (
          <Text style={styles.rankNumber}>{rank}</Text>
        ) : null}
        <View style={styles.avatarStack}>
          <FireRingGlow
            active={showFireRingGlow}
            photoDiameter={photoDiameter}
            visualDiameter={avatarRingDiameter}
            ratio={fireTierVisual?.ratio}
            opacity={fireTierVisual?.opacity}
            debugLabel={`fire-ring:top-player-row:${fireTier ?? "none"}`}
          />
          {showCrownBadge ? <CrownPinBadge photoDiameter={photoDiameter} /> : null}
          <View
            style={[
              styles.avatarRing,
              {
                width: avatarRingDiameter,
                height: avatarRingDiameter,
                borderRadius: avatarRingDiameter / 2,
                backgroundColor: normalizedTeamRingColor,
              },
            ]}
          >
            <View
              style={[
                styles.avatarClip,
                {
                  width: photoDiameter,
                  height: photoDiameter,
                  borderRadius: photoDiameter / 2,
                  backgroundColor: normalizedTeamPrimaryColor,
                },
              ]}
            >
              {isHighestRated ? (
                <Image source={{ uri: headshotUri }} style={styles.avatarGlow} blurRadius={6} />
              ) : null}
              <Image
                source={{ uri: headshotUri }}
                style={[
                  styles.avatar,
                  { width: photoDiameter, height: photoDiameter, borderRadius: photoDiameter / 2 },
                ]}
              />
            </View>
          </View>
          <View style={[styles.ratingBadge, { backgroundColor: badgeColor }]}>
            <Text style={styles.ratingText}>{badgeText}</Text>
          </View>
          {/* Momentum mode only: the main badge above already shows the
              signed momentum value, so this small secondary pill surfaces
              the player's overall Impact Rating alongside it — both visible
              at once without switching modes. */}
          {isMomentumMetric ? (
            <View style={[styles.impactBadge, { backgroundColor: ratingColor }]}>
              <Text style={styles.impactBadgeText}>{ratingText}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.nameWrap}>
          <View style={styles.nameRow}>
            <Text
              numberOfLines={1}
              style={[styles.name, isHighestRated ? styles.nameHighest : null]}
            >
              {nameLine}
            </Text>
            {isBench ? (
              <View style={styles.benchTag}>
                <Text style={styles.benchTagText}>BENCH</Text>
              </View>
            ) : null}
          </View>
          {isBaseball ? (
            <Text style={styles.meta} numberOfLines={1}>
              {baseballStatLine}
            </Text>
          ) : showRecentStats ? (
            <Text style={styles.meta} numberOfLines={1}>
              <Text style={styles.statNum}>{recentPoints}</Text>
              <Text style={styles.statUnit}> pts</Text>
              {isRecentActivityAllZero
                ? null
                : recentStatEntries.map((entry) => (
                    <Text key={entry.label}>
                      <Text style={styles.statSep}> · </Text>
                      <Text style={styles.statNum}>{entry.value}</Text>
                      <Text style={styles.statUnit}> {entry.label}</Text>
                    </Text>
                  ))}
              <Text style={styles.statSep}> · </Text>
              <Text style={styles.statUnit}>{formatWindowLabel(recentStats?.windowSec)}</Text>
            </Text>
          ) : (
            <Text style={styles.meta} numberOfLines={1}>
              <Text style={styles.statNum}>{player.points}</Text>
              <Text style={styles.statUnit}> pts</Text>
              <Text style={styles.statSep}> · </Text>
              <Text style={styles.statNum}>{player.rebounds}</Text>
              <Text style={styles.statUnit}> reb</Text>
              <Text style={styles.statSep}> · </Text>
              <Text style={styles.statNum}>{player.assists}</Text>
              <Text style={styles.statUnit}> ast</Text>
            </Text>
          )}
        </View>
      </View>

      <View style={styles.right}>
        {isMomentumMetric ? (
          <MomentumSparkline
            points={player.momentumTimelinePoints ?? []}
            active={player.onCourt && sparklinePulseEnabled}
            windowSec={player.momentumRecentStats?.windowSec}
          />
        ) : (
          <TopPlayerSparkline
            points={player.ratingTimelinePoints ?? []}
            active={player.onCourt && sparklinePulseEnabled}
            ratingColor={ratingColor}
          />
        )}
      </View>
    </Pressable>
  );
}

function createStyles(theme: AppThemeTokens, isDark: boolean) {
  return StyleSheet.create({
    row: {
      position: "relative",
      borderRadius: theme.radius.lg,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[10],
      minHeight: 68,
      paddingLeft: theme.spacing[8],
      paddingRight: theme.spacing[12],
      paddingVertical: theme.spacing[10],
    },
    ratingChangeGlow: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.lg,
      borderWidth: theme.borderWidth.normal,
    },
    rankNumber: {
      minWidth: 14,
      marginRight: -theme.spacing[2],
      textAlign: "center",
      fontSize: 13,
      lineHeight: 16,
      fontWeight: "800",
      color: theme.colors.textMuted,
      fontVariant: ["tabular-nums"],
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
      // Explicit zIndex so the photo unambiguously layers ABOVE fireRingGlow
      // (zIndex 0) and below the crown/rating badges (zIndex 4-5) on every
      // platform, now that a sibling in this stack declares its own zIndex.
      zIndex: 2,
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
    ratingBadge: {
      position: "absolute",
      top: -7,
      right: -8,
      zIndex: 5,
      minWidth: 32,
      height: 18,
      paddingHorizontal: 6,
      borderRadius: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
    },
    // Momentum mode only: secondary pill below the main (momentum) badge,
    // surfacing Impact Rating so both numbers are visible without switching
    // modes. Deliberately smaller/dimmer than ratingBadge so momentum stays
    // the visually primary value in this mode.
    impactBadge: {
      position: "absolute",
      bottom: -7,
      right: -8,
      zIndex: 5,
      minWidth: 26,
      height: 15,
      paddingHorizontal: 5,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      opacity: 0.9,
    },
    impactBadgeText: {
      fontSize: 9,
      lineHeight: 11,
      fontWeight: "800",
      letterSpacing: 0.2,
      color: theme.colors.bg,
    },
    nameWrap: {
      flex: 1,
      minWidth: 0,
    },
    nameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
    },
    name: {
      flexShrink: 1,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "700",
      color: theme.colors.textPrimary,
    },
    // #1 row (isHighestRated) — a small bump on top of the bigger avatar so
    // the whole row reads as "this one stands out," not just the photo.
    nameHighest: {
      fontSize: 15,
      lineHeight: 21,
    },
    // Matches the Court tab's own bench-tag treatment (see benchTag in
    // components/game/CourtLineupDock.tsx) so the same status reads the same
    // way everywhere it appears.
    benchTag: {
      flexShrink: 0,
      paddingHorizontal: 4,
      height: 14,
      justifyContent: "center",
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.textMuted,
    },
    benchTagText: {
      color: "#FFFFFF",
      fontSize: 8,
      lineHeight: 10,
      fontWeight: "800",
      letterSpacing: 0.3,
    },
    meta: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      letterSpacing: 0.2,
      color: theme.colors.textMuted,
    },
    statNum: {
      color: theme.colors.textSecondary,
      fontWeight: "800",
    },
    statUnit: {
      color: theme.colors.textMuted,
      fontWeight: "600",
    },
    statSep: {
      color: theme.colors.textMuted,
      fontWeight: "600",
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
