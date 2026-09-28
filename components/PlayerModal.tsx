import { router } from "expo-router";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Image,
  type LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { GlassView } from "expo-glass-effect";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TabView, type Route } from "react-native-tab-view";
import Svg, {
  Defs,
  Line as SvgLine,
  LinearGradient,
  Path,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import FireRingGlow, { isPlayerOnFire } from "@/components/ui/FireRingGlow";
import PlayerRatingGraph, {
  buildMonotoneLinePath,
  buildQuarterXMap,
  computeRatingDomain,
  ratingToYFraction,
} from "@/components/ui/PlayerRatingGraph";
import type { LiveGamePlayer, LiveGameTeam } from "@/hooks/useLiveGame";
import { useLiveGame } from "@/hooks/useLiveGame";
import { buildPlayerProfileHref } from "@/src/features/basketball/playerNavigation";
import { normalizeRemoteUri } from "@/src/loading/bootstrapAssets";
import { useReducedMotion } from "@/src/loading/useReducedMotion";
import { type ThemeTokens } from "@/src/theme/tokens";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { colors, getInGameRatingColor } from "@/theme/colors";

// The three swipeable chart pages, in display/paging order.
const CHART_VIEW_MODES = ["rating", "momentum", "rank"] as const;
type ChartViewMode = (typeof CHART_VIEW_MODES)[number];

type PlayerModalProps = {
  visible: boolean;
  player: LiveGamePlayer | null;
  onClose: () => void;
  /**
   * Which chart page to open on, for the anchor player only (any other
   * roster member reached by swiping still defaults to "rating") — e.g. the
   * Momentum leaderboard opens straight to the Momentum chart instead of
   * making the user re-toggle it every time.
   */
  initialChartMode?: ChartViewMode;
};

type StatRow = {
  label: string;
  value: string;
};

type RatingTimelinePoint = NonNullable<LiveGamePlayer["ratingTimelinePoints"]>[number];
type MomentumTimelinePoint = NonNullable<LiveGamePlayer["momentumTimelinePoints"]>[number];

type TeamAccentPalette = {
  primaryGlow: string;
  secondaryGlow: string;
  chipFill: string;
  chipBorder: string;
};

type PlayerRoute = Route & {
  playerId: string;
};

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const SHEET_HEIGHT_RATIO = 0.91;
const BACKDROP_MAX_OPACITY = 0.58;
const REDUCED_MOTION_DURATION = 170;
const DISMISS_VELOCITY = 1200;
const ROSTER_HEADER_HEIGHT = 92;
const ROSTER_MODAL_GAP = 12;
const ROSTER_ITEM_WIDTH = 62;
const STRIP_AVATAR_SIZE = 46;
// Placeholder season averages for the box-score deltas until real per-stat
// season data is wired up.
const SEASON_AVG_PLACEHOLDER: Record<string, number> = {
  PTS: 12.4,
  REB: 5.1,
  AST: 3.2,
  STL: 1.1,
};
// Timing measurements showed the sheet's open animation itself (tap ->
// visible commit -> "finished" callback) taking ~990ms — most of that isn't
// the visible slide-in, it's withSpring's long asymptotic tail before
// velocity/displacement cross its rest thresholds, especially with mass > 1.
// overshootClamping stops the spring the instant it reaches the target
// (no bounce to decay), and the higher stiffness/damping + looser rest
// thresholds mean "at rest" is declared as soon as the residual motion is
// imperceptible rather than mathematically exact, without changing how the
// slide-in actually looks.
const SPRING_CONFIG = {
  damping: 34,
  stiffness: 420,
  mass: 0.8,
  overshootClamping: true,
  restDisplacementThreshold: 0.5,
  restSpeedThreshold: 3,
};

function formatRating(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function formatImpactClock(clockSec: number): string {
  const minutes = Math.floor(clockSec / 60);
  const seconds = Math.max(0, clockSec % 60);
  return `${minutes}:${`${seconds}`.padStart(2, "0")}`;
}

function buildStatRows(player: LiveGamePlayer | null): StatRow[] {
  if (!player) {
    return [];
  }

  if (player.sport === "baseball") {
    return [
      { label: "ROLE", value: player.baseball?.role ?? "-" },
      { label: "LINE", value: player.baseball?.primaryLine ?? "-" },
      { label: "DETAIL", value: player.baseball?.secondaryLine ?? "-" },
      {
        label: "SHARE",
        value:
          typeof player.baseball?.impactShare === "number"
            ? `${(player.baseball.impactShare * 100).toFixed(0)}%`
            : "-",
      },
      {
        label: "CONF",
        value:
          typeof player.baseball?.confidence === "number"
            ? `${(player.baseball.confidence * 100).toFixed(0)}%`
            : "-",
      },
      { label: "RBI", value: `${player.baseball?.batting?.runsBattedIn ?? 0}` },
      { label: "HITS", value: `${player.baseball?.batting?.hits ?? 0}` },
      { label: "HR", value: `${player.baseball?.batting?.homeRuns ?? 0}` },
      { label: "SB", value: `${player.baseball?.batting?.stolenBases ?? 0}` },
      { label: "IP", value: `${player.baseball?.pitching?.inningsPitched ?? 0}` },
      { label: "K", value: `${player.baseball?.pitching?.strikeouts ?? 0}` },
      { label: "ER", value: `${player.baseball?.pitching?.earnedRuns ?? 0}` },
      { label: "ERA", value: formatRating(player.baseball?.pitching?.era, 2) },
      { label: "WHIP", value: formatRating(player.baseball?.pitching?.whip, 2) },
    ];
  }

  return [
    { label: "MIN", value: player.minutesDisplay ?? "-" },
    { label: "PTS", value: `${player.points ?? 0}` },
    { label: "REB", value: `${player.rebounds ?? 0}` },
    { label: "AST", value: `${player.assists ?? 0}` },
    { label: "STL", value: `${player.steals ?? 0}` },
    { label: "BLK", value: `${player.blocks ?? 0}` },
    { label: "TO", value: `${player.turnovers ?? 0}` },
    { label: "FG", value: player.fg ?? "-" },
    { label: "3PT", value: player.threePt ?? "-" },
    { label: "FT", value: player.ft ?? "-" },
    { label: "+/-", value: player.plusMinus ?? "-" },
    { label: "OREB", value: `${player.offensiveRebounds ?? 0}` },
    { label: "DREB", value: `${player.defensiveRebounds ?? 0}` },
    { label: "FLS", value: `${player.fouls ?? 0}` },
    { label: "SEASON", value: formatRating(player.seasonRating10) },
  ];
}

function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const raw = value.trim();
  if (!raw) {
    return null;
  }

  if (/^#[0-9a-fA-F]{6}$/.test(raw) || /^#[0-9a-fA-F]{3}$/.test(raw)) {
    return raw;
  }

  if (/^[0-9a-fA-F]{6}$/.test(raw) || /^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw}`;
  }

  return null;
}

function hexToRgba(hex: string | null, alpha: number, fallback: string): string {
  if (!hex) {
    return fallback;
  }

  const normalized = normalizeHexColor(hex);
  if (!normalized) {
    return fallback;
  }

  const color = normalized.slice(1);
  const expanded =
    color.length === 3
      ? color
          .split("")
          .map((value) => `${value}${value}`)
          .join("")
      : color;

  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);

  if (![r, g, b].every(Number.isFinite)) {
    return fallback;
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getContrastingTextColor(color: string, fallback: string): string {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return fallback;
  }

  const hex = normalized.slice(1);
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((value) => `${value}${value}`)
          .join("")
      : hex;
  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  return brightness >= 160 ? "#081018" : "#F8FAFC";
}

function resolveTeamAccentPalette(
  _team: LiveGameTeam | null,
  theme: ThemeTokens,
): TeamAccentPalette {
  return {
    primaryGlow: theme.colors.surfaceAlt,
    secondaryGlow: theme.colors.surface,
    chipFill: theme.colors.surfaceAlt,
    chipBorder: theme.colors.border,
  };
}

function buildMomentPlayer(
  player: LiveGamePlayer,
  point: RatingTimelinePoint | null,
): LiveGamePlayer {
  if (!point) {
    return player;
  }

  const stats = point.stats;
  if (!stats) {
    return {
      ...player,
      inGameRating10: point.rating,
      gameRating: point.rating,
      liveDisplay: point.rating,
    };
  }

  return {
    ...player,
    minutesDisplay: stats.minutesDisplay,
    points: stats.pts,
    rebounds: stats.reb,
    assists: stats.ast,
    steals: stats.stl,
    blocks: stats.blk,
    turnovers: stats.tov,
    fouls: stats.fls,
    fg: stats.fg,
    threePt: stats.threePt,
    ft: stats.ft,
    plusMinus: stats.plusMinus ?? player.plusMinus,
    offensiveRebounds: stats.oreb ?? player.offensiveRebounds,
    defensiveRebounds: stats.dreb ?? player.defensiveRebounds,
    inGameRating10: point.rating,
    gameRating: point.rating,
    liveDisplay: point.rating,
  };
}

function getPlayerInitials(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].replace(/[^0-9A-Za-z]/g, "").slice(0, 2).toUpperCase() || "?";
  }
  const first = parts[0].replace(/[^0-9A-Za-z]/g, "")[0] ?? "";
  const last = parts[parts.length - 1].replace(/[^0-9A-Za-z]/g, "")[0] ?? "";
  return `${first}${last}`.toUpperCase() || "?";
}

function StripPlayerItem({
  player,
  selected,
  teamColor,
  onPress,
  styles,
}: {
  player: LiveGamePlayer;
  selected: boolean;
  teamColor: string;
  onPress: (player: LiveGamePlayer) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const rating = player.inGameRating10;
  const ratingText =
    typeof rating === "number" && Number.isFinite(rating) ? rating.toFixed(1) : "-";
  const ratingBg = getInGameRatingColor(rating);
  const jerseyRaw = typeof player.jersey === "string" ? player.jersey.trim() : "";
  const jersey = /^[0-9A-Za-z]{1,4}$/.test(jerseyRaw) ? jerseyRaw : "-";
  const headshotUri = normalizeRemoteUri(player.headshot);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [headshotUri]);

  const showImage = headshotUri.length > 0 && !imageFailed;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`Select ${player.name}`}
      onPress={() => onPress(player)}
      style={styles.stripItem}
    >
      <View
        style={[
          styles.stripAvatarRing,
          { borderColor: selected ? teamColor : "transparent" },
        ]}
      >
        <FireRingGlow
          active={isPlayerOnFire(player)}
          photoDiameter={STRIP_AVATAR_SIZE}
          visualDiameter={STRIP_AVATAR_SIZE + 8}
          debugLabel="fire-ring:roster-strip"
        />
        {showImage ? (
          <Image
            source={{ uri: headshotUri }}
            style={styles.stripAvatar}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={styles.stripAvatarFallback}>
            <Text style={styles.stripInitials}>{getPlayerInitials(player.name)}</Text>
          </View>
        )}
        <View style={[styles.stripRatingPill, { backgroundColor: ratingBg }]}>
          <Text style={styles.stripRatingText}>{ratingText}</Text>
        </View>
        <View style={styles.stripJerseyBadge}>
          <Text style={styles.stripJerseyText}>#{jersey}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function PlayerModal({
  visible,
  player,
  onClose,
  initialChartMode,
}: PlayerModalProps) {
  if (__DEV__) {
    console.log(
      `[timing] PlayerModal function body running visible=${visible} player=${player?.id ?? "none"} @ ${performance.now().toFixed(1)}ms`,
    );
  }
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { data, gameId, mode } = useLiveGame();

  const [isMounted, setIsMounted] = useState(visible);
  const [activePlayer, setActivePlayer] = useState<LiveGamePlayer | null>(player);
  const [isHeadshotPreviewOpen, setIsHeadshotPreviewOpen] = useState(false);
  const [contentScrollEnabled, setContentScrollEnabled] = useState(true);
  const [chartScrubActive, setChartScrubActive] = useState(false);
  const [playerTabIndex, setPlayerTabIndex] = useState(0);

  const closeRequestedRef = useRef(false);
  const rosterScrollRef = useRef<ScrollView | null>(null);
  const hasCenteredRosterRef = useRef(false);
  const [rosterViewportWidth, setRosterViewportWidth] = useState(0);
  const [rosterContentWidth, setRosterContentWidth] = useState(0);
  const [rosterItemLayouts, setRosterItemLayouts] = useState<
    Record<string, { x: number; width: number }>
  >({});
  const previewSize = Math.min(windowWidth * 0.72, 320);
  const teamRoster = useMemo(() => {
    if (!activePlayer?.teamId) {
      return [];
    }

    const roster = data?.playersByTeam[activePlayer.teamId] ?? [];
    return [...roster].sort((left, right) => {
      const leftRating =
        typeof left.inGameRating10 === "number" ? left.inGameRating10 : -1;
      const rightRating =
        typeof right.inGameRating10 === "number" ? right.inGameRating10 : -1;
      if (leftRating !== rightRating) {
        return rightRating - leftRating;
      }
      return left.name.localeCompare(right.name);
    });
  }, [activePlayer?.teamId, data?.playersByTeam]);
  const playerRoutes = useMemo<PlayerRoute[]>(
    () =>
      teamRoster.map((rosterPlayer) => ({
        key: rosterPlayer.id,
        title: rosterPlayer.name,
        playerId: rosterPlayer.id,
      })),
    [teamRoster],
  );
  const rosterTopOffset = insets.top + theme.spacing[8];
  const rosterBlockHeight =
    teamRoster.length > 0 ? ROSTER_HEADER_HEIGHT + ROSTER_MODAL_GAP : 0;
  const topClearance = Math.max(
    insets.top + theme.spacing[16] + rosterBlockHeight,
    theme.spacing[28],
  );
  const sheetHeight = Math.min(
    windowHeight * SHEET_HEIGHT_RATIO,
    windowHeight - topClearance,
  );

  const translateY = useSharedValue(sheetHeight);
  const backdropOpacity = useSharedValue(0);
  const scrollOffsetY = useSharedValue(0);
  const sheetDragActive = useSharedValue(false);
  const gestureStartY = useSharedValue(0);

  const playerTeam = useMemo(
    () =>
      data?.teams.find((team) => team.id === activePlayer?.teamId) ?? null,
    [activePlayer?.teamId, data?.teams],
  );
  const stripTeamColor = normalizeHexColor(playerTeam?.color) ?? theme.colors.accent;
  const animateBackdropTo = useCallback(
    (target: number) => {
      backdropOpacity.value = withTiming(target, {
        duration: reducedMotion ? 120 : 180,
        easing: Easing.out(Easing.quad),
      });
    },
    [backdropOpacity, reducedMotion],
  );

  const animateSheetTo = useCallback(
    (target: number, onFinished?: () => void) => {
      if (reducedMotion) {
        translateY.value = withTiming(
          target,
          {
            duration: REDUCED_MOTION_DURATION,
            easing: Easing.out(Easing.cubic),
          },
          (finished) => {
            if (finished && onFinished) {
              runOnJS(onFinished)();
            }
          },
        );
        return;
      }

      translateY.value = withSpring(target, SPRING_CONFIG, (finished) => {
        if (finished && onFinished) {
          runOnJS(onFinished)();
        }
      });
    },
    [reducedMotion, translateY],
  );

  const beginClose = useCallback(
    (notifyParent: boolean, afterClose?: () => void) => {
      if (closeRequestedRef.current) {
        return;
      }

      closeRequestedRef.current = true;
      animateBackdropTo(0);
      animateSheetTo(sheetHeight, () => {
        scrollOffsetY.value = 0;
        sheetDragActive.value = false;
        closeRequestedRef.current = false;
        setContentScrollEnabled(true);
        setChartScrubActive(false);
        setIsHeadshotPreviewOpen(false);
        setIsMounted(false);
        if (notifyParent) {
          onClose();
        }
        afterClose?.();
      });
    },
    [
      animateBackdropTo,
      animateSheetTo,
      onClose,
      scrollOffsetY,
      sheetDragActive,
      sheetHeight,
    ],
  );

  const handleRequestClose = useCallback(() => {
    if (isHeadshotPreviewOpen) {
      setIsHeadshotPreviewOpen(false);
      return;
    }
    beginClose(true);
  }, [beginClose, isHeadshotPreviewOpen]);

  const openProfileForPlayer = useCallback((playerToOpen: LiveGamePlayer) => {
    if (!playerToOpen?.id || playerToOpen.sport === "baseball") {
      return;
    }

    const profileTeam =
      data?.teams.find((team) => team.id === playerToOpen.teamId) ?? null;

    beginClose(true, () => {
      requestAnimationFrame(() => {
        router.push(
          buildPlayerProfileHref({
            player: playerToOpen,
            mode,
            gameId,
            team: profileTeam,
          }) as never,
        );
      });
    });
  }, [beginClose, data?.teams, gameId, mode]);

  useEffect(() => {
    if (visible && player) {
      setActivePlayer(player);
    }
  }, [player, visible]);

  useEffect(() => {
    setIsHeadshotPreviewOpen(false);
  }, [player?.id, visible]);

  useEffect(() => {
    if (!activePlayer?.id || playerRoutes.length === 0) {
      if (playerTabIndex !== 0) {
        setPlayerTabIndex(0);
      }
      return;
    }

    const nextIndex = playerRoutes.findIndex(
      (route) => route.playerId === activePlayer.id,
    );
    if (nextIndex >= 0 && nextIndex !== playerTabIndex) {
      setPlayerTabIndex(nextIndex);
    }
  }, [activePlayer?.id, playerRoutes, playerTabIndex]);

  useEffect(() => {
    const activeLayout = activePlayer?.id
      ? rosterItemLayouts[activePlayer.id]
      : null;
    if (
      !activeLayout ||
      rosterViewportWidth <= 0 ||
      rosterContentWidth <= rosterViewportWidth
    ) {
      return;
    }

    const itemCenterX = activeLayout.x + activeLayout.width / 2;
    const targetX = Math.max(
      0,
      Math.min(
        itemCenterX - rosterViewportWidth / 2,
        rosterContentWidth - rosterViewportWidth,
      ),
    );

    rosterScrollRef.current?.scrollTo({
      x: targetX,
      y: 0,
      animated: hasCenteredRosterRef.current,
    });
    hasCenteredRosterRef.current = true;
  }, [activePlayer?.id, rosterContentWidth, rosterItemLayouts, rosterViewportWidth]);

  useEffect(() => {
    if (visible) {
      if (!isMounted) {
        translateY.value = sheetHeight;
        backdropOpacity.value = 0;
        setIsMounted(true);
        return;
      }

      closeRequestedRef.current = false;
      setContentScrollEnabled(true);
      setChartScrubActive(false);
      scrollOffsetY.value = 0;
      sheetDragActive.value = false;
      animateBackdropTo(BACKDROP_MAX_OPACITY);
      if (__DEV__) {
        console.log(
          `[timing] PlayerModal starting open animation player=${activePlayer?.id ?? "none"} @ ${performance.now().toFixed(1)}ms`,
        );
        animateSheetTo(0, () => {
          console.log(
            `[timing] PlayerModal open animation finished player=${activePlayer?.id ?? "none"} @ ${performance.now().toFixed(1)}ms`,
          );
          if (activePlayer?.id) {
            console.timeEnd(`[timing] player-modal-open:${activePlayer.id}`);
          }
        });
      } else {
        animateSheetTo(0);
      }
      return;
    }

    if (isMounted) {
      beginClose(false);
    }
  }, [
    animateBackdropTo,
    animateSheetTo,
    backdropOpacity,
    beginClose,
    isMounted,
    scrollOffsetY,
    sheetDragActive,
    sheetHeight,
    translateY,
    visible,
  ]);

  useAnimatedReaction(
    () => sheetDragActive.value,
    (isDragging, wasDragging) => {
      if (isDragging !== wasDragging) {
        runOnJS(setContentScrollEnabled)(!isDragging);
      }
    },
    [sheetDragActive],
  );

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollOffsetY.value = Math.max(0, event.contentOffset.y);
    },
  });

  const nativeScrollGesture = useMemo(() => Gesture.Native(), []);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isMounted && !isHeadshotPreviewOpen)
        .simultaneousWithExternalGesture(nativeScrollGesture)
        .onBegin(() => {
          gestureStartY.value = translateY.value;
          sheetDragActive.value = false;
        })
        .onUpdate((event) => {
          const atTop = scrollOffsetY.value <= 0.5;
          const shouldMoveSheet =
            sheetDragActive.value ||
            translateY.value > 0 ||
            (atTop && event.translationY > 0);

          if (!shouldMoveSheet) {
            return;
          }

          sheetDragActive.value = true;
          const nextTranslate = Math.max(
            0,
            Math.min(sheetHeight, gestureStartY.value + event.translationY),
          );
          translateY.value = nextTranslate;
          backdropOpacity.value =
            BACKDROP_MAX_OPACITY *
            Math.max(0, 1 - nextTranslate / Math.max(1, sheetHeight));
        })
        .onEnd((event) => {
          if (!sheetDragActive.value && translateY.value <= 0) {
            return;
          }

          const shouldDismiss =
            translateY.value > Math.max(96, sheetHeight * 0.18) ||
            event.velocityY > DISMISS_VELOCITY;

          sheetDragActive.value = false;

          if (shouldDismiss) {
            runOnJS(beginClose)(true);
            return;
          }

          backdropOpacity.value = withTiming(BACKDROP_MAX_OPACITY, {
            duration: reducedMotion ? 100 : 160,
            easing: Easing.out(Easing.quad),
          });
          if (reducedMotion) {
            translateY.value = withTiming(0, {
              duration: REDUCED_MOTION_DURATION,
              easing: Easing.out(Easing.cubic),
            });
          } else {
            translateY.value = withSpring(0, SPRING_CONFIG);
          }
        }),
    [
      beginClose,
      gestureStartY,
      isHeadshotPreviewOpen,
      isMounted,
      nativeScrollGesture,
      reducedMotion,
      scrollOffsetY,
      sheetDragActive,
      sheetHeight,
      translateY,
      backdropOpacity,
    ],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const rosterStyle = useAnimatedStyle(() => {
    const visibility = Math.max(
      0,
      Math.min(1, 1 - translateY.value / Math.max(1, sheetHeight)),
    );

    return {
      opacity: visibility,
      transform: [{ translateY: -18 * (1 - visibility) }],
    };
  });

  const renderPlayerScene = useCallback(
    ({ route }: { route: PlayerRoute }) => {
      const routePlayer =
        teamRoster.find((rosterPlayer) => rosterPlayer.id === route.playerId) ?? null;
      if (!routePlayer) {
        return <View style={styles.playerPager} />;
      }

      const routePlayerTeam =
        data?.teams.find((team) => team.id === routePlayer.teamId) ?? null;

      return (
        <PlayerModalScene
          contentScrollEnabled={contentScrollEnabled}
          initialChartMode={routePlayer.id === player?.id ? initialChartMode : undefined}
          insetsBottom={insets.bottom}
          nativeScrollGesture={nativeScrollGesture}
          onHeadshotPress={() => {
            setActivePlayer(routePlayer);
            setIsHeadshotPreviewOpen(true);
          }}
          onOpenProfile={() => openProfileForPlayer(routePlayer)}
          onScroll={onScroll}
          player={routePlayer}
          playerTeam={routePlayerTeam}
          setChartScrubActive={setChartScrubActive}
          setContentScrollEnabled={setContentScrollEnabled}
          styles={styles}
          theme={theme}
        />
      );
    },
    [
      contentScrollEnabled,
      data?.teams,
      initialChartMode,
      insets.bottom,
      nativeScrollGesture,
      onScroll,
      openProfileForPlayer,
      player?.id,
      styles,
      teamRoster,
      theme,
    ],
  );

  if (!isMounted || !activePlayer) {
    return null;
  }

  return (
    <Modal
      visible
      animationType="none"
      transparent
      onRequestClose={handleRequestClose}
    >
      <View style={styles.modalRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleRequestClose}>
          <Animated.View
            pointerEvents="none"
            style={[styles.backdrop, backdropStyle]}
          />
        </Pressable>

        {teamRoster.length > 0 ? (
          <Animated.View
            onLayout={(event) => {
              const nextWidth = event.nativeEvent.layout.width;
              if (nextWidth !== rosterViewportWidth) {
                setRosterViewportWidth(nextWidth);
              }
            }}
            style={[
              styles.rosterHeader,
              {
                top: rosterTopOffset,
                left: theme.spacing[10],
                right: theme.spacing[10],
              },
              rosterStyle,
            ]}
          >
            {Platform.OS === "ios" ? (
              <GlassView
                pointerEvents="none"
                glassEffectStyle="regular"
                colorScheme="dark"
                style={styles.rosterGlass}
              />
            ) : (
              <View pointerEvents="none" style={styles.rosterGlassFallback} />
            )}
            <ScrollView
              ref={rosterScrollRef}
              horizontal
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              snapToAlignment="start"
              snapToInterval={ROSTER_ITEM_WIDTH}
              onContentSizeChange={(width) => {
                if (width !== rosterContentWidth) {
                  setRosterContentWidth(width);
                }
              }}
              contentContainerStyle={styles.rosterSliderContent}
            >
              {teamRoster.map((rosterPlayer) => (
                <View
                  key={rosterPlayer.id}
                  onLayout={(event) => {
                    const { x, width } = event.nativeEvent.layout;
                    setRosterItemLayouts((current) => {
                      const previous = current[rosterPlayer.id];
                      if (
                        previous &&
                        previous.x === x &&
                        previous.width === width
                      ) {
                        return current;
                      }
                      return {
                        ...current,
                        [rosterPlayer.id]: { x, width },
                      };
                    });
                  }}
                  style={styles.rosterSliderItem}
                >
                  <StripPlayerItem
                    player={rosterPlayer}
                    selected={rosterPlayer.id === activePlayer.id}
                    teamColor={stripTeamColor}
                    onPress={setActivePlayer}
                    styles={styles}
                  />
                </View>
              ))}
            </ScrollView>
          </Animated.View>
        ) : null}

        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[
              styles.sheet,
              {
                height: sheetHeight,
                paddingBottom: insets.bottom,
              },
              sheetStyle,
            ]}
          >
            <View style={styles.grabber} />
            <TabView
              navigationState={{
                index: playerTabIndex,
                routes: playerRoutes,
              }}
              renderScene={renderPlayerScene}
              onIndexChange={(nextIndex) => {
                setPlayerTabIndex(nextIndex);
                const nextPlayer = teamRoster[nextIndex];
                if (nextPlayer) {
                  setActivePlayer(nextPlayer);
                }
              }}
              renderTabBar={() => null}
              initialLayout={{ width: Math.max(0, windowWidth - theme.spacing[20]) }}
              animationEnabled
              swipeEnabled={playerRoutes.length > 1 && !chartScrubActive}
              lazy
              pagerStyle={styles.playerPager}
              style={styles.playerPager}
            />

            {activePlayer.id && activePlayer.sport !== "baseball" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open player profile"
                onPress={() => openProfileForPlayer(activePlayer)}
                style={[
                  styles.profileButton,
                  { bottom: insets.bottom + theme.spacing[12] },
                ]}
              >
                {Platform.OS === "ios" ? (
                  <GlassView
                    pointerEvents="none"
                    glassEffectStyle="regular"
                    colorScheme="dark"
                    style={styles.profileButtonGlass}
                  />
                ) : (
                  <View
                    pointerEvents="none"
                    style={styles.profileButtonGlassFallback}
                  />
                )}
                <Text style={styles.profileButtonText}>Profile</Text>
              </Pressable>
            ) : null}
          </Animated.View>
        </GestureDetector>

        {isHeadshotPreviewOpen ? (
          <View style={styles.previewLayer} pointerEvents="box-none">
            <Pressable
              style={styles.previewBackdrop}
              onPress={() => setIsHeadshotPreviewOpen(false)}
            />
            <View style={styles.previewContent} pointerEvents="box-none">
              <Pressable onPress={() => {}} accessible={false}>
                <Image
                  source={{ uri: activePlayer.headshot || FALLBACK_IMAGE_URI }}
                  style={[
                    styles.previewImage,
                    {
                      width: previewSize,
                      height: previewSize,
                      borderRadius: previewSize / 2,
                    },
                  ]}
                />
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function PlayerHeroHeader({
  canOpenProfile,
  onHeadshotPress,
  onOpenProfile,
  player,
  ratingColor,
  ratingTextColor,
  styles,
}: {
  canOpenProfile: boolean;
  onHeadshotPress: () => void;
  onOpenProfile: () => void;
  player: LiveGamePlayer;
  ratingColor: string;
  ratingTextColor: string;
  styles: ReturnType<typeof createStyles>;
}) {
  // Matches the Bench section's PlayerUnit layout (CourtLineupDock.tsx):
  // name + small grey jersey number on one row, position on its own line
  // below. Rank is no longer folded into that combined line now that Rank
  // is its own chart tab — it rides along on the position line instead, so
  // the "which rank" info still has a home at a glance without recreating
  // the old single-line "F · #25 · Rank #1" format.
  const positionLabel = player.position || null;
  const rankLabel =
    typeof player.gameRank === "number" ? `Rank #${player.gameRank}` : null;
  const subtitle = [positionLabel, rankLabel]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  return (
    <View style={styles.identityBlock}>
      <Pressable
        accessibilityLabel="View enlarged player photo"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onHeadshotPress}
        style={styles.identityHeadshotWrap}
      >
        <FireRingGlow
          active={isPlayerOnFire(player)}
          photoDiameter={104}
          debugLabel="fire-ring:player-modal-hero"
        />
        <Image
          source={{ uri: player.headshot || FALLBACK_IMAGE_URI }}
          style={styles.identityHeadshot}
        />
        <View style={[styles.identityRatingBadge, { backgroundColor: ratingColor }]}>
          <Text style={[styles.identityRatingValue, { color: ratingTextColor }]}>
            {formatRating(player.inGameRating10)}
          </Text>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole={canOpenProfile ? "button" : undefined}
        disabled={!canOpenProfile}
        onPress={canOpenProfile ? onOpenProfile : undefined}
        style={styles.identityNameWrap}
      >
        <View style={styles.identityNameRow}>
          <Text numberOfLines={1} style={styles.identityName}>
            {player.name || "Player"}
          </Text>
          {player.jersey ? (
            <Text style={styles.identityJerseyNum}>{player.jersey}</Text>
          ) : null}
        </View>
      </Pressable>

      {subtitle ? (
        <Text numberOfLines={1} style={styles.identitySubtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

function PlayerModalScene({
  contentScrollEnabled,
  initialChartMode,
  insetsBottom,
  nativeScrollGesture,
  onHeadshotPress,
  onOpenProfile,
  onScroll,
  player,
  playerTeam,
  setChartScrubActive,
  setContentScrollEnabled,
  styles,
  theme,
}: {
  contentScrollEnabled: boolean;
  initialChartMode?: ChartViewMode;
  insetsBottom: number;
  nativeScrollGesture: ReturnType<typeof Gesture.Native>;
  onHeadshotPress: () => void;
  onOpenProfile: () => void;
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
  player: LiveGamePlayer;
  playerTeam: LiveGameTeam | null;
  setChartScrubActive: Dispatch<SetStateAction<boolean>>;
  setContentScrollEnabled: Dispatch<SetStateAction<boolean>>;
  styles: ReturnType<typeof createStyles>;
  theme: ThemeTokens;
}) {
  const [selectedTimelinePoint, setSelectedTimelinePoint] =
    useState<RatingTimelinePoint | null>(null);
  const [showSeasonComparison, setShowSeasonComparison] = useState(false);
  const momentPlayer = useMemo(
    () => buildMomentPlayer(player, selectedTimelinePoint),
    [player, selectedTimelinePoint],
  );
  const teamAccent = useMemo(
    () => resolveTeamAccentPalette(playerTeam, theme),
    [playerTeam, theme],
  );
  const statRows = useMemo(() => buildStatRows(momentPlayer), [momentPlayer]);
  const ratingColor = getInGameRatingColor(momentPlayer.inGameRating10);
  const ratingTextColor = getContrastingTextColor(
    ratingColor,
    theme.colors.textPrimary,
  );
  const canOpenProfile = Boolean(player.id) && player.sport !== "baseball";

  const handleScrubPointChange = useCallback(
    (point: RatingTimelinePoint | null) => {
      setSelectedTimelinePoint(point);
    },
    [],
  );
  const handleScrubActiveChange = useCallback(
    (active: boolean) => {
      setChartScrubActive(active);
      setContentScrollEnabled(!active);
      if (!active) {
        setSelectedTimelinePoint(null);
      }
    },
    [setChartScrubActive, setContentScrollEnabled],
  );

  return (
    <GestureDetector gesture={nativeScrollGesture}>
      <Animated.ScrollView
        bounces={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insetsBottom + theme.spacing[32] },
        ]}
        onScroll={onScroll}
        overScrollMode="never"
        scrollEnabled={contentScrollEnabled}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <PlayerHeroHeader
          canOpenProfile={canOpenProfile}
          onHeadshotPress={onHeadshotPress}
          onOpenProfile={onOpenProfile}
          player={momentPlayer}
          ratingColor={ratingColor}
          ratingTextColor={ratingTextColor}
          styles={styles}
        />

        <PlayerImpactChartCard
          initialChartMode={initialChartMode}
          onScrubActiveChange={handleScrubActiveChange}
          onScrubPointChange={handleScrubPointChange}
          player={player}
          seasonComparisonActive={showSeasonComparison}
          onToggleSeasonComparison={() =>
            setShowSeasonComparison((current) => !current)
          }
          styles={styles}
          theme={theme}
        />

        <PlayerBoxScoreGrid
          player={momentPlayer}
          statRows={statRows}
          seasonComparisonActive={showSeasonComparison}
          styles={styles}
        />

        <PlayerPlayHistoryCard
          player={player}
          styles={styles}
          teamAccent={teamAccent}
          theme={theme}
        />
      </Animated.ScrollView>
    </GestureDetector>
  );
}

type RankGraphPoint = {
  tSec: number;
  rating: number;
  period?: number;
  clockSec?: number;
};

// Build this player's RANK-over-time series. A player only becomes "rankable"
// once they've had their first rating-affecting event, so the pool grows during
// the game and the rank axis range (1..rankable) changes accordingly. Rank 1 =
// highest rating among rankable players at that moment.
function buildRankTimeline(
  player: LiveGamePlayer,
  allPlayers: LiveGamePlayer[],
): { points: RankGraphPoint[]; maxRank: number } {
  const seriesById = new Map<
    string,
    { firstTSec: number; pts: { tSec: number; rating: number }[] }
  >();
  for (const candidate of allPlayers) {
    const real = (candidate.ratingTimelinePoints ?? [])
      .filter(
        (point) =>
          Boolean(point.eventId) &&
          Number.isFinite(point.tSec) &&
          Number.isFinite(point.rating),
      )
      .map((point) => ({ tSec: Math.max(0, point.tSec), rating: point.rating }))
      .sort((a, b) => a.tSec - b.tSec);
    if (real.length > 0) {
      seriesById.set(candidate.id, { firstTSec: real[0].tSec, pts: real });
    }
  }

  const self = seriesById.get(player.id);
  if (!self) {
    return { points: [], maxRank: 1 };
  }

  const ratingAtOrBefore = (
    pts: { tSec: number; rating: number }[],
    t: number,
  ): number | null => {
    let resolved: number | null = null;
    for (const point of pts) {
      if (point.tSec <= t) resolved = point.rating;
      else break;
    }
    return resolved;
  };

  // Rank among all players rankable at time t (using each player's rating as of
  // t). `currentRatingById` optionally overrides with authoritative live ratings
  // for the current-moment sample.
  const rankAt = (
    t: number,
    selfRating: number,
    currentRatingById?: Map<string, number | null>,
  ): { rank: number; pool: number } => {
    let ahead = 0;
    let pool = 0;
    for (const [id, series] of seriesById) {
      if (series.firstTSec > t) continue;
      pool += 1;
      if (id === player.id) continue;
      const rating = currentRatingById
        ? currentRatingById.get(id) ?? ratingAtOrBefore(series.pts, t)
        : ratingAtOrBefore(series.pts, t);
      if (rating !== null && rating > selfRating) ahead += 1;
    }
    return { rank: ahead + 1, pool };
  };

  const samplePoints = (player.ratingTimelinePoints ?? [])
    .filter(
      (point) =>
        Boolean(point.eventId) &&
        Number.isFinite(point.tSec) &&
        Number.isFinite(point.rating),
    )
    .slice()
    .sort((a, b) => a.tSec - b.tSec);

  let maxRank = 1;
  const points: RankGraphPoint[] = samplePoints.map((point) => {
    const t = Math.max(0, point.tSec);
    const selfRating = ratingAtOrBefore(self.pts, t) ?? point.rating;
    const { rank, pool } = rankAt(t, selfRating);
    maxRank = Math.max(maxRank, pool);
    return { tSec: t, rating: rank, period: point.period, clockSec: point.clockSec };
  });

  // Append a "current standings" point using authoritative live ratings so the
  // line ends exactly at the player's present rank.
  const currentT = Math.max(
    player.ratingTimelineDurationSec ?? 0,
    samplePoints[samplePoints.length - 1]?.tSec ?? 0,
  );
  const currentRatingById = new Map<string, number | null>();
  for (const candidate of allPlayers) {
    currentRatingById.set(
      candidate.id,
      typeof candidate.inGameRating10 === "number" &&
        Number.isFinite(candidate.inGameRating10)
        ? candidate.inGameRating10
        : null,
    );
  }
  const selfCurrentRating =
    (typeof player.inGameRating10 === "number" && Number.isFinite(player.inGameRating10)
      ? player.inGameRating10
      : ratingAtOrBefore(self.pts, currentT)) ?? 0;
  const { rank: currentRank, pool: currentPool } = rankAt(
    currentT,
    selfCurrentRating,
    currentRatingById,
  );
  maxRank = Math.max(maxRank, currentPool);
  if (points.length === 0 || points[points.length - 1].tSec < currentT) {
    points.push({ tSec: currentT, rating: currentRank });
  } else {
    points[points.length - 1] = {
      ...points[points.length - 1],
      rating: currentRank,
    };
  }

  return { points, maxRank };
}

// MOMENTUM chart: a zero-centred, signed -5..+5 area chart. Deliberately styled
// like the point-differential chart (green fill above the midline, red below)
// so it reads as a completely different shape from the Rating line at a glance.
// Shares the Rating chart's quarter x-mapping and axis-label treatment so the
// two charts feel like one system.
const MOMENTUM_RANGE = 5;

type PeriodSlotPoint = { tSec: number; period?: number };

// Identical x-axis scale to Point Differential's team-stats.tsx `layout`:
// equal-width slot per period that has actually occurred (derived purely
// from the series' own period values), each point placed by its fraction of
// elapsed time WITHIN its own period. Shared by the Momentum chart's own
// rendering (below) and PlayerImpactChartCard's scrub-point mapping so both
// agree on x position exactly.
function buildPeriodSlotLayout<T extends PeriodSlotPoint>(points: T[]) {
  const ordered = [...points].sort(
    (a, b) => (a.period ?? 1) - (b.period ?? 1) || a.tSec - b.tSec,
  );
  const totalSlots = Math.max(
    1,
    ordered.reduce((max, point) => Math.max(max, point.period ?? 1), 1),
  );
  const bounds = new Map<number, { min: number; max: number }>();
  ordered.forEach((point) => {
    const period = point.period ?? 1;
    const current = bounds.get(period);
    if (!current) {
      bounds.set(period, { min: point.tSec, max: point.tSec });
    } else {
      current.min = Math.min(current.min, point.tSec);
      current.max = Math.max(current.max, point.tSec);
    }
  });
  const fractionFor = (point: PeriodSlotPoint) => {
    const period = point.period ?? 1;
    const slot = Math.min(Math.max(period - 1, 0), totalSlots - 1);
    const bound = bounds.get(period);
    const frac =
      bound && bound.max > bound.min
        ? (point.tSec - bound.min) / (bound.max - bound.min)
        : 0;
    return (slot + frac) / totalSlots;
  };
  return { totalSlots, fractionFor };
}

// --- Shared chart scrub-to-inspect --------------------------------------
// One scrub interaction (press-and-hold, drag, floating value pill) reused
// identically by all three charts (Rating/Rank/Momentum) instead of three
// separate implementations. Each chart just needs to describe its points as
// this generic shape.
type ChartScrubPoint = {
  x: number;
  valueLabel: string;
  contextLabel: string | null;
};

function formatScrubContext(period?: number, clockSec?: number): string | null {
  if (typeof period !== "number") {
    return null;
  }
  const clock = typeof clockSec === "number" ? formatImpactClock(clockSec) : "--:--";
  return `Q${period} · ${clock}`;
}

function findNearestScrubIndex(chartPoints: ChartScrubPoint[], x: number): number | null {
  if (chartPoints.length === 0) {
    return null;
  }
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  chartPoints.forEach((point, index) => {
    const distance = Math.abs(point.x - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

// Vertical scrub line + floating glass-pill value label, positioned by
// whichever chart is currently visible. Purely presentational — the owning
// chart card supplies the active point (already resolved to this chart's
// own pixel space) and clamps the pill so it never runs off either edge.
function ChartScrubOverlay({
  point,
  minX,
  maxX,
  styles,
}: {
  point: ChartScrubPoint | null;
  minX: number;
  maxX: number;
  styles: ReturnType<typeof createStyles>;
}) {
  if (!point) {
    return null;
  }
  const pillHalfWidth = 42;
  const pillLeft = Math.max(
    minX,
    Math.min(maxX - pillHalfWidth * 2, point.x - pillHalfWidth),
  );

  return (
    <>
      <View
        pointerEvents="none"
        style={[styles.chartScrubIndicator, { left: point.x }]}
      />
      <View pointerEvents="none" style={[styles.scrubPillWrap, { left: pillLeft }]}>
        {Platform.OS === "ios" ? (
          <View pointerEvents="none" style={styles.scrubPillGlassMask}>
            <GlassView
              glassEffectStyle="regular"
              colorScheme="dark"
              isInteractive={false}
              style={styles.scrubPillGlass}
            />
          </View>
        ) : (
          <View pointerEvents="none" style={styles.scrubPillFallbackGlass} />
        )}
        <Text style={styles.scrubPillValue} numberOfLines={1}>
          {point.valueLabel}
        </Text>
        {point.contextLabel ? (
          <Text style={styles.scrubPillContext} numberOfLines={1}>
            {point.contextLabel}
          </Text>
        ) : null}
      </View>
    </>
  );
}

function PlayerMomentumChart({
  points,
  width,
  height,
  axisMarginLeft,
  axisMarginBottom,
  theme,
}: {
  points: MomentumTimelinePoint[];
  width: number;
  height: number;
  axisMarginLeft: number;
  axisMarginBottom: number;
  theme: ThemeTokens;
}) {
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const posGradientId = `momentum-pos-${instanceId}`;
  const negGradientId = `momentum-neg-${instanceId}`;
  const innerHeight = Math.max(1, height - axisMarginBottom);
  const zeroY = innerHeight / 2;
  const padV = 8;
  const xOrigin = axisMarginLeft;
  const plotWidth = Math.max(1, width - axisMarginLeft);

  const safe = points
    .filter((point) => Number.isFinite(point.tSec) && Number.isFinite(point.momentum))
    .map((point) => ({
      tSec: Math.max(0, point.tSec),
      momentum: Math.max(-MOMENTUM_RANGE, Math.min(MOMENTUM_RANGE, point.momentum)),
      period: point.period,
      clockSec: point.clockSec,
    }))
    .sort((a, b) => a.tSec - b.tSec);
  // Identical x-axis scale to the Point Differential chart
  // (app/(tabs)/team-stats.tsx `layout`): equal-width slot per period that
  // has actually occurred, derived purely from this series' own period
  // values — NOT from an externally-passed game duration. The old version
  // anchored the final quarter's slot to `durationSec` (borrowed from the
  // separate Rating timeline), so a momentum series that hadn't caught up to
  // the live game clock rendered squeezed into the front of its last slot,
  // leaving unexplained empty space after Q4.
  const layout = useMemo(() => buildPeriodSlotLayout(safe), [safe]);
  const totalQuarters = layout.totalSlots;
  const xFor = (point: { tSec: number; period?: number; clockSec?: number }) =>
    xOrigin + layout.fractionFor(point) * plotWidth;
  const yFor = (momentum: number) => zeroY - (momentum / MOMENTUM_RANGE) * (zeroY - padV);

  const plotted = safe.map((point) => ({ ...point, x: xFor(point), y: yFor(point.momentum) }));
  const hasData = plotted.length >= 2;
  const linePath = buildMonotoneLinePath(plotted.map((point) => ({ x: point.x, y: point.y })));
  const areaPath = (mode: "pos" | "neg"): string => {
    const clampMomentum = (momentum: number) =>
      mode === "pos" ? Math.max(momentum, 0) : Math.min(momentum, 0);
    const clamped = plotted.map((point) => ({ x: point.x, y: yFor(clampMomentum(point.momentum)) }));
    const curve = buildMonotoneLinePath(clamped);
    if (!curve) {
      return "";
    }
    const firstX = plotted[0]?.x ?? xOrigin;
    const lastX = plotted[plotted.length - 1]?.x ?? width;
    return `${curve} L ${lastX} ${zeroY} L ${firstX} ${zeroY} Z`;
  };

  // Boundaries (gridlines, at slot EDGES) and quarterCenters (labels, at slot
  // MIDPOINTS) are deliberately two separate arrays — matching Point
  // Differential's team-stats.tsx `boundaries`/`periodLabels` split. The
  // previous version used one centers-only array for both, so the "quarter
  // gridlines" actually ran through each label's midpoint rather than
  // marking the boundary between quarters.
  const boundaries = Array.from({ length: totalQuarters - 1 }, (_, index) =>
    xOrigin + ((index + 1) / totalQuarters) * plotWidth,
  );
  const quarterCenters = Array.from({ length: totalQuarters }, (_, index) => ({
    label: `Q${index + 1}`,
    x: xOrigin + ((index + 0.5) / totalQuarters) * plotWidth,
  }));
  const yTicks = [MOMENTUM_RANGE, 0, -MOMENTUM_RANGE];
  const lastPoint = plotted[plotted.length - 1];
  const lastColor =
    (lastPoint?.momentum ?? 0) >= 0 ? theme.colors.success : theme.colors.danger;

  return (
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
          <Stop offset="0" stopColor={theme.colors.success} stopOpacity={0.7} />
          <Stop offset="1" stopColor={theme.colors.success} stopOpacity={0.28} />
        </LinearGradient>
        <LinearGradient
          id={negGradientId}
          x1="0"
          y1={innerHeight}
          x2="0"
          y2={zeroY}
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor={theme.colors.danger} stopOpacity={0.7} />
          <Stop offset="1" stopColor={theme.colors.danger} stopOpacity={0.28} />
        </LinearGradient>
      </Defs>

      {/* Chart background, matching the Rating chart's plot rect. */}
      <Path
        d={`M ${xOrigin} 0 H ${width} V ${innerHeight} H ${xOrigin} Z`}
        fill={theme.colors.surfaceAlt}
      />

      {/* Quarter-boundary gridlines — identical styling to Point
          Differential's (app/(tabs)/team-stats.tsx): borderSoft stroke,
          width 1, dash "3 5", full opacity (no strokeOpacity override). */}
      {boundaries.map((boundaryX, index) => (
        <SvgLine
          key={`boundary-${index}`}
          x1={boundaryX}
          y1={0}
          x2={boundaryX}
          y2={innerHeight}
          stroke={theme.colors.borderSoft}
          strokeWidth={1}
          strokeDasharray="3 5"
        />
      ))}

      {hasData ? (
        <>
          <Path d={areaPath("pos")} fill={`url(#${posGradientId})`} />
          <Path d={areaPath("neg")} fill={`url(#${negGradientId})`} />
        </>
      ) : null}

      {/* Zero midline — full canvas width edge-to-edge (x=0, not xOrigin),
          matching Point Differential's baseline exactly (borderSoft, width
          1, solid). It passes behind the "0" y-axis label, same as Point
          Differential's gridlines commonly run behind axis labels. */}
      <SvgLine
        x1={0}
        y1={zeroY}
        x2={width}
        y2={zeroY}
        stroke={theme.colors.borderSoft}
        strokeWidth={1}
      />

      {hasData ? (
        <Path d={linePath} stroke={theme.colors.textPrimary} strokeWidth={2} fill="none" />
      ) : null}

      {/* Current-value dot. */}
      {lastPoint ? (
        <>
          <Path
            d={`M ${lastPoint.x - 0.01} ${lastPoint.y} h 0.02`}
            stroke={lastColor}
            strokeWidth={9}
            strokeLinecap="round"
            strokeOpacity={0.25}
          />
          <Path
            d={`M ${lastPoint.x - 0.01} ${lastPoint.y} h 0.02`}
            stroke={lastColor}
            strokeWidth={5}
            strokeLinecap="round"
          />
        </>
      ) : null}

      {/* Y-axis labels (+5 / 0 / -5) in the reserved left margin. */}
      {yTicks.map((tick) => (
        <SvgText
          key={`ytick-${tick}`}
          x={xOrigin - 6}
          y={yFor(tick) + 3}
          fill={theme.colors.textMuted}
          fontSize={9}
          fontWeight="600"
          textAnchor="end"
        >
          {tick > 0 ? `+${tick}` : `${tick}`}
        </SvgText>
      ))}

      {/* Q labels along the x-axis. */}
      {quarterCenters.map((quarter) => (
        <SvgText
          key={quarter.label}
          x={quarter.x}
          y={height - 3}
          fill={theme.colors.textMuted}
          fontSize={10}
          fontWeight="700"
          textAnchor="middle"
        >
          {quarter.label}
        </SvgText>
      ))}
    </Svg>
  );
}

function PlayerImpactChartCard({
  initialChartMode,
  onScrubActiveChange,
  onScrubPointChange,
  onToggleSeasonComparison,
  player,
  seasonComparisonActive,
  styles,
  theme,
}: {
  initialChartMode?: ChartViewMode;
  onScrubActiveChange: (active: boolean) => void;
  onScrubPointChange: (point: RatingTimelinePoint | null) => void;
  onToggleSeasonComparison: () => void;
  player: LiveGamePlayer;
  seasonComparisonActive: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ThemeTokens;
}) {
  const chartHeight = 136;
  const yAxisWidth = 24;
  // Reserved bottom strip for the Q1-Q4 labels, carved out of chartHeight so
  // they render below the chart's own background/plot instead of overlaying
  // it (see axisMarginLeft/axisMarginBottom on PlayerRatingGraph).
  const axisMarginBottom = 18;
  const innerChartHeight = chartHeight - axisMarginBottom;
  const seasonRating = player.seasonRating10;
  const hasSeasonRating =
    typeof seasonRating === "number" && Number.isFinite(seasonRating);
  // Average finished rank over the season — the rank-view analog of the average
  // rating, driven by the same season-average toggle button.
  const seasonRank = player.seasonRank;
  const hasSeasonRank = typeof seasonRank === "number" && Number.isFinite(seasonRank);
  const showReference = seasonComparisonActive && hasSeasonRating;
  const [chartWidth, setChartWidth] = useState(0);
  const [viewMode, setViewMode] = useState<ChartViewMode>(initialChartMode ?? "rating");
  // Rank is the one page whose data (buildRankTimeline below) is expensive to
  // compute — it scans every OTHER player's full rating history per sample.
  // Computing it eagerly for all three pager slides on every modal open (this
  // pager keeps all three mounted at once, see the swipe track below) was
  // blocking the JS thread right as the sheet opens, which is what made the
  // open feel laggy even though the tap handler itself never awaits anything.
  // Deferring it until the user actually visits Rank — via swipe or the
  // segmented control, both of which call markModeVisited — keeps the modal's
  // first paint cheap; the 220ms swipe/segment-switch animation gives it
  // plenty of time to compute before the page is actually on screen.
  const [visitedModes, setVisitedModes] = useState<Set<ChartViewMode>>(
    () => new Set([initialChartMode ?? "rating"]),
  );
  const markModeVisited = useCallback((mode: ChartViewMode) => {
    setVisitedModes((current) => (current.has(mode) ? current : new Set(current).add(mode)));
  }, []);
  const isRank = viewMode === "rank";
  const pageIndex = CHART_VIEW_MODES.indexOf(viewMode);
  const momentumTimelinePoints = player.momentumTimelinePoints ?? [];
  const { data } = useLiveGame();
  const allPlayers = useMemo(
    () => (data ? Object.values(data.playersByTeam).flat() : []),
    [data],
  );
  const rankVisited = visitedModes.has("rank");
  const rankTimeline = useMemo(
    () => (rankVisited ? buildRankTimeline(player, allPlayers) : { points: [], maxRank: 2 }),
    [rankVisited, player, allPlayers],
  );
  // Rank axis spans 1..(current rankable players); grows as more players become
  // rankable. Kept at >= 2 so the axis is never degenerate.
  const rankMax = Math.max(2, rankTimeline.maxRank);
  const timelinePoints = useMemo(() => {
    const sorted = (player.ratingTimelinePoints ?? [{ tSec: 0, rating: 5 }])
      .filter((point) => Number.isFinite(point.tSec) && Number.isFinite(point.rating))
      .sort((a, b) => a.tSec - b.tSec);
    if (sorted.length <= 1) {
      return sorted;
    }

    // Strip leading synthetic baseline (tSec:0, no eventId) so the line starts
    // at the player's first real play, not a pre-game padding stub.
    const firstRealIndex = sorted.findIndex((point) => Boolean(point.eventId));
    let trimmed = firstRealIndex > 0
      ? sorted.slice(firstRealIndex)
      : (!sorted[0].eventId && sorted[0].tSec === 0 ? sorted.slice(1) : sorted);

    // Multiple renders can accumulate stale synthetic "current" endpoints (no
    // eventId) at different tSec values, creating spurious slope segments. Keep
    // only the very last one as the live endpoint; discard all earlier synthetics.
    const lastRealIndex = (() => {
      for (let i = trimmed.length - 1; i >= 0; i--) {
        if (Boolean(trimmed[i].eventId)) return i;
      }
      return -1;
    })();
    if (lastRealIndex >= 0 && lastRealIndex < trimmed.length - 1) {
      // There are trailing synthetic points — keep only the final one.
      trimmed = [...trimmed.slice(0, lastRealIndex + 1), trimmed[trimmed.length - 1]];
    }

    // Ensure the final point's rating matches the live rating displayed in the
    // modal header so the glowing dot never reads a different value than the pill.
    const currentRating = player.inGameRating10;
    if (
      typeof currentRating === "number" &&
      Number.isFinite(currentRating) &&
      trimmed.length > 0
    ) {
      const last = trimmed[trimmed.length - 1];
      if (!last.eventId && Math.abs(last.rating - currentRating) > 0.05) {
        trimmed = [
          ...trimmed.slice(0, trimmed.length - 1),
          { ...last, rating: currentRating },
        ];
      }
    }

    return trimmed;
  }, [player.ratingTimelinePoints, player.inGameRating10]);
  // Mirror the graph's auto-zoom domain so the floating "avg" label lines up
  // with the dashed reference line drawn inside the chart.
  const yDomain = useMemo(
    () =>
      computeRatingDomain(
        timelinePoints.map((point) => point.rating),
        { reference: showReference ? (seasonRating as number) : null },
      ),
    [timelinePoints, showReference, seasonRating],
  );
  const graphWidth = Math.max(0, chartWidth - theme.spacing[8]);
  // The chart's plotted area starts yAxisWidth px in (labels now live in
  // that reserved margin instead of overlaying the plot), so scrub
  // hit-testing needs to subtract it out too.
  const chartPlotWidth = Math.max(1, graphWidth - yAxisWidth);
  const timelineDuration = Math.max(
    1,
    player.ratingTimelineDurationSec ??
      timelinePoints[timelinePoints.length - 1]?.tSec ??
      1,
  );

  // Rating and Rank now each get their own independent season-average
  // reference (both slides exist at once in the pager, unlike before when
  // only one chart was ever mounted at a time).
  const ratingReferenceActive = seasonComparisonActive && hasSeasonRating;
  const ratingReferenceTop = hasSeasonRating
    ? ratingToYFraction(seasonRating as number, yDomain) * innerChartHeight
    : 0;
  const rankReferenceActive = seasonComparisonActive && hasSeasonRank;
  const rankReferenceBase = hasSeasonRank
    ? ratingToYFraction(seasonRank as number, { min: 1, max: rankMax })
    : 0;
  // Rank axis is inverted (rank 1 at top), so flip the fraction to match.
  const rankReferenceTop = (1 - rankReferenceBase) * innerChartHeight;

  const handleChartLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = Math.max(0, Math.floor(event.nativeEvent.layout.width));
    setChartWidth((current) => (current === nextWidth ? current : nextWidth));
  }, []);

  // --- Per-page scrub point arrays (shared ChartScrubPoint shape) ---------
  // Pre-build the same quarter x-map each chart renders with, so scrub
  // hit-testing finds the nearest point by its ACTUAL chart-x position. With
  // equalQuarterSpacing each quarter is equal width regardless of elapsed
  // time, so converting x→tSec linearly would give the WRONG nearest point
  // when touching early/late quarters.
  const ratingQuarterXMap = useMemo(
    () => buildQuarterXMap(timelinePoints, timelineDuration),
    [timelinePoints, timelineDuration],
  );
  const ratingScrubPoints = useMemo<ChartScrubPoint[]>(() => {
    const tq = ratingQuarterXMap.totalQuarters;
    return timelinePoints.map((point) => ({
      x: yAxisWidth + (ratingQuarterXMap.coordFor(point) / tq) * chartPlotWidth,
      valueLabel: formatRating(point.rating),
      contextLabel: formatScrubContext(point.period, point.clockSec),
    }));
  }, [timelinePoints, ratingQuarterXMap, chartPlotWidth, yAxisWidth]);

  const rankQuarterXMap = useMemo(
    () => buildQuarterXMap(rankTimeline.points, timelineDuration),
    [rankTimeline.points, timelineDuration],
  );
  const rankScrubPoints = useMemo<ChartScrubPoint[]>(() => {
    const tq = rankQuarterXMap.totalQuarters;
    return rankTimeline.points.map((point) => ({
      x: yAxisWidth + (rankQuarterXMap.coordFor(point) / tq) * chartPlotWidth,
      valueLabel: `#${Math.round(point.rating)}`,
      contextLabel: formatScrubContext(point.period, point.clockSec),
    }));
  }, [rankTimeline.points, rankQuarterXMap, chartPlotWidth, yAxisWidth]);

  // Mirrors PlayerMomentumChart's own point prep exactly, so x positions match.
  const momentumSafePoints = useMemo(
    () =>
      momentumTimelinePoints
        .filter((point) => Number.isFinite(point.tSec) && Number.isFinite(point.momentum))
        .map((point) => ({
          tSec: Math.max(0, point.tSec),
          momentum: Math.max(-MOMENTUM_RANGE, Math.min(MOMENTUM_RANGE, point.momentum)),
          period: point.period,
          clockSec: point.clockSec,
        }))
        .sort((a, b) => a.tSec - b.tSec),
    [momentumTimelinePoints],
  );
  const momentumLayout = useMemo(
    () => buildPeriodSlotLayout(momentumSafePoints),
    [momentumSafePoints],
  );
  const momentumScrubPoints = useMemo<ChartScrubPoint[]>(
    () =>
      momentumSafePoints.map((point) => ({
        x: yAxisWidth + momentumLayout.fractionFor(point) * chartPlotWidth,
        valueLabel: `${point.momentum >= 0 ? "+" : ""}${point.momentum.toFixed(1)}`,
        contextLabel: formatScrubContext(point.period, point.clockSec),
      })),
    [momentumSafePoints, momentumLayout, chartPlotWidth, yAxisWidth],
  );

  const activeScrubPoints =
    viewMode === "momentum"
      ? momentumScrubPoints
      : viewMode === "rank"
        ? rankScrubPoints
        : ratingScrubPoints;

  // --- Scrub-to-inspect (shared across all three pages) -------------------
  const [activeScrubIndex, setActiveScrubIndex] = useState<number | null>(null);
  const activeScrubPoint =
    activeScrubIndex !== null ? activeScrubPoints[activeScrubIndex] ?? null : null;

  const scrubToX = useCallback(
    (x: number) => {
      if (graphWidth <= 0 || activeScrubPoints.length === 0) {
        return;
      }
      // Clamp to the plotted area only (yAxisWidth..graphWidth) — the strip
      // to its left is the reserved y-axis label margin, not part of the
      // plot, so the indicator/pill shouldn't be able to sit there.
      const clampedX = Math.max(yAxisWidth, Math.min(graphWidth, x));
      const index = findNearestScrubIndex(activeScrubPoints, clampedX);
      setActiveScrubIndex(index);
      // The external box-score-sync callback only understands rating
      // timeline points — only drive it while actually viewing Rating.
      if (viewMode === "rating") {
        onScrubPointChange(index !== null ? timelinePoints[index] ?? null : null);
      }
    },
    [activeScrubPoints, graphWidth, onScrubPointChange, timelinePoints, viewMode, yAxisWidth],
  );
  const clearScrub = useCallback(() => {
    setActiveScrubIndex(null);
    if (viewMode === "rating") {
      onScrubPointChange(null);
    }
  }, [onScrubPointChange, viewMode]);

  // Tracks whether any touch is currently down on the chart's gesture
  // surface (scrub OR swipe), so the outer player-to-player TabView pager
  // (see PlayerModalScene below, swipeEnabled={... && !chartScrubActive})
  // can be suppressed for the whole gesture, not just while scrubbing —
  // otherwise a chart swipe gets contested by/loses to that outer pager,
  // since it's a completely separate gesture system this component's
  // internal Gesture.Race can't negotiate with directly. A balanced
  // increment/decrement counter (rather than each sub-gesture directly
  // toggling a boolean) avoids a real ordering hazard: in a Race, the
  // losing gesture's onFinalize can fire (and would set "false") WHILE the
  // winning gesture is still mid-interaction, which would incorrectly
  // re-enable the outer pager partway through. Only reacting to the count
  // reaching zero sidesteps that.
  const chartTouchCount = useSharedValue(0);
  useAnimatedReaction(
    () => chartTouchCount.value > 0,
    (isActive, wasActive) => {
      if (isActive !== wasActive) {
        runOnJS(onScrubActiveChange)(isActive);
      }
    },
    [onScrubActiveChange],
  );

  // --- Swipeable pager ------------------------------------------------------
  const pagerTranslateX = useSharedValue(0);
  const dragStartX = useSharedValue(0);
  const hasMeasuredPagerRef = useRef(false);
  useEffect(() => {
    if (graphWidth <= 0) {
      return;
    }
    const target = -pageIndex * graphWidth;
    if (!hasMeasuredPagerRef.current) {
      pagerTranslateX.value = target;
      hasMeasuredPagerRef.current = true;
    } else {
      pagerTranslateX.value = withTiming(target, { duration: 220 });
    }
  }, [pageIndex, graphWidth, pagerTranslateX]);
  const pagerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pagerTranslateX.value }],
  }));

  // Swipe (immediate on horizontal movement) and scrub (only after a brief
  // press-and-hold) race on the same surface: a quick swipe crosses the pan's
  // activeOffsetX threshold well before the long-press timer elapses, so it
  // always wins for real swipes; a stationary press lets the timer win.
  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-16, 16])
        .onTouchesDown(() => {
          chartTouchCount.value += 1;
        })
        .onTouchesUp(() => {
          chartTouchCount.value = Math.max(0, chartTouchCount.value - 1);
        })
        .onTouchesCancelled(() => {
          chartTouchCount.value = Math.max(0, chartTouchCount.value - 1);
        })
        .onBegin(() => {
          dragStartX.value = pagerTranslateX.value;
        })
        .onUpdate((event) => {
          pagerTranslateX.value = dragStartX.value + event.translationX;
        })
        .onEnd((event) => {
          if (graphWidth <= 0) {
            return;
          }
          const threshold = graphWidth * 0.22;
          let nextIndex = pageIndex;
          if (event.translationX < -threshold || event.velocityX < -650) {
            nextIndex = Math.min(CHART_VIEW_MODES.length - 1, pageIndex + 1);
          } else if (event.translationX > threshold || event.velocityX > 650) {
            nextIndex = Math.max(0, pageIndex - 1);
          }
          pagerTranslateX.value = withTiming(-nextIndex * graphWidth, { duration: 220 });
          if (nextIndex !== pageIndex) {
            const nextMode = CHART_VIEW_MODES[nextIndex];
            runOnJS(markModeVisited)(nextMode);
            runOnJS(setViewMode)(nextMode);
          }
        }),
    [chartTouchCount, dragStartX, graphWidth, markModeVisited, pageIndex, pagerTranslateX],
  );
  const scrubGesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(160)
        .shouldCancelWhenOutside(false)
        .onTouchesDown(() => {
          chartTouchCount.value += 1;
        })
        .onTouchesUp(() => {
          chartTouchCount.value = Math.max(0, chartTouchCount.value - 1);
        })
        .onTouchesCancelled(() => {
          chartTouchCount.value = Math.max(0, chartTouchCount.value - 1);
        })
        .onStart((event) => {
          runOnJS(scrubToX)(event.x);
        })
        .onUpdate((event) => {
          runOnJS(scrubToX)(event.x);
        })
        .onFinalize(() => {
          runOnJS(clearScrub)();
        }),
    [chartTouchCount, clearScrub, scrubToX],
  );
  const combinedChartGesture = useMemo(
    () => Gesture.Race(scrubGesture, swipeGesture),
    [scrubGesture, swipeGesture],
  );

  return (
    <View style={styles.sectionCard}>
      <View style={styles.chartFrame}>
        <View onLayout={handleChartLayout} style={styles.chartSurface}>
          {chartWidth > 0 ? (
            <GestureDetector gesture={combinedChartGesture}>
              <View style={[styles.interactiveChartWrap, { width: graphWidth }]}>
                <Animated.View
                  style={[
                    styles.pagerTrack,
                    { width: graphWidth * CHART_VIEW_MODES.length },
                    pagerAnimatedStyle,
                  ]}
                >
                  <View style={[styles.pagerSlide, { width: graphWidth }]}>
                    <PlayerRatingGraph
                      chartBackgroundColor={theme.colors.surfaceAlt}
                      colorMode="ratingBands"
                      gridColor={theme.colors.textMuted}
                      height={chartHeight}
                      labelColor={theme.colors.textMuted}
                      points={timelinePoints}
                      referenceRating={ratingReferenceActive ? (seasonRating as number) : null}
                      referenceLineColor={theme.colors.textSecondary}
                      showBaseline={false}
                      showFotmobStyle
                      showQuarterMarkers
                      dynamicYAxis
                      equalQuarterSpacing
                      smooth
                      width={graphWidth}
                      axisMarginLeft={yAxisWidth}
                      axisMarginBottom={axisMarginBottom}
                    />
                    {ratingReferenceActive ? (
                      <View
                        pointerEvents="none"
                        style={[styles.chartAvgLabel, { top: ratingReferenceTop - 18 }]}
                      >
                        <Text style={styles.chartAvgLabelText}>
                          {formatRating(seasonRating as number)} avg
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={[styles.pagerSlide, { width: graphWidth }]}>
                    <PlayerMomentumChart
                      points={momentumTimelinePoints}
                      width={graphWidth}
                      height={chartHeight}
                      axisMarginLeft={yAxisWidth}
                      axisMarginBottom={axisMarginBottom}
                      theme={theme}
                    />
                  </View>
                  <View style={[styles.pagerSlide, { width: graphWidth }]}>
                    <PlayerRatingGraph
                      chartBackgroundColor={theme.colors.surfaceAlt}
                      colorMode="ratingBands"
                      gridColor={theme.colors.textMuted}
                      height={chartHeight}
                      labelColor={theme.colors.textMuted}
                      points={rankTimeline.points}
                      referenceRating={rankReferenceActive ? (seasonRank as number) : null}
                      referenceLineColor={theme.colors.textSecondary}
                      showBaseline={false}
                      showFotmobStyle
                      showQuarterMarkers
                      equalQuarterSpacing
                      valueDomain={{ min: 1, max: rankMax }}
                      invertY
                      lineColorSolid={theme.colors.accent}
                      smooth
                      width={graphWidth}
                      axisMarginLeft={yAxisWidth}
                      axisMarginBottom={axisMarginBottom}
                    />
                    {rankReferenceActive ? (
                      <View
                        pointerEvents="none"
                        style={[styles.chartAvgLabel, { top: rankReferenceTop - 18 }]}
                      >
                        <Text style={styles.chartAvgLabelText}>
                          {`#${Math.round(seasonRank as number)} avg`}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Animated.View>
                <ChartScrubOverlay
                  point={activeScrubPoint}
                  minX={yAxisWidth}
                  maxX={graphWidth}
                  styles={styles}
                />
              </View>
            </GestureDetector>
          ) : null}
        </View>
      </View>
      <View style={styles.chartHeaderRow}>
        <View style={styles.viewModeSegment}>
          {CHART_VIEW_MODES.map((mode) => {
            const active = viewMode === mode;
            return (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityLabel={`Show ${mode} chart`}
                accessibilityState={{ selected: active }}
                onPress={() => {
                  markModeVisited(mode);
                  setViewMode(mode);
                }}
                style={[
                  styles.viewModeSegmentButton,
                  active ? styles.viewModeSegmentButtonActive : null,
                ]}
              >
                <Text
                  style={[
                    styles.viewModeSegmentText,
                    active ? styles.viewModeSegmentTextActive : null,
                  ]}
                >
                  {mode === "rating" ? "Rating" : mode === "rank" ? "Rank" : "Momentum"}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            isRank
              ? "Toggle season average rank"
              : "Toggle season average rating"
          }
          accessibilityState={{ selected: seasonComparisonActive }}
          hitSlop={8}
          onPress={onToggleSeasonComparison}
          style={[
            styles.chartToggle,
            seasonComparisonActive ? styles.chartToggleActive : null,
          ]}
        >
          <FontAwesome
            name="line-chart"
            size={13}
            color={
              seasonComparisonActive
                ? theme.colors.accent
                : theme.colors.textMuted
            }
          />
        </Pressable>
      </View>
    </View>
  );
}

type PlayHistoryEntry = {
  key: string;
  description: string;
  timeLabel: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  tags: string[];
  explanation: string;
};

// Remove the trailing "[TAG|TAG]" debug annotations from a play description.
function stripReasonTags(description: string): string {
  return description.replace(/\s*\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

// Pull the individual reason tags out of a description's "[A|B]" annotations.
function parsePlayTags(description: string): string[] {
  const matches = description.match(/\[([^\]]+)\]/g) ?? [];
  const raw = matches.flatMap((match) =>
    match.replace(/^\[|\]$/g, "").split(/[|,]/),
  );
  return Array.from(new Set(raw.map((tag) => tag.trim()).filter(Boolean)));
}

// Human-friendly label for a reason tag chip.
function prettifyTag(tag: string): string {
  switch (tag.toUpperCase()) {
    case "2PT": return "2PT";
    case "3PT": return "3PT";
    case "FT": return "Free throw";
    case "MADE_SHOT": return "Made shot";
    case "MISS_SHOT": return "Missed shot";
    case "MADE_FT": return "Made FT";
    case "MISS_FT": return "Missed FT";
    case "TURNOVER": return "Turnover";
    case "STEAL": return "Steal";
    case "BLOCK": return "Block";
    case "FOUL": return "Foul";
    case "OREB": return "Off. rebound";
    case "DREB": return "Def. rebound";
    case "REB": return "Rebound";
    case "AST": return "Assist";
    case "CLOSE": return "Close game";
    case "CLUTCH": return "Clutch";
    case "LEAD_CHANGE": return "Lead change";
    default:
      return tag
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Plain-language explanation of why the rating moved for a given play.
function buildPlayExplanation(params: {
  playerName: string;
  cleanedDescription: string;
  delta: number | null;
  tags: string[];
  timeLabel: string;
}): string {
  const { playerName, delta, tags, timeLabel } = params;
  const upper = tags.map((tag) => tag.toUpperCase());
  const magnitude =
    delta === null
      ? null
      : Math.abs(delta) >= 0.3
        ? "a large"
        : Math.abs(delta) >= 0.12
          ? "a moderate"
          : "a small";
  const direction =
    delta === null || delta === 0 ? "held" : delta > 0 ? "raised" : "lowered";

  const lead =
    delta === null
      ? `${playerName}'s rating was unchanged on this play.`
      : direction === "held"
        ? `${playerName}'s rating held steady on this play.`
        : `This play ${direction} ${playerName}'s rating by ${magnitude} amount (${
            delta > 0 ? "+" : ""
          }${delta.toFixed(2)}).`;

  const factors: string[] = [];
  if (upper.includes("3PT")) factors.push("a made 3-pointer carries more weight than a 2");
  else if (upper.includes("2PT") || upper.includes("MADE_SHOT")) factors.push("a made field goal adds positive impact");
  if (upper.includes("TURNOVER")) factors.push("a turnover gives the ball away, a negative event");
  if (upper.includes("STEAL")) factors.push("a steal is a high-value defensive play");
  if (upper.includes("BLOCK")) factors.push("a block is a high-value defensive play");
  if (upper.includes("MISS_SHOT") || upper.includes("MISS_FT")) factors.push("a miss is a small negative");
  if (upper.includes("FOUL")) factors.push("a foul is a small negative");

  const context: string[] = [];
  if (upper.includes("CLUTCH")) context.push("it happened in clutch time (late in a close game)");
  if (upper.includes("CLOSE")) context.push("the score was close");
  if (upper.includes("LEAD_CHANGE")) context.push("it changed which team was leading");

  const sentences = [lead];
  if (factors.length > 0) {
    sentences.push(`The event mattered because ${factors.join(", and ")}.`);
  }
  if (context.length > 0) {
    sentences.push(
      `The model amplified it because ${context.join(", and ")} — plays with more bearing on the outcome move the rating more.`,
    );
  } else {
    sentences.push(
      `The rating model weighs the event against game context at ${timeLabel} — score margin and time remaining — so higher-leverage plays move it more.`,
    );
  }
  return sentences.join(" ");
}

// Build this player's full play history (chronological, oldest first) from the
// rating timeline points that correspond to real plays (they carry an eventId).
function buildPlayHistory(player: LiveGamePlayer | null): PlayHistoryEntry[] {
  if (!player?.ratingTimelinePoints) {
    return [];
  }
  const playerName = player.name ?? "This player";
  return player.ratingTimelinePoints
    .filter((point) => Boolean(point.eventId) && Boolean(point.description))
    .slice()
    .sort((a, b) => {
      // Most recent play first — reverse-chronological, so the top of the
      // list always shows what just happened rather than requiring a scroll
      // back to the start of the game.
      if ((a.period ?? 0) !== (b.period ?? 0)) return (b.period ?? 0) - (a.period ?? 0);
      // Clock counts DOWN — lower clockSec means later in the period.
      return (a.clockSec ?? 0) - (b.clockSec ?? 0);
    })
    .map((point, index) => {
      const rawDescription = point.description ?? point.reason ?? "Play";
      const cleanedDescription = stripReasonTags(rawDescription) || "Play";
      const tags = parsePlayTags(rawDescription);
      const before =
        numberOrNull(point.displayRatingBefore) ?? numberOrNull(point.ratingBefore);
      const after =
        numberOrNull(point.displayRatingAfter) ??
        numberOrNull(point.ratingAfter) ??
        numberOrNull(point.rating);
      const delta =
        numberOrNull(point.displayDelta) ??
        numberOrNull(point.delta) ??
        (before !== null && after !== null
          ? Number((after - before).toFixed(2))
          : null);
      const period = typeof point.period === "number" ? point.period : null;
      const clock =
        typeof point.clockSec === "number" ? formatImpactClock(point.clockSec) : "--:--";
      const timeLabel = `${period ? `Q${period}` : "Q-"} ${clock}`;
      return {
        key: `${point.eventId ?? point.tSec}-${index}`,
        description: cleanedDescription,
        timeLabel,
        before,
        after,
        delta,
        tags,
        explanation: buildPlayExplanation({
          playerName,
          cleanedDescription,
          delta,
          tags,
          timeLabel,
        }),
      };
    });
}

// Colored before -> after + delta pill with a direction arrow, matching the
// app's rating color language (green up / red down).
function RatingChangeBadge({
  before,
  after,
  delta,
  styles,
  theme,
}: {
  before: number | null;
  after: number | null;
  delta: number | null;
  styles: ReturnType<typeof createStyles>;
  theme: ThemeTokens;
}) {
  const direction = delta === null || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const color =
    direction === "up"
      ? colors.upColor
      : direction === "down"
        ? colors.downColor
        : theme.colors.textMuted;
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "—";
  const deltaText =
    delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`;
  return (
    <View style={styles.ratingChangeRow}>
      <Text style={styles.ratingChangeBeforeAfter}>
        {formatRating(before, 2)} → {formatRating(after, 2)}
      </Text>
      <View
        style={[
          styles.ratingDeltaPill,
          { backgroundColor: hexToRgba(color, 0.16, theme.colors.surfaceAlt), borderColor: color },
        ]}
      >
        <Text style={[styles.ratingDeltaArrow, { color }]}>{arrow}</Text>
        <Text style={[styles.ratingDeltaText, { color }]}>{deltaText}</Text>
      </View>
    </View>
  );
}

function PlayHistoryRow({
  entry,
  expanded,
  onToggle,
  styles,
  teamAccent,
  theme,
}: {
  entry: PlayHistoryEntry;
  expanded: boolean;
  onToggle: () => void;
  styles: ReturnType<typeof createStyles>;
  teamAccent: TeamAccentPalette;
  theme: ThemeTokens;
}) {
  return (
    <View style={styles.playHistoryRow}>
      <View style={styles.playHistoryTopRow}>
        <View style={styles.playHistoryTextCol}>
          <Text style={styles.playHistoryDescription} numberOfLines={2}>
            {entry.description}
          </Text>
          <Text style={styles.playHistoryTime}>{entry.timeLabel}</Text>
        </View>
        <RatingChangeBadge
          before={entry.before}
          after={entry.after}
          delta={entry.delta}
          styles={styles}
          theme={theme}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Why did the rating change?"
          hitSlop={10}
          onPress={onToggle}
          style={styles.playHistoryInfoButton}
        >
          <FontAwesome
            name="info-circle"
            size={16}
            color={expanded ? theme.colors.accent : theme.colors.textMuted}
          />
        </Pressable>
      </View>
      {entry.tags.length > 0 ? (
        <View style={styles.playHistoryTagRow}>
          {entry.tags.map((tag) => (
            <View
              key={tag}
              style={[
                styles.impactBadge,
                { backgroundColor: teamAccent.chipFill, borderColor: teamAccent.chipBorder },
              ]}
            >
              <Text style={styles.impactBadgeText}>{prettifyTag(tag)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {expanded ? (
        <View style={styles.playHistoryExplanation}>
          <Text style={styles.playHistoryExplanationText}>{entry.explanation}</Text>
        </View>
      ) : null}
    </View>
  );
}

function PlayerPlayHistoryCard({
  player,
  styles,
  teamAccent,
  theme,
}: {
  player: LiveGamePlayer;
  styles: ReturnType<typeof createStyles>;
  teamAccent: TeamAccentPalette;
  theme: ThemeTokens;
}) {
  const history = useMemo(() => buildPlayHistory(player), [player]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>Play History</Text>
        {history.length > 0 ? (
          <Text style={styles.playHistoryCount}>{history.length} plays</Text>
        ) : null}
      </View>
      {history.length === 0 ? (
        <Text style={styles.impactMeta}>No rating-changing plays yet.</Text>
      ) : (
        <View style={styles.playHistoryList}>
          {history.map((entry) => (
            <PlayHistoryRow
              key={entry.key}
              entry={entry}
              expanded={expandedKey === entry.key}
              onToggle={() =>
                setExpandedKey((current) => (current === entry.key ? null : entry.key))
              }
              styles={styles}
              teamAccent={teamAccent}
              theme={theme}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const BOX_SCORE_GRID: string[] = [
  "PTS", "REB", "AST", "STL",
  "BLK", "TO", "FLS", "+/-",
  "FG", "3PT", "FT", "MIN",
];
const BOX_SCORE_DELTA_KEYS = new Set(["PTS", "REB", "AST", "STL"]);

function boxScoreValue(player: LiveGamePlayer, key: string): string {
  switch (key) {
    case "PTS": return `${player.points ?? 0}`;
    case "REB": return `${player.rebounds ?? 0}`;
    case "AST": return `${player.assists ?? 0}`;
    case "STL": return `${player.steals ?? 0}`;
    case "BLK": return `${player.blocks ?? 0}`;
    case "TO": return `${player.turnovers ?? 0}`;
    case "FLS": return `${player.fouls ?? 0}`;
    case "+/-": return player.plusMinus ?? "-";
    case "FG": return player.fg ?? "-";
    case "3PT": return player.threePt ?? "-";
    case "FT": return player.ft ?? "-";
    case "MIN": return player.minutesDisplay ?? "-";
    default: return "-";
  }
}

function boxScoreDelta(player: LiveGamePlayer, key: string): string | null {
  if (!BOX_SCORE_DELTA_KEYS.has(key)) {
    return null;
  }
  const avg = SEASON_AVG_PLACEHOLDER[key];
  if (typeof avg !== "number") {
    return null;
  }
  const current =
    key === "PTS"
      ? player.points
      : key === "REB"
        ? player.rebounds
        : key === "AST"
          ? player.assists
          : player.steals;
  const value = typeof current === "number" ? current : 0;
  const delta = value - avg;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`;
}

function PlayerBoxScoreGrid({
  player,
  statRows,
  seasonComparisonActive,
  styles,
}: {
  player: LiveGamePlayer;
  statRows: StatRow[];
  seasonComparisonActive: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  if (player.sport === "baseball") {
    return (
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Player breakdown</Text>
        <View style={styles.statList}>
          {statRows.map((row) => (
            <PlayerStatRow
              key={row.label}
              label={row.label}
              styles={styles}
              value={row.value}
            />
          ))}
        </View>
      </View>
    );
  }

  const standoutKey = getStandoutStatKey(player);

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>Box score</Text>
      <View style={styles.gridWrap}>
        {BOX_SCORE_GRID.map((key) => {
          const delta = seasonComparisonActive ? boxScoreDelta(player, key) : null;
          const isStandout = key === standoutKey;
          return (
            <View key={key} style={styles.gridCell}>
              <Text
                style={[styles.gridValue, isStandout ? styles.gridValueStandout : null]}
                numberOfLines={1}
              >
                {boxScoreValue(player, key)}
              </Text>
              <Text style={styles.gridLabel}>{key}</Text>
              {delta !== null ? (
                <Text style={styles.gridDelta} numberOfLines={1}>
                  {delta}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

// The single stat that visually leads the box score — whichever of
// PTS/REB/AST is highest for this player's game. Ties break in that same
// PTS > REB > AST priority order (points is usually the most legible signal
// of a standout performance for ties like 10/10/2 vs 10/10/10).
function getStandoutStatKey(player: LiveGamePlayer): string | null {
  const candidates: Array<{ key: string; value: number }> = [
    { key: "PTS", value: player.points ?? 0 },
    { key: "REB", value: player.rebounds ?? 0 },
    { key: "AST", value: player.assists ?? 0 },
  ];
  return candidates.reduce((best, candidate) =>
    candidate.value > best.value ? candidate : best,
  ).key;
}

function PlayerStatRow({
  label,
  styles,
  value,
}: {
  label: string;
  styles: ReturnType<typeof createStyles>;
  value: string;
}) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.statValue}>
        {value}
      </Text>
    </View>
  );
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    modalRoot: {
      flex: 1,
      justifyContent: "flex-end",
    },
    rosterHeader: {
      position: "absolute",
      height: ROSTER_HEADER_HEIGHT,
      borderRadius: theme.radius.lg,
      backgroundColor: "transparent",
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      overflow: "hidden",
      justifyContent: "center",
      zIndex: 3,
    },
    rosterGlass: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.lg,
    },
    rosterGlassFallback: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.lg,
      backgroundColor: "rgba(255,255,255,0.06)",
    },
    rosterSliderContent: {
      alignItems: "center",
      paddingHorizontal: theme.spacing[10],
    },
    rosterSliderItem: {
      width: ROSTER_ITEM_WIDTH,
      height: ROSTER_HEADER_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
      overflow: "visible",
    },
    stripItem: {
      alignItems: "center",
      justifyContent: "center",
    },
    stripAvatarRing: {
      width: STRIP_AVATAR_SIZE + 8,
      height: STRIP_AVATAR_SIZE + 8,
      borderRadius: (STRIP_AVATAR_SIZE + 8) / 2,
      borderWidth: 2.5,
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      overflow: "visible",
    },
    stripAvatar: {
      width: STRIP_AVATAR_SIZE,
      height: STRIP_AVATAR_SIZE,
      borderRadius: STRIP_AVATAR_SIZE / 2,
      backgroundColor: theme.colors.surfaceAlt,
    },
    stripAvatarFallback: {
      width: STRIP_AVATAR_SIZE,
      height: STRIP_AVATAR_SIZE,
      borderRadius: STRIP_AVATAR_SIZE / 2,
      backgroundColor: theme.colors.surface,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    stripInitials: {
      color: theme.colors.textSecondary,
      fontSize: 15,
      fontWeight: "800",
      letterSpacing: 0.5,
    },
    stripRatingPill: {
      position: "absolute",
      top: -4,
      right: -6,
      minWidth: 26,
      height: 16,
      borderRadius: 8,
      paddingHorizontal: 4,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
      borderColor: theme.colors.bg,
    },
    stripRatingText: {
      color: "#0b1220",
      fontSize: 9,
      fontWeight: "800",
    },
    stripJerseyBadge: {
      position: "absolute",
      bottom: -6,
      minWidth: 22,
      height: 14,
      borderRadius: 7,
      paddingHorizontal: 4,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.borderSoft,
    },
    stripJerseyText: {
      color: theme.colors.textPrimary,
      fontSize: 8,
      lineHeight: 10,
      fontWeight: "800",
    },
    playerPager: {
      flex: 1,
      backgroundColor: "transparent",
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.84)",
    },
    // Lighter chrome: a hairline, softer-toned border and a much subtler
    // shadow than before, so the sheet blends into the background instead
    // of announcing itself with a heavy outline/drop shadow.
    sheet: {
      backgroundColor: theme.colors.card,
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      borderWidth: theme.borderWidth.hairline,
      borderColor: theme.colors.borderSoft,
      borderBottomWidth: 0,
      overflow: "hidden",
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.16,
      shadowRadius: 10,
      elevation: 8,
    },
    grabber: {
      alignSelf: "center",
      width: 42,
      height: 5,
      borderRadius: theme.radius.pill,
      backgroundColor: "rgba(255,255,255,0.12)",
      marginTop: theme.spacing[8],
      marginBottom: theme.spacing[6],
    },
    content: {
      // Matches the in-game screens' outer horizontal margin
      // (GameTabScreenScaffold's content.paddingHorizontal, used by the
      // Court/Stats/Plays tabs) instead of the modal's previous, wider
      // theme.spacing[16] inset.
      paddingHorizontal: theme.spacing[8],
      // Tighter than before (was spacing[12]) so photo -> name -> subtitle
      // -> chart -> stats reads as one compact flow, not stacked cards with
      // dead air between them.
      gap: theme.spacing[8],
    },
    profileButton: {
      position: "absolute",
      right: theme.spacing[16],
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spacing[20],
      paddingVertical: theme.spacing[10],
      borderRadius: theme.radius.pill,
      // Frosted glass pill (iOS GlassView / translucent fallback) instead of a
      // solid accent fill, matching the app's glass surfaces (e.g. rosterGlass).
      backgroundColor: "transparent",
      borderWidth: theme.borderWidth.normal,
      borderColor: "rgba(255,255,255,0.18)",
      overflow: "hidden",
      zIndex: 6,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 8,
    },
    profileButtonGlass: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.pill,
    },
    profileButtonGlassFallback: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.pill,
      backgroundColor: "rgba(255,255,255,0.10)",
    },
    profileButtonText: {
      ...theme.type.subtitle,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    identityBlock: {
      alignItems: "center",
      paddingTop: 0,
      gap: theme.spacing[2],
    },
    identityHeadshotWrap: {
      position: "relative",
    },
    identityHeadshot: {
      width: 104,
      height: 104,
      borderRadius: 52,
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
    },
    identityRatingBadge: {
      position: "absolute",
      right: -4,
      bottom: -4,
      minWidth: 40,
      height: 30,
      borderRadius: 15,
      paddingHorizontal: theme.spacing[8],
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 3,
      borderColor: theme.colors.bg,
    },
    identityRatingValue: {
      fontSize: 15,
      lineHeight: 18,
      fontWeight: "800",
    },
    identityNameWrap: {
      alignItems: "center",
      maxWidth: "100%",
    },
    // Name + jersey number share a row, matching the Bench section's
    // unitNameRow (CourtLineupDock.tsx) exactly.
    identityNameRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      maxWidth: "100%",
    },
    identityName: {
      ...theme.type.title,
      color: theme.colors.textPrimary,
      textAlign: "center",
      fontSize: 26,
      lineHeight: 30,
      flexShrink: 1,
    },
    // Small grey jersey number next to the name — matches Bench's
    // unitJerseyNum styling (CourtLineupDock.tsx).
    identityJerseyNum: {
      color: theme.colors.textMuted,
      fontSize: 16,
      lineHeight: 19,
      fontWeight: "600",
      flexShrink: 0,
    },
    // Position (+ Rank, if present) on its own line under the name — the
    // team logo was already dropped entirely since the team is shown in the
    // game header.
    identitySubtitle: {
      color: theme.colors.textMuted,
      fontSize: 13,
      lineHeight: 16,
      fontWeight: "600",
      letterSpacing: 0.2,
    },
    sectionCard: {
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[6],
      gap: theme.spacing[8],
    },
    sectionTitleRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: theme.spacing[10],
    },
    sectionTitle: {
      ...theme.type.subtitle,
      color: theme.colors.textPrimary,
    },
    chartFrame: {
      // Smaller, more subtle rounding than theme.radius.lg — soft but not
      // bubbly.
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      paddingVertical: theme.spacing[16],
      // No left inset so Q1 / the plot begins flush at the chart's left edge; the
      // right inset keeps the current-value glow dot from clipping.
      paddingLeft: 0,
      paddingRight: theme.spacing[8],
      overflow: "hidden",
    },
    chartSurface: {
      minHeight: 136,
      justifyContent: "center",
    },
    interactiveChartWrap: {
      position: "relative",
      minHeight: 136,
      justifyContent: "center",
      // Clips the 3x-wide sliding pager track down to a single visible page.
      overflow: "hidden",
    },
    // Row of all three chart pages, translated horizontally by the pager.
    pagerTrack: {
      flexDirection: "row",
    },
    pagerSlide: {
      minHeight: 136,
      justifyContent: "center",
    },
    chartScrubIndicator: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: 2,
      borderRadius: theme.radius.pill,
      opacity: 0.82,
      backgroundColor: theme.colors.accent,
    },
    // Floating value pill shown above the scrub line — same glass treatment
    // as GlassPillButton (components/GlassPillButton.tsx): GlassView on iOS,
    // translucent fallback elsewhere.
    scrubPillWrap: {
      position: "absolute",
      top: -6,
      minWidth: 84,
      alignItems: "center",
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[4],
      overflow: "hidden",
      borderWidth: theme.borderWidth.hairline,
      borderColor: "rgba(255,255,255,0.18)",
    },
    scrubPillGlassMask: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.md,
      overflow: "hidden",
    },
    scrubPillGlass: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.md,
      overflow: "hidden",
    },
    scrubPillFallbackGlass: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: theme.radius.md,
      backgroundColor: "rgba(20,20,24,0.82)",
    },
    scrubPillValue: {
      color: theme.colors.textPrimary,
      fontSize: 13,
      lineHeight: 16,
      fontWeight: "800",
    },
    scrubPillContext: {
      color: theme.colors.textMuted,
      fontSize: 10,
      lineHeight: 13,
      fontWeight: "600",
      marginTop: 1,
    },
    chartHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    // Lighter/smaller than before — a filled pill this close under the chart
    // was competing with it. Kept as a segmented control, just quieter: less
    // padding, a smaller/lighter label, and a subtle tinted (not solid)
    // active state.
    viewModeSegment: {
      flex: 1,
      flexDirection: "row",
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.hairline,
      borderColor: theme.colors.borderSoft,
      backgroundColor: "transparent",
      overflow: "hidden",
      padding: 2,
      gap: 2,
    },
    viewModeSegmentButton: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: theme.spacing[6],
      borderRadius: theme.radius.pill,
    },
    viewModeSegmentButtonActive: {
      backgroundColor: "rgba(59,130,246,0.14)",
    },
    viewModeSegmentText: {
      ...theme.type.subtitle,
      fontSize: 12,
      lineHeight: 15,
      color: theme.colors.textMuted,
      fontWeight: "700",
      letterSpacing: 0.2,
    },
    viewModeSegmentTextActive: {
      color: theme.colors.accent,
    },
    chartToggle: {
      width: 26,
      height: 26,
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.hairline,
      borderColor: theme.colors.borderSoft,
      backgroundColor: "transparent",
      alignItems: "center",
      justifyContent: "center",
    },
    chartToggleActive: {
      borderColor: theme.colors.accent,
      backgroundColor: "rgba(59,130,246,0.16)",
    },
    chartAvgLabel: {
      position: "absolute",
      right: 4,
      paddingHorizontal: theme.spacing[6],
      paddingVertical: 1,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.borderSoft,
    },
    chartAvgLabelText: {
      ...theme.type.micro,
      color: theme.colors.textSecondary,
    },
    gridWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginTop: theme.spacing[4],
    },
    gridCell: {
      width: "25%",
      alignItems: "center",
      paddingVertical: theme.spacing[10],
      gap: theme.spacing[2],
    },
    // Default (subdued) tier — most stats read at this smaller, quieter
    // size. The one standout stat (highest of PTS/REB/AST) overrides with
    // gridValueStandout below for actual visual hierarchy instead of every
    // cell looking identical.
    gridValue: {
      ...theme.type.subtitle,
      color: theme.colors.textSecondary,
      fontSize: 15,
      lineHeight: 18,
      fontWeight: "700",
    },
    gridValueStandout: {
      color: theme.colors.textPrimary,
      fontSize: 24,
      lineHeight: 28,
      fontWeight: "900",
    },
    gridLabel: {
      ...theme.type.micro,
      color: theme.colors.textMuted,
      letterSpacing: 0.4,
    },
    gridDelta: {
      ...theme.type.micro,
      color: theme.colors.textMuted,
      fontSize: 10,
      lineHeight: 12,
      fontWeight: "700",
    },
    impactBadgeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "flex-end",
      gap: theme.spacing[6],
    },
    impactBadge: {
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[4],
    },
    impactBadgeText: {
      ...theme.type.micro,
      color: theme.colors.textPrimary,
      letterSpacing: 0.4,
    },
    impactDescription: {
      ...theme.type.subtitle,
      color: theme.colors.textPrimary,
      lineHeight: 28,
    },
    impactMeta: {
      ...theme.type.caption,
      color: theme.colors.textSecondary,
      lineHeight: 18,
    },
    playHistoryCount: {
      ...theme.type.micro,
      color: theme.colors.textMuted,
    },
    playHistoryList: {
      gap: theme.spacing[10],
    },
    playHistoryRow: {
      paddingVertical: theme.spacing[6],
      gap: theme.spacing[8],
    },
    playHistoryTopRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    playHistoryTextCol: {
      flex: 1,
      gap: 2,
    },
    playHistoryDescription: {
      ...theme.type.body,
      color: theme.colors.textPrimary,
      lineHeight: 20,
    },
    playHistoryTime: {
      ...theme.type.micro,
      color: theme.colors.textMuted,
      letterSpacing: 0.3,
    },
    ratingChangeRow: {
      alignItems: "flex-end",
      gap: 3,
    },
    ratingChangeBeforeAfter: {
      ...theme.type.micro,
      color: theme.colors.textSecondary,
    },
    ratingDeltaPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      paddingHorizontal: theme.spacing[6],
      paddingVertical: 2,
    },
    ratingDeltaArrow: {
      fontSize: 9,
      lineHeight: 12,
    },
    ratingDeltaText: {
      ...theme.type.micro,
      fontWeight: "700",
    },
    playHistoryInfoButton: {
      padding: theme.spacing[2],
    },
    playHistoryTagRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing[6],
    },
    playHistoryExplanation: {
      backgroundColor: theme.colors.surfaceAlt,
      borderRadius: theme.radius.md,
      padding: theme.spacing[10],
    },
    playHistoryExplanationText: {
      ...theme.type.caption,
      color: theme.colors.textSecondary,
      lineHeight: 19,
    },
    statList: {
      borderTopWidth: theme.borderWidth.normal,
      borderTopColor: theme.colors.borderSoft,
    },
    statRow: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[16],
      paddingVertical: theme.spacing[10],
      borderBottomWidth: theme.borderWidth.normal,
      borderBottomColor: theme.colors.borderSoft,
    },
    statLabel: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      letterSpacing: 0.5,
    },
    statValue: {
      ...theme.type.subtitle,
      color: theme.colors.textPrimary,
      fontSize: 18,
      lineHeight: 22,
      fontWeight: "700",
      flexShrink: 1,
      textAlign: "right",
    },
    previewLayer: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 12,
    },
    previewBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.82)",
    },
    previewContent: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spacing[20],
    },
    previewImage: {
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
    },
  });
}
