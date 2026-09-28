import { router, useLocalSearchParams, usePathname } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { GlassView } from "expo-glass-effect";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from "react-native";
import {
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import GameHeaderActions from "@/components/game/GameHeaderActions";
import HeaderMenuButton from "@/components/home/HeaderMenuButton";
import {
  IN_GAME_HEADER_COLLAPSE_DISTANCE,
  getStickyHeaderExpandedHeight,
  IN_GAME_HEADER_COLLAPSE_RANGE,
} from "@/components/ui/inGameHeaderMetrics";
import type { LiveGameData } from "@/hooks/useLiveGame";
import { useLiveGame } from "@/hooks/useLiveGame";
import { useMultiView, MAX_MULTI_VIEW_GAMES } from "@/src/multiview/MultiViewContext";
import { useProfile } from "@/src/profile/ProfileContext";
import {
  useSettingsActions,
  useSettingsState,
} from "@/src/settings/SettingsContext";
import type { ThemeTokens } from "@/src/theme/tokens";
import { useAppTheme } from "@/src/theme/useAppTheme";
import {
  Animated,
  STICKY_HEADER_EXPANDED_BOTTOM_PADDING,
  STICKY_HEADER_NAV_ROW_HEIGHT,
  STICKY_HEADER_NAV_ROW_MARGIN_BOTTOM,
  STICKY_HEADER_TOP_PADDING,
  useStickyHeaderMotion,
} from "@/src/ui/stickyHeaderMotion";
import { useInGameTabNavigation } from "@/src/ui/inGameTabNavigationContext";
import {
  getActiveInGameTab,
  PREVIEW_TAB_ITEM,
  getVisibleInGameTabItems,
} from "@/src/ui/inGameTabs";
import { useInGameSectionRegistry } from "@/src/ui/inGameSectionRegistryContext";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const EXPANDED_SECTION_HEIGHT = 84;
const TAB_ROW_MARGIN_TOP = 8;
const TAB_ROW_HEIGHT = 44;
const HEADER_COMPACT_FADE_RANGE: [number, number] = [4, 74];
const HEADER_EXPANDED_TRANSLATE_Y = 28;
const COLLAPSED_TOP_SCORE_GAP = 13;
const EXPANDED_SCORE_FONT_SIZE = 30;
const EXPANDED_SCORE_LINE_HEIGHT = 32;
const COLLAPSED_SCORE_FONT_SIZE = 19;
const COLLAPSED_SCORE_LINE_HEIGHT = 21;
const DEFAULT_SCORE_SCALE = COLLAPSED_SCORE_FONT_SIZE / EXPANDED_SCORE_FONT_SIZE;
const SCORE_SIDE_SLOT_EXPANDED_WIDTH = 68;
const SCORE_SIDE_SLOT_COLLAPSED_WIDTH = 42;
const SCORE_DASH_SLOT_EXPANDED_WIDTH = 18;
const SCORE_DASH_SLOT_COLLAPSED_WIDTH = 12;
const SCORE_SLOT_FALLBACK_WIDTH =
  SCORE_SIDE_SLOT_EXPANDED_WIDTH * 2 + SCORE_DASH_SLOT_EXPANDED_WIDTH;
const COLLAPSED_SCORE_SLOT_FALLBACK_WIDTH =
  SCORE_SIDE_SLOT_COLLAPSED_WIDTH * 2 + SCORE_DASH_SLOT_COLLAPSED_WIDTH;
const SCORE_SLOT_FALLBACK_HEIGHT = 32;
const EXPANDED_LOGO_SIZE = 34;
const COLLAPSED_LOGO_SIZE = 36;
const LOGO_META_WIDTH = 96;
const GAME_CLOCK_BLUE = "#60A5FA";

type LayoutFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function isFrameNearlyEqual(a: LayoutFrame | null, b: LayoutFrame): boolean {
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

type MotionConfig = {
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
  scaleRatio: number;
};

type ScoreMotionConfig = {
  startCenterX: number;
  startCenterY: number;
  deltaCenterX: number;
  deltaCenterY: number;
};

export const STICKY_HEADER_EXPANDED_HEIGHT =
  STICKY_HEADER_TOP_PADDING +
  STICKY_HEADER_NAV_ROW_HEIGHT +
  STICKY_HEADER_NAV_ROW_MARGIN_BOTTOM +
  EXPANDED_SECTION_HEIGHT +
  TAB_ROW_MARGIN_TOP +
  TAB_ROW_HEIGHT +
  STICKY_HEADER_EXPANDED_BOTTOM_PADDING;

export const STICKY_HEADER_COLLAPSED_HEIGHT =
  STICKY_HEADER_EXPANDED_HEIGHT - IN_GAME_HEADER_COLLAPSE_DISTANCE;

function statusLine(data: LiveGameData | null): string {
  if (data?.sport === "baseball" && data.status.baseball) {
    const parts = [
      data.status.baseball.label,
      typeof data.status.baseball.outs === "number"
        ? `${data.status.baseball.outs} out${data.status.baseball.outs === 1 ? "" : "s"}`
        : "",
      typeof data.status.baseball.balls === "number" &&
      typeof data.status.baseball.strikes === "number"
        ? `${data.status.baseball.balls}-${data.status.baseball.strikes}`
        : "",
    ].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(" | ");
    }
  }

  const state = (data?.status.state ?? "").toLowerCase();
  if (state === "post" || state === "final" || state === "complete") {
    const detail = (data?.status.shortDetail ?? "").toUpperCase();
    if (detail.includes("/OT") || detail.includes("OVERTIME")) {
      return "Final/OT";
    }
    return "Final";
  }
  if (state === "pre" || state === "scheduled" || state === "pregame") {
    return data?.status.shortDetail || "Scheduled";
  }
  return data?.status.shortDetail || data?.status.description || "Live";
}

function isPregameStatus(data: LiveGameData | null): boolean {
  const state = (data?.status.state ?? "").toLowerCase();
  return state === "pre" || state === "scheduled" || state === "pregame";
}

function formatStartTime(startDateTime?: string): string {
  if (!startDateTime) {
    return "TBD";
  }
  const date = new Date(startDateTime);
  if (Number.isNaN(date.getTime())) {
    return "TBD";
  }
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function padSeconds(value: number): string {
  return `${value}`.padStart(2, "0");
}

// Pre-game text shown below the tip-off time:
//  - same calendar day  -> live ticking countdown (h:mm:ss or m:ss)
//  - reached 0 (pre)     -> "About to start"
//  - tomorrow / further  -> relative day text ("Tomorrow", "13 days")
function formatPregameCountdown(startDateTime: string | undefined, now: number): string | null {
  if (!startDateTime) {
    return null;
  }
  const start = new Date(startDateTime).getTime();
  if (Number.isNaN(start)) {
    return null;
  }
  const msUntil = start - now;
  if (msUntil <= 0) {
    return "About to start";
  }

  const dayDiff = Math.round((startOfLocalDay(start) - startOfLocalDay(now)) / 86400000);
  if (dayDiff >= 2) {
    return `${dayDiff} days`;
  }
  if (dayDiff === 1) {
    return "Tomorrow";
  }

  const totalSeconds = Math.floor(msUntil / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${padSeconds(minutes)}:${padSeconds(seconds)}`;
  }
  return `${minutes}:${padSeconds(seconds)}`;
}

// Ticks once a second while the game is pre-game so the countdown stays live.
function PregameCountdown({
  startDateTime,
  baseStyle,
}: {
  startDateTime?: string;
  baseStyle: StyleProp<TextStyle>;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const text = formatPregameCountdown(startDateTime, now);
  if (!text) {
    return null;
  }

  return (
    <Animated.Text numberOfLines={1} style={baseStyle}>
      {text}
    </Animated.Text>
  );
}

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    wrap: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 0,
      elevation: 0,
      // Near-black rather than pure #000000 — matches the sampled/intended
      // header tone. Scoped to just this in-game header for now.
      backgroundColor: "#090909",
      borderBottomWidth: 0,
      paddingHorizontal: theme.spacing[8],
      paddingBottom: 0,
      overflow: "hidden",
    },
    navRow: {
      position: "relative",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: STICKY_HEADER_NAV_ROW_MARGIN_BOTTOM,
      height: STICKY_HEADER_NAV_ROW_HEIGHT,
      overflow: "hidden",
    },
    topScoreWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
    },
    topScoreMainRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: COLLAPSED_TOP_SCORE_GAP,
    },
    rightIcons: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
    },
    expanded: {
      minHeight: EXPANDED_SECTION_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    teamCol: {
      width: "29%",
      alignItems: "center",
      gap: 4,
    },
    midCol: {
      width: "42%",
      alignItems: "center",
    },
    expandedScoreAnchor: {
      alignSelf: "center",
    },
    expandedLogoAnchor: {
      width: EXPANDED_LOGO_SIZE,
      height: EXPANDED_LOGO_SIZE,
      alignSelf: "center",
    },
    logoLg: {
      width: EXPANDED_LOGO_SIZE,
      height: EXPANDED_LOGO_SIZE,
    },
    // Losing team (final games): dim the logo to match the dimmed name/score.
    logoDim: {
      opacity: 0.4,
    },
    teamName: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textPrimary,
      textAlign: "center",
    },
    // Losing team (final games): dim the name to match the dimmed score.
    teamNameDim: {
      color: theme.colors.textMuted,
    },
    teamRecord: {
      fontSize: 11,
      lineHeight: 12,
      fontWeight: "700",
      letterSpacing: 0.2,
      color: theme.colors.textMuted,
      textAlign: "center",
    },
    status: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
    scoreText: {
      fontSize: EXPANDED_SCORE_FONT_SIZE,
      lineHeight: EXPANDED_SCORE_LINE_HEIGHT,
      fontWeight: "600",
      letterSpacing: 0.5,
      color: theme.colors.textPrimary,
      fontVariant: ["tabular-nums"],
      textAlign: "center",
    },
    scoreRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    },
    scoreSideSlot: {
      textAlign: "center",
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
    },
    scoreDashSlot: {
      textAlign: "center",
      flexShrink: 0,
    },
    movingScoreContent: {
      alignItems: "center",
      zIndex: 0,
      elevation: 0,
    },
    movingScoreWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      top: 0,
      zIndex: 0,
      elevation: 0,
      alignItems: "center",
    },
    movingLogosWrap: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 0,
      elevation: 0,
    },
    movingLogoItem: {
      position: "absolute",
      left: 0,
      top: 0,
      width: EXPANDED_LOGO_SIZE,
      height: EXPANDED_LOGO_SIZE,
      alignItems: "center",
      justifyContent: "flex-start",
    },
    movingLogoMetaWrap: {
      position: "absolute",
      top: EXPANDED_LOGO_SIZE + 2,
      left: (EXPANDED_LOGO_SIZE - LOGO_META_WIDTH) / 2,
      width: LOGO_META_WIDTH,
      alignItems: "center",
    },
    tabRow: {
      marginTop: TAB_ROW_MARGIN_TOP,
      minHeight: TAB_ROW_HEIGHT,
      justifyContent: "center",
    },
    collapsedScoreAnchor: {
      alignSelf: "center",
    },
    collapsedLogoAnchor: {
      width: COLLAPSED_LOGO_SIZE,
      height: COLLAPSED_LOGO_SIZE,
      alignSelf: "center",
    },
    topScoreStatus: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: GAME_CLOCK_BLUE,
      textAlign: "center",
    },
    pregameTimeText: {
      color: theme.colors.textPrimary,
      fontWeight: "900",
      fontVariant: ["tabular-nums"],
      textAlign: "center",
    },
    winPillSlotAway: {
      position: "absolute",
      left: 6,
      top: 0,
      bottom: 0,
      justifyContent: "center",
    },
    winPillSlotHome: {
      position: "absolute",
      right: 6,
      top: 0,
      bottom: 0,
      justifyContent: "center",
    },
  });
}

type StickyScoreHeaderProps = {
  data: LiveGameData | null;
  scrollY: SharedValue<number>;
};

// One team's score. On value change it does a brief scale-pulse (~8%) plus a
// color flash that fades back over ~0.5s. Only the score that changed animates
// because each instance tracks its own previous value.
function AnimatedTeamScore({
  value,
  baseStyle,
  restColor,
  flashColor,
}: {
  value: string;
  baseStyle: StyleProp<TextStyle>;
  restColor: string;
  flashColor: string;
}) {
  const pulse = useSharedValue(0);
  const previousRef = useRef(value);

  useEffect(() => {
    if (previousRef.current !== value) {
      previousRef.current = value;
      pulse.value = withSequence(
        withTiming(1, { duration: 130 }),
        withTiming(0, { duration: 400 }),
      );
    }
  }, [pulse, value]);

  const flashStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.08 }],
    color: interpolateColor(pulse.value, [0, 1], [restColor, flashColor]),
  }));

  return (
    <Animated.Text numberOfLines={1} style={[baseStyle, flashStyle]}>
      {value}
    </Animated.Text>
  );
}

// Score status line (clock + period). Animates a brief fade+slide ONLY when the
// period number changes — never on the per-second clock tick.
function AnimatedPeriodStatus({
  text,
  period,
  baseStyle,
}: {
  text: string;
  period: number;
  baseStyle: StyleProp<TextStyle>;
}) {
  const anim = useSharedValue(0);
  const previousPeriodRef = useRef(period);

  useEffect(() => {
    if (previousPeriodRef.current !== period) {
      previousPeriodRef.current = period;
      anim.value = withSequence(
        withTiming(1, { duration: 180 }),
        withTiming(0, { duration: 260 }),
      );
    }
  }, [anim, period]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: 1 - anim.value * 0.7,
    transform: [{ translateY: anim.value * -4 }],
  }));

  return (
    <Animated.Text numberOfLines={1} style={[baseStyle, animStyle]}>
      {text}
    </Animated.Text>
  );
}

function normalizeTeamColor(value: string | undefined | null, fallback: string): string {
  if (!value) return fallback;
  const c = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9A-Fa-f]{6}$/.test(c) ? c : fallback;
}

// Animated win-probability glass pill. When the percentage changes, the new
// value slides in from the direction of change (odometer-style). Tapping it
// jumps to the Odds tab for this game.
function WinProbPill({
  pct,
  color,
  onPress,
}: {
  pct: number;
  color: string;
  onPress: () => void;
}) {
  const [displayed, setDisplayed] = useState(pct);
  const prevRef = useRef(pct);
  const ty = useSharedValue(0);
  const op = useSharedValue(1);

  useEffect(() => {
    const prev = prevRef.current;
    if (pct === prev) return;
    const dir = pct > prev ? 1 : -1;
    prevRef.current = pct;
    setDisplayed(pct);
    // Snap to offset + invisible, then slide and fade in
    ty.value = dir * 12;
    op.value = 0;
    ty.value = withTiming(0, { duration: 160 });
    op.value = withTiming(1, { duration: 160 });
  }, [pct]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
    opacity: op.value,
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Win probability ${Math.round(pct)}%. View odds`}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        winPillStyles.pill,
        { borderColor: `${color}40` },
        pressed ? winPillStyles.pillPressed : null,
      ]}
    >
      {Platform.OS === "ios" ? (
        <View pointerEvents="none" style={winPillStyles.glassMask}>
          <GlassView
            glassEffectStyle="regular"
            colorScheme="dark"
            isInteractive={false}
            style={winPillStyles.glass}
          />
        </View>
      ) : (
        <View pointerEvents="none" style={winPillStyles.fallbackGlass} />
      )}
      <Animated.Text style={[winPillStyles.text, animStyle]}>
        {Math.round(displayed)}%
      </Animated.Text>
    </Pressable>
  );
}

const winPillStyles = StyleSheet.create({
  pill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  pillPressed: {
    opacity: 0.75,
  },
  glassMask: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    overflow: "hidden",
  },
  glass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    overflow: "hidden",
  },
  fallbackGlass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
  },
  text: {
    color: "#FFFFFF",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
});

export default function StickyScoreHeader({
  data,
  scrollY,
}: StickyScoreHeaderProps) {
  const params = useLocalSearchParams<{ from?: string | string[] }>();
  const pathname = usePathname();
  const { mode, gameId, syncCalibrationPlays } = useLiveGame();
  const {
    addGameToMultiView,
    removeGameFromMultiView,
    isGameInMultiView,
    lastEntrySource,
    setLastEntrySource,
  } = useMultiView();
  const { isGameFavorited, toggleGameFavorite } = useProfile();
  const { state } = useSettingsState();
  const { setLiveDataDelaySeconds } = useSettingsActions();
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { activeTabKey, goToTab } = useInGameTabNavigation();
  const insets = useSafeAreaInsets();
  const headerRef = useRef<View>(null);
  const expandedScoreAnchorRef = useRef<View>(null);
  const collapsedScoreAnchorRef = useRef<View>(null);
  const expandedAwayLogoAnchorRef = useRef<View>(null);
  const expandedHomeLogoAnchorRef = useRef<View>(null);
  const collapsedAwayLogoAnchorRef = useRef<View>(null);
  const collapsedHomeLogoAnchorRef = useRef<View>(null);
  const measuredScoreSignatureRef = useRef("");
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [headerWindowFrame, setHeaderWindowFrame] = useState<LayoutFrame | null>(null);
  const [expandedScoreAnchor, setExpandedScoreAnchor] = useState<LayoutFrame | null>(null);
  const [collapsedScoreAnchor, setCollapsedScoreAnchor] = useState<LayoutFrame | null>(null);
  const [expandedAwayLogoAnchor, setExpandedAwayLogoAnchor] = useState<LayoutFrame | null>(null);
  const [expandedHomeLogoAnchor, setExpandedHomeLogoAnchor] = useState<LayoutFrame | null>(null);
  const [collapsedAwayLogoAnchor, setCollapsedAwayLogoAnchor] = useState<LayoutFrame | null>(null);
  const [collapsedHomeLogoAnchor, setCollapsedHomeLogoAnchor] = useState<LayoutFrame | null>(null);
  const [movingScoreSize, setMovingScoreSize] = useState({
    width: 0,
    height: 0,
  });
  const expandedHeight = getStickyHeaderExpandedHeight(insets.top);
  const collapsedHeight = expandedHeight - IN_GAME_HEADER_COLLAPSE_DISTANCE;
  const visibleTabs = useMemo(() => {
    const tabs = [...getVisibleInGameTabItems(state, mode)];
    if (!tabs.some((item) => item.key === PREVIEW_TAB_ITEM.key)) {
      tabs.unshift(PREVIEW_TAB_ITEM);
    }
    return tabs;
  }, [mode, state]);
  const away =
    data?.teams.find((team) => team.homeAway === "away") ?? data?.teams[0];
  const home =
    data?.teams.find((team) => team.homeAway === "home") ?? data?.teams[1];
  const isPregame = isPregameStatus(data);
  const latestWinProb = data?.winProbability?.length
    ? data.winProbability[data.winProbability.length - 1]
    : null;
  const homeWinPct = latestWinProb ? Math.round(latestWinProb.homeWinProb * 100) : null;
  const awayWinPct = homeWinPct !== null ? 100 - homeWinPct : null;
  const showWinProb = !isPregame && homeWinPct !== null && awayWinPct !== null;
  const awayPillColor = normalizeTeamColor(away?.color, theme.colors.accent);
  const homePillColor = normalizeTeamColor(home?.color, theme.colors.accentStrong);
  const startTimeText = formatStartTime(data?.meta.startDateTime);
  const awayScoreText = String(away?.score ?? "-");
  const homeScoreText = String(home?.score ?? "-");
  // On a finished game, dim the losing team's score AND name.
  const gameState = (data?.status.state ?? "").toLowerCase();
  const isFinalGame =
    gameState === "post" || gameState === "final" || gameState === "complete";
  const awayScoreNum = Number.parseInt(awayScoreText, 10);
  const homeScoreNum = Number.parseInt(homeScoreText, 10);
  const hasFinalScores =
    isFinalGame && Number.isFinite(awayScoreNum) && Number.isFinite(homeScoreNum);
  const awayIsLoser = hasFinalScores && awayScoreNum < homeScoreNum;
  const homeIsLoser = hasFinalScores && homeScoreNum < awayScoreNum;
  const awayScoreRestColor = awayIsLoser
    ? theme.colors.textMuted
    : theme.colors.textPrimary;
  const homeScoreRestColor = homeIsLoser
    ? theme.colors.textMuted
    : theme.colors.textPrimary;
  const compactScore = isPregame ? startTimeText : `${awayScoreText} - ${homeScoreText}`;
  const compactStatus =
    isPregame
      ? startTimeText
      : statusLine(data).trim() || data?.status?.description?.trim() || "-";
  const isFavorited = isGameFavorited(mode, gameId);
  const fromParam = Array.isArray(params.from) ? params.from[0] : params.from;
  const enteredFromMultiView = fromParam === "multiview";
  const inMultiView = isGameInMultiView(gameId, mode);
  const { availableSectionIdsByTab } = useInGameSectionRegistry();
  const currentTab =
    activeTabKey && visibleTabs.some((item) => item.key === activeTabKey)
      ? activeTabKey
      : getActiveInGameTab(pathname, visibleTabs);

  const openTeamProfile = (teamId?: string) => {
    if (!teamId) return;
    router.push({ pathname: "/team/[teamId]", params: { teamId, mode } } as never);
  };

  useEffect(() => {
    if (fromParam === "normal" && lastEntrySource !== "normal") {
      setLastEntrySource("normal");
      return;
    }
    if (fromParam === "multiview" && lastEntrySource !== "multiview") {
      setLastEntrySource("multiview");
    }
  }, [fromParam, lastEntrySource, setLastEntrySource]);

  const handleBackPress = useCallback(() => {
    if (enteredFromMultiView || lastEntrySource === "multiview") {
      setLastEntrySource("normal");
      router.replace("/multiview" as never);
      return;
    }
    router.back();
  }, [enteredFromMultiView, lastEntrySource, setLastEntrySource]);

  const addCurrentGameToMultiView = useCallback(() => {
    const result = addGameToMultiView({
      gameId,
      mode,
      snapshot: {
        sport: data?.sport ?? (mode === "baseball" ? "baseball" : "basketball"),
        awayName: away?.shortDisplayName || away?.displayName,
        homeName: home?.shortDisplayName || home?.displayName,
        awayLogo: away?.logo,
        homeLogo: home?.logo,
        awayScore: away?.score,
        homeScore: home?.score,
        statusText: compactStatus,
        venue: data?.meta.venue,
        startDateTime: data?.meta.startDateTime,
        baseballState: data?.status.baseball ?? null,
      },
    });

    if (result.status === "added") {
      Alert.alert("Added to MultiView", "This game is now in your MultiView.");
      return;
    }

    if (result.status === "already_exists") {
      Alert.alert("Already in MultiView", "This game has already been added.");
      return;
    }

    if (result.status === "max_reached") {
      Alert.alert(
        `MultiView supports up to ${MAX_MULTI_VIEW_GAMES} games.`,
        "Go to MultiView to manage your current games.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Go to MultiView",
            onPress: () => {
              setLastEntrySource("normal");
              router.push("/multiview" as never);
            },
          },
        ],
      );
    }
  }, [
    addGameToMultiView,
    away?.displayName,
    away?.logo,
    away?.score,
    away?.shortDisplayName,
    compactStatus,
    data?.meta.startDateTime,
    data?.meta.venue,
    data?.sport,
    data?.status.baseball,
    gameId,
    home?.displayName,
    home?.logo,
    home?.score,
    home?.shortDisplayName,
    mode,
    setLastEntrySource,
  ]);

  const removeCurrentGameFromMultiView = useCallback(() => {
    removeGameFromMultiView(gameId, mode);
  }, [gameId, mode, removeGameFromMultiView]);

  const goToMultiView = useCallback(() => {
    setLastEntrySource("normal");
    router.push("/multiview" as never);
  }, [setLastEntrySource]);
  const toggleFavoriteGame = useCallback(() => {
    toggleGameFavorite({
      mode,
      gameId,
      snapshot: {
        sport: data?.sport ?? (mode === "baseball" ? "baseball" : "basketball"),
        awayName: away?.shortDisplayName || away?.displayName,
        homeName: home?.shortDisplayName || home?.displayName,
        awayLogo: away?.logo,
        homeLogo: home?.logo,
        awayScore: away?.score,
        homeScore: home?.score,
        statusText: compactStatus,
        venue: data?.meta.venue,
        startDateTime: data?.meta.startDateTime,
      },
    });
  }, [
    away?.displayName,
    away?.logo,
    away?.score,
    away?.shortDisplayName,
    compactStatus,
    data?.meta.startDateTime,
    data?.meta.venue,
    data?.sport,
    gameId,
    home?.displayName,
    home?.logo,
    home?.score,
    home?.shortDisplayName,
    mode,
    toggleGameFavorite,
  ]);

  const openEditScreen = useCallback(() => {
    router.push({
      pathname: "/in-game-edit",
      params: {
        tab: currentTab,
        available: (availableSectionIdsByTab[currentTab] ?? []).join(","),
      },
    } as never);
  }, [availableSectionIdsByTab, currentTab]);

    const {
      expandedStyle,
      compactStyle: topScoreStyle,
    headerHeightStyle,
    barStyle,
    bottomPaddingStyle,
  } = useStickyHeaderMotion({
    scrollY,
    expandedHeight,
    collapsedHeight,
    collapseRange: IN_GAME_HEADER_COLLAPSE_RANGE,
    compactFadeRange: HEADER_COMPACT_FADE_RANGE,
    expandedTranslateY: HEADER_EXPANDED_TRANSLATE_Y,
    expandedBottomPadding: 0,
    collapsedBottomPadding: 0,
  });

  const nameRecordFadeStyle = useAnimatedStyle(() => {
    const rangeStart = IN_GAME_HEADER_COLLAPSE_RANGE[0];
    const rangeEnd =
      rangeStart +
      (IN_GAME_HEADER_COLLAPSE_RANGE[1] -
        IN_GAME_HEADER_COLLAPSE_RANGE[0]) *
        0.4;
    const opacity = interpolate(
      scrollY.value,
      [rangeStart, rangeEnd],
      [1, 0],
      Extrapolation.CLAMP,
    );
    return { opacity };
  });
  const collapsedScoreSlotWidth = useMemo(() => {
    if (movingScoreSize.width <= 0) {
      return COLLAPSED_SCORE_SLOT_FALLBACK_WIDTH;
    }
    return Math.max(
      COLLAPSED_SCORE_SLOT_FALLBACK_WIDTH,
      Math.round(movingScoreSize.width * DEFAULT_SCORE_SCALE),
    );
  }, [movingScoreSize.width]);

  const collapsedScoreSlotHeight = useMemo(() => {
    if (movingScoreSize.height <= 0) {
      return SCORE_SLOT_FALLBACK_HEIGHT;
    }
    return Math.max(
      Math.round(SCORE_SLOT_FALLBACK_HEIGHT * DEFAULT_SCORE_SCALE),
      Math.round(movingScoreSize.height * DEFAULT_SCORE_SCALE),
    );
  }, [movingScoreSize.height]);

  const measureWindowFrame = useCallback(
    (
      node: View | null,
      setFrame: Dispatch<SetStateAction<LayoutFrame | null>>,
    ) => {
      if (!node || typeof node.measureInWindow !== "function") {
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        if (width <= 0 || height <= 0) {
          return;
        }
        const next = { x, y, width, height };
        setFrame((prev) => (isFrameNearlyEqual(prev, next) ? prev : next));
      });
    },
    [],
  );

  const remeasureHeaderScoreFrames = useCallback(() => {
    measureWindowFrame(headerRef.current, setHeaderWindowFrame);
    measureWindowFrame(expandedScoreAnchorRef.current, setExpandedScoreAnchor);
    measureWindowFrame(collapsedScoreAnchorRef.current, setCollapsedScoreAnchor);
    measureWindowFrame(expandedAwayLogoAnchorRef.current, setExpandedAwayLogoAnchor);
    measureWindowFrame(expandedHomeLogoAnchorRef.current, setExpandedHomeLogoAnchor);
    measureWindowFrame(collapsedAwayLogoAnchorRef.current, setCollapsedAwayLogoAnchor);
    measureWindowFrame(collapsedHomeLogoAnchorRef.current, setCollapsedHomeLogoAnchor);
  }, [measureWindowFrame]);

  const onHeaderLayout = useCallback(() => {
    requestAnimationFrame(() => {
      remeasureHeaderScoreFrames();
    });
  }, [remeasureHeaderScoreFrames]);

  const onExpandedAnchorLayout = useCallback(() => {
    requestAnimationFrame(() => {
      measureWindowFrame(expandedScoreAnchorRef.current, setExpandedScoreAnchor);
    });
  }, [measureWindowFrame]);

  const onCollapsedAnchorLayout = useCallback(() => {
    requestAnimationFrame(() => {
      measureWindowFrame(collapsedScoreAnchorRef.current, setCollapsedScoreAnchor);
    });
  }, [measureWindowFrame]);

  const onExpandedAwayLogoAnchorLayout = useCallback(() => {
    requestAnimationFrame(() => {
      measureWindowFrame(expandedAwayLogoAnchorRef.current, setExpandedAwayLogoAnchor);
    });
  }, [measureWindowFrame]);

  const onExpandedHomeLogoAnchorLayout = useCallback(() => {
    requestAnimationFrame(() => {
      measureWindowFrame(expandedHomeLogoAnchorRef.current, setExpandedHomeLogoAnchor);
    });
  }, [measureWindowFrame]);

  const onCollapsedAwayLogoAnchorLayout = useCallback(() => {
    requestAnimationFrame(() => {
      measureWindowFrame(collapsedAwayLogoAnchorRef.current, setCollapsedAwayLogoAnchor);
    });
  }, [measureWindowFrame]);

  const onCollapsedHomeLogoAnchorLayout = useCallback(() => {
    requestAnimationFrame(() => {
      measureWindowFrame(collapsedHomeLogoAnchorRef.current, setCollapsedHomeLogoAnchor);
    });
  }, [measureWindowFrame]);

  const onMovingScoreLayout = useCallback((event: LayoutChangeEvent) => {
    const signature = `${compactScore}|${compactStatus}`;
    if (measuredScoreSignatureRef.current === signature) {
      return;
    }
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) {
      return;
    }
    measuredScoreSignatureRef.current = signature;
    setMovingScoreSize((prev) => {
      if (Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5) {
        return prev;
      }
      return { width, height };
    });
  }, [compactScore, compactStatus]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      remeasureHeaderScoreFrames();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    compactScore,
    compactStatus,
    collapsedScoreSlotHeight,
    collapsedScoreSlotWidth,
    insets.top,
    remeasureHeaderScoreFrames,
  ]);
  useEffect(() => {
    measuredScoreSignatureRef.current = "";
  }, [compactScore, compactStatus]);

  const buildLogoMotionConfig = useCallback(
    (
      expandedFrame: LayoutFrame | null,
      collapsedFrame: LayoutFrame | null,
      defaultCenterXRatio: number,
    ): MotionConfig => {
      const baseY =
        insets.top +
        STICKY_HEADER_TOP_PADDING +
        STICKY_HEADER_NAV_ROW_HEIGHT +
        STICKY_HEADER_NAV_ROW_MARGIN_BOTTOM +
        (EXPANDED_SECTION_HEIGHT - EXPANDED_LOGO_SIZE) * 0.5;
      const headerWidth = headerWindowFrame?.width ?? 0;
      const defaultCenterX = headerWidth * defaultCenterXRatio;
      const defaultStartX = Math.max(0, defaultCenterX - EXPANDED_LOGO_SIZE * 0.5);

      if (!headerWindowFrame || !expandedFrame || !collapsedFrame) {
        return {
          startX: defaultStartX,
          startY: baseY,
          deltaX: 0,
          deltaY: -STICKY_HEADER_NAV_ROW_HEIGHT,
          scaleRatio: COLLAPSED_LOGO_SIZE / EXPANDED_LOGO_SIZE,
        };
      }

      const expandedCenterX = expandedFrame.x + expandedFrame.width * 0.5;
      const expandedCenterY = expandedFrame.y + expandedFrame.height * 0.5;
      const collapsedCenterX = collapsedFrame.x + collapsedFrame.width * 0.5;
      const collapsedCenterY = collapsedFrame.y + collapsedFrame.height * 0.5;
      const widthRatio =
        expandedFrame.width > 0 ? collapsedFrame.width / expandedFrame.width : 0;
      const heightRatio =
        expandedFrame.height > 0 ? collapsedFrame.height / expandedFrame.height : 0;
      const rawScale =
        Number.isFinite(widthRatio) && widthRatio > 0
          ? widthRatio
          : Number.isFinite(heightRatio) && heightRatio > 0
            ? heightRatio
            : COLLAPSED_LOGO_SIZE / EXPANDED_LOGO_SIZE;

      return {
        startX: expandedCenterX - headerWindowFrame.x - EXPANDED_LOGO_SIZE * 0.5,
        startY: expandedCenterY - headerWindowFrame.y - EXPANDED_LOGO_SIZE * 0.5,
        deltaX: collapsedCenterX - expandedCenterX,
        deltaY: collapsedCenterY - expandedCenterY,
        scaleRatio: Math.max(0.4, Math.min(2, rawScale)),
      };
    },
    [headerWindowFrame, insets.top],
  );

  const scoreMotionConfig = useMemo<ScoreMotionConfig>(() => {
    const defaultStartCenterY =
      insets.top +
      STICKY_HEADER_TOP_PADDING +
      STICKY_HEADER_NAV_ROW_HEIGHT +
      STICKY_HEADER_NAV_ROW_MARGIN_BOTTOM +
      EXPANDED_SECTION_HEIGHT * 0.5;
    const defaultHeaderWidth = headerWindowFrame?.width ?? 0;
    const defaultStartCenterX = defaultHeaderWidth * 0.5;

    if (!headerWindowFrame || !expandedScoreAnchor || !collapsedScoreAnchor) {
      return {
        startCenterX: defaultStartCenterX,
        startCenterY: defaultStartCenterY,
        deltaCenterX: 0,
        deltaCenterY: -STICKY_HEADER_NAV_ROW_HEIGHT,
      };
    }

    const expandedCenterX = expandedScoreAnchor.x + expandedScoreAnchor.width * 0.5;
    const expandedCenterY = expandedScoreAnchor.y + expandedScoreAnchor.height * 0.5;
    const collapsedCenterX = collapsedScoreAnchor.x + collapsedScoreAnchor.width * 0.5;
    const collapsedCenterY = collapsedScoreAnchor.y + collapsedScoreAnchor.height * 0.5;
    return {
      startCenterX: expandedCenterX - headerWindowFrame.x,
      startCenterY: expandedCenterY - headerWindowFrame.y,
      deltaCenterX: collapsedCenterX - expandedCenterX,
      deltaCenterY: collapsedCenterY - expandedCenterY,
    };
  }, [
    collapsedScoreAnchor,
    expandedScoreAnchor,
    headerWindowFrame,
    insets.top,
  ]);

  const movingScoreMeasuredHeight =
    movingScoreSize.height > 0 ? movingScoreSize.height : SCORE_SLOT_FALLBACK_HEIGHT;
  const headerHalfWidth = (headerWindowFrame?.width ?? 0) * 0.5;

  const movingScoreStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      IN_GAME_HEADER_COLLAPSE_RANGE,
      [0, 1],
      Extrapolation.CLAMP,
    );
    const currentCenterX =
      scoreMotionConfig.startCenterX + scoreMotionConfig.deltaCenterX * progress;
    const currentCenterY =
      scoreMotionConfig.startCenterY + scoreMotionConfig.deltaCenterY * progress;
    return {
      transform: [
        {
          translateX: currentCenterX - headerHalfWidth,
        },
        {
          translateY: currentCenterY - movingScoreMeasuredHeight * 0.5,
        },
      ],
    };
  }, [
    headerHalfWidth,
    movingScoreMeasuredHeight,
    scoreMotionConfig.deltaCenterX,
    scoreMotionConfig.deltaCenterY,
    scoreMotionConfig.startCenterX,
    scoreMotionConfig.startCenterY,
  ]);
  const scoreTextAnimatedStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      IN_GAME_HEADER_COLLAPSE_RANGE,
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      fontSize: interpolate(
        progress,
        [0, 1],
        [EXPANDED_SCORE_FONT_SIZE, COLLAPSED_SCORE_FONT_SIZE],
        Extrapolation.CLAMP,
      ),
      lineHeight: interpolate(
        progress,
        [0, 1],
        [EXPANDED_SCORE_LINE_HEIGHT, COLLAPSED_SCORE_LINE_HEIGHT],
        Extrapolation.CLAMP,
      ),
    };
  });
  const statusTextAnimatedStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      IN_GAME_HEADER_COLLAPSE_RANGE,
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      fontSize: interpolate(progress, [0, 1], [12, 10], Extrapolation.CLAMP),
      lineHeight: interpolate(progress, [0, 1], [16, 12], Extrapolation.CLAMP),
    };
  });
  const scoreSideSlotAnimatedStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      IN_GAME_HEADER_COLLAPSE_RANGE,
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      width: interpolate(
        progress,
        [0, 1],
        [SCORE_SIDE_SLOT_EXPANDED_WIDTH, SCORE_SIDE_SLOT_COLLAPSED_WIDTH],
        Extrapolation.CLAMP,
      ),
    };
  });
  const scoreDashSlotAnimatedStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      IN_GAME_HEADER_COLLAPSE_RANGE,
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      width: interpolate(
        progress,
        [0, 1],
        [SCORE_DASH_SLOT_EXPANDED_WIDTH, SCORE_DASH_SLOT_COLLAPSED_WIDTH],
        Extrapolation.CLAMP,
      ),
    };
  });
  const awayLogoMotionConfig = useMemo(
    () => buildLogoMotionConfig(expandedAwayLogoAnchor, collapsedAwayLogoAnchor, 0.16),
    [buildLogoMotionConfig, collapsedAwayLogoAnchor, expandedAwayLogoAnchor],
  );
  const homeLogoMotionConfig = useMemo(
    () => buildLogoMotionConfig(expandedHomeLogoAnchor, collapsedHomeLogoAnchor, 0.84),
    [buildLogoMotionConfig, collapsedHomeLogoAnchor, expandedHomeLogoAnchor],
  );
  const movingAwayLogoStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      IN_GAME_HEADER_COLLAPSE_RANGE,
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      transform: [
        { translateX: awayLogoMotionConfig.startX + awayLogoMotionConfig.deltaX * progress },
        { translateY: awayLogoMotionConfig.startY + awayLogoMotionConfig.deltaY * progress },
        {
          scale: interpolate(
            progress,
            [0, 1],
            [1, awayLogoMotionConfig.scaleRatio],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  }, [
    awayLogoMotionConfig.deltaX,
    awayLogoMotionConfig.deltaY,
    awayLogoMotionConfig.scaleRatio,
    awayLogoMotionConfig.startX,
    awayLogoMotionConfig.startY,
  ]);
  const movingHomeLogoStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollY.value,
      IN_GAME_HEADER_COLLAPSE_RANGE,
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      transform: [
        { translateX: homeLogoMotionConfig.startX + homeLogoMotionConfig.deltaX * progress },
        { translateY: homeLogoMotionConfig.startY + homeLogoMotionConfig.deltaY * progress },
        {
          scale: interpolate(
            progress,
            [0, 1],
            [1, homeLogoMotionConfig.scaleRatio],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  }, [
    homeLogoMotionConfig.deltaX,
    homeLogoMotionConfig.deltaY,
    homeLogoMotionConfig.scaleRatio,
    homeLogoMotionConfig.startX,
    homeLogoMotionConfig.startY,
  ]);

  return (
    <Animated.View
      ref={headerRef}
      onLayout={onHeaderLayout}
      style={[
        styles.wrap,
        barStyle,
        headerHeightStyle,
        bottomPaddingStyle,
        { paddingTop: insets.top + STICKY_HEADER_TOP_PADDING },
      ]}
    >
      <View style={styles.navRow}>
        <HeaderMenuButton
          icon="chevron-left"
          iconFamily="Feather"
          iconSize={22}
          onPress={handleBackPress}
          accessibilityLabel="Go back"
          showBackground={false}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.topScoreWrap, topScoreStyle]}
        >
          <View style={styles.topScoreMainRow}>
            <View
              ref={collapsedAwayLogoAnchorRef}
              onLayout={onCollapsedAwayLogoAnchorLayout}
              style={styles.collapsedLogoAnchor}
            />
            <View
              ref={collapsedScoreAnchorRef}
              onLayout={onCollapsedAnchorLayout}
              style={[
                styles.collapsedScoreAnchor,
                { width: collapsedScoreSlotWidth, height: collapsedScoreSlotHeight },
              ]}
            />
            <View
              ref={collapsedHomeLogoAnchorRef}
              onLayout={onCollapsedHomeLogoAnchorLayout}
              style={styles.collapsedLogoAnchor}
            />
          </View>
        </Animated.View>
        <View style={styles.rightIcons}>
          <HeaderMenuButton
            icon="more-horizontal"
            iconFamily="Feather"
            iconSize={22}
            onPress={() => setIsActionsOpen(true)}
            accessibilityLabel="More actions"
            iconColor={inMultiView ? theme.colors.accent : "#FFFFFF"}
            showBackground={false}
          />
        </View>
      </View>

      <Animated.View pointerEvents="none" style={styles.movingLogosWrap}>
        <Animated.View style={[styles.movingLogoItem, movingAwayLogoStyle]}>
          <Image
            source={{ uri: away?.logo || FALLBACK_IMAGE_URI }}
            style={[styles.logoLg, awayIsLoser ? styles.logoDim : null]}
            resizeMode="contain"
          />
          <Animated.View style={[styles.movingLogoMetaWrap, nameRecordFadeStyle]}>
            <Text
              style={[styles.teamName, awayIsLoser ? styles.teamNameDim : null]}
              numberOfLines={1}
            >
              {away?.shortDisplayName || "Away"}
            </Text>
            {away?.record ? (
              <Text style={styles.teamRecord} numberOfLines={1}>
                {away.record}
              </Text>
            ) : null}
          </Animated.View>
        </Animated.View>
        <Animated.View style={[styles.movingLogoItem, movingHomeLogoStyle]}>
          <Image
            source={{ uri: home?.logo || FALLBACK_IMAGE_URI }}
            style={[styles.logoLg, homeIsLoser ? styles.logoDim : null]}
            resizeMode="contain"
          />
          <Animated.View style={[styles.movingLogoMetaWrap, nameRecordFadeStyle]}>
            <Text
              style={[styles.teamName, homeIsLoser ? styles.teamNameDim : null]}
              numberOfLines={1}
            >
              {home?.shortDisplayName || "Home"}
            </Text>
            {home?.record ? (
              <Text style={styles.teamRecord} numberOfLines={1}>
                {home.record}
              </Text>
            ) : null}
          </Animated.View>
        </Animated.View>
      </Animated.View>

      <Animated.View pointerEvents="none" style={[styles.movingScoreWrap, movingScoreStyle]}>
        <View style={styles.movingScoreContent}>
          <View onLayout={onMovingScoreLayout} style={styles.scoreRow}>
            {isPregame ? (
              <Animated.Text
                numberOfLines={1}
                style={[
                  styles.scoreText,
                  styles.pregameTimeText,
                  scoreTextAnimatedStyle,
                ]}
              >
                {startTimeText}
              </Animated.Text>
            ) : (
              <>
                <Animated.View
                  style={[
                    styles.scoreSideSlot,
                    scoreSideSlotAnimatedStyle,
                  ]}
                >
                  <AnimatedTeamScore
                    value={awayScoreText}
                    baseStyle={[styles.scoreText, scoreTextAnimatedStyle]}
                    restColor={awayScoreRestColor}
                    flashColor={theme.colors.accent}
                  />
                </Animated.View>
                <Animated.Text
                  numberOfLines={1}
                  style={[
                    styles.scoreText,
                    styles.scoreDashSlot,
                    scoreDashSlotAnimatedStyle,
                    scoreTextAnimatedStyle,
                  ]}
                >
                  -
                </Animated.Text>
                <Animated.View
                  style={[
                    styles.scoreSideSlot,
                    scoreSideSlotAnimatedStyle,
                  ]}
                >
                  <AnimatedTeamScore
                    value={homeScoreText}
                    baseStyle={[styles.scoreText, scoreTextAnimatedStyle]}
                    restColor={homeScoreRestColor}
                    flashColor={theme.colors.accent}
                  />
                </Animated.View>
              </>
            )}
          </View>
          {isPregame ? (
            <PregameCountdown
              startDateTime={data?.meta.startDateTime}
              baseStyle={[styles.topScoreStatus, statusTextAnimatedStyle]}
            />
          ) : (
            <AnimatedPeriodStatus
              text={compactStatus}
              period={data?.status?.period ?? 0}
              baseStyle={[styles.topScoreStatus, statusTextAnimatedStyle]}
            />
          )}
        </View>
      </Animated.View>

      <Animated.View style={[styles.expanded, expandedStyle]}>
        <Pressable
          style={styles.teamCol}
          onPress={() => openTeamProfile(away?.id)}
          disabled={!away?.id}
        >
          <View
            ref={expandedAwayLogoAnchorRef}
            onLayout={onExpandedAwayLogoAnchorLayout}
            style={styles.expandedLogoAnchor}
          />
        </Pressable>
        <View style={styles.midCol}>
          <View
            ref={expandedScoreAnchorRef}
            onLayout={onExpandedAnchorLayout}
            style={[
              styles.expandedScoreAnchor,
              {
                width: movingScoreSize.width > 0 ? Math.round(movingScoreSize.width) : SCORE_SLOT_FALLBACK_WIDTH,
                height: movingScoreSize.height > 0 ? Math.round(movingScoreSize.height) : SCORE_SLOT_FALLBACK_HEIGHT,
              },
            ]}
          />
        </View>
        <Pressable
          style={styles.teamCol}
          onPress={() => openTeamProfile(home?.id)}
          disabled={!home?.id}
        >
          <View
            ref={expandedHomeLogoAnchorRef}
            onLayout={onExpandedHomeLogoAnchorLayout}
            style={styles.expandedLogoAnchor}
          />
        </Pressable>
        {showWinProb ? (
          <Animated.View
            pointerEvents="box-none"
            style={[styles.winPillSlotAway, nameRecordFadeStyle]}
          >
            <WinProbPill
              pct={awayWinPct!}
              color={awayPillColor}
              onPress={() => goToTab("betting")}
            />
          </Animated.View>
        ) : null}
        {showWinProb ? (
          <Animated.View
            pointerEvents="box-none"
            style={[styles.winPillSlotHome, nameRecordFadeStyle]}
          >
            <WinProbPill
              pct={homeWinPct!}
              color={homePillColor}
              onPress={() => goToTab("betting")}
            />
          </Animated.View>
        ) : null}
      </Animated.View>

      <View style={styles.tabRow} />

      <GameHeaderActions
        visible={isActionsOpen}
        isInMultiView={inMultiView}
        isFavorited={isFavorited}
        liveDataDelaySeconds={state.inGame.liveDataDelaySeconds}
        syncCalibrationPlays={syncCalibrationPlays}
        onLiveDataDelayChange={setLiveDataDelaySeconds}
        onEditScreen={openEditScreen}
        onAddToMultiView={addCurrentGameToMultiView}
        onRemoveFromMultiView={removeCurrentGameFromMultiView}
        onGoToMultiView={goToMultiView}
        onToggleFavorite={toggleFavoriteGame}
        onClose={() => setIsActionsOpen(false)}
      />
    </Animated.View>
  );
}
