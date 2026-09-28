import { useEffect, useMemo, useState } from "react";
import { LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import type { LiveGameWinProbPoint } from "@/hooks/useLiveGame";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { useInGameTabNavigation } from "@/src/ui/inGameTabNavigationContext";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type TeamChartMeta = {
  id: string;
  name: string;
  color: string;
  alternateColor?: string | null;
};

type MomentumTopStatsCardProps = {
  awayTeam?: TeamChartMeta;
  homeTeam?: TeamChartMeta;
  winProbability?: LiveGameWinProbPoint[];
  startDateTime?: string;
  status?: {
    period: number;
    displayClock: string;
    state: string;
  } | null;
  isLive: boolean;
  title?: string;
  timelineLabels?: { start: string; mid: string; end: string };
  momentumPoints?: Array<{ t: number; v: number }>;
  events?: Array<{ t: number; type: "score" | "foul" | "timeout" | "sub"; team: "home" | "away" }>;
  topBar?: { label: string; homePct: number; awayPct: number };
  statRows?: Array<{ label: string; home: string; away: string }>;
  homeTeamColor?: string;
  awayTeamColor?: string;
};

type ChartPoint = {
  x: number;
  homeY: number;
  awayY: number;
  homeProb: number;
  awayProb: number;
  time: number;
  actualTimeIso?: string;
};

type PeriodMarker = {
  time: number;  // elapsed seconds
  label: string; // "HT", "OT", "OT2", etc.
};

const CHART_HEIGHT = 180;
const X_AXIS_HEIGHT = 24;
const CARD_HEIGHT = CHART_HEIGHT + X_AXIS_HEIGHT + 16;
const CHART_PAD_X = 6;
const CHART_PAD_Y = 10;
// Gutter on the right where end-of-line % labels live
const END_LABEL_GUTTER = 44;
// College basketball half duration in seconds
const HALF_DURATION = 1200;
// OT period duration
const OT_DURATION = 300;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeTeamColor(color: string | null | undefined, fallback: string): string {
  if (!color || typeof color !== "string") return fallback;
  const normalized = color.startsWith("#") ? color : `#${color}`;
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : fallback;
}

function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const normalized = safeTeamColor(color, "");
  if (!normalized) return null;
  const match = /^#([0-9A-Fa-f]{6})$/.exec(normalized);
  if (!match) return null;
  return {
    r: Number.parseInt(match[1].slice(0, 2), 16),
    g: Number.parseInt(match[1].slice(2, 4), 16),
    b: Number.parseInt(match[1].slice(4, 6), 16),
  };
}

function isVeryDarkColor(color: string): boolean {
  const rgb = hexToRgb(color);
  if (!rgb) return false;
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance < 0.22;
}

function formatPercent(value: number): string {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function formatActualTimeLabel(isoString: string | undefined): string | null {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function estimateActualTimeLabel(
  startDateTime: string | undefined,
  elapsedGameSeconds: number,
): string | null {
  if (!startDateTime) return null;
  const start = new Date(startDateTime);
  if (Number.isNaN(start.getTime())) return null;
  const estimated = new Date(start.getTime() + Math.max(0, elapsedGameSeconds) * 1000);
  return estimated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Stepped ("step-after") path: hold each point's y flat until the next
// point's x, then jump vertically — an orderbook/ticker look, matching how
// win probability actually updates (discrete events), instead of implying
// a smooth continuous transition between updates.
function stepSvgPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;

  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    d += ` L ${curr.x.toFixed(2)} ${prev.y.toFixed(2)} L ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
  }
  return d;
}

// Small solid dot at a line's live endpoint, with a looping radar-ping ring
// (scale + fade out) behind it while the game is live. Finished games just
// get the static dot — no animation running for a game that's over.
function PulsingEndpointDot({
  cx,
  cy,
  color,
  isLive,
}: {
  cx: number;
  cy: number;
  color: string;
  isLive: boolean;
}) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!isLive) {
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
  }, [isLive, pulse]);

  const ringProps = useAnimatedProps(() => ({
    r: 4 + pulse.value * 8,
    opacity: (1 - pulse.value) * 0.55,
  }));

  return (
    <>
      {isLive ? (
        <AnimatedCircle cx={cx} cy={cy} fill={color} animatedProps={ringProps} />
      ) : null}
      <Circle cx={cx} cy={cy} r={4} fill={color} />
    </>
  );
}

// Detect half-time and OT boundaries from the time range of the data.
// Assumes college basketball halves (1200s each) as the default.
function detectPeriodMarkers(maxTime: number): PeriodMarker[] {
  const markers: PeriodMarker[] = [];
  // Halftime break (end of first half)
  if (maxTime > HALF_DURATION * 0.4) {
    markers.push({ time: HALF_DURATION, label: "HT" });
  }
  // OT periods
  const regularEndTime = HALF_DURATION * 2;
  if (maxTime > regularEndTime + OT_DURATION * 0.3) {
    markers.push({ time: regularEndTime, label: "OT" });
    let otIdx = 1;
    while (maxTime > regularEndTime + otIdx * OT_DURATION + OT_DURATION * 0.3) {
      markers.push({ time: regularEndTime + otIdx * OT_DURATION, label: `OT${otIdx + 1}` });
      otIdx++;
    }
  }
  return markers;
}

export const mockMomentumData = {
  momentumPoints: Array.from({ length: 24 }, (_, i) => ({
    t: i * 100,
    v: Math.sin(i / 4) * 0.22,
  })),
  events: [] as Array<{ t: number; type: "score" | "foul" | "timeout" | "sub"; team: "home" | "away" }>,
  winProbability: Array.from({ length: 24 }, (_, i) => ({
    time: i * 100,
    homeWinProb: clamp(0.5 + Math.sin(i / 4) * 0.22, 0.05, 0.95),
  })),
};

export default function MomentumTopStatsCard({
  awayTeam,
  homeTeam,
  winProbability,
  startDateTime,
  momentumPoints,
  topBar,
  homeTeamColor,
  awayTeamColor,
  isLive,
}: MomentumTopStatsCardProps) {
  const { tokens: theme, isDark } = useAppTheme();
  const { setSwipeEnabled, setContentScrollEnabled } = useInGameTabNavigation();
  const [chartWidth, setChartWidth] = useState(0);
  const [timeLabelWidth, setTimeLabelWidth] = useState(0);
  const [selectedX, setSelectedX] = useState<number | null>(null);

  const fallbackAway: TeamChartMeta = {
    id: "away",
    name: awayTeam?.name || "Away",
    color: awayTeam?.color || awayTeamColor || theme.colors.textSecondary,
    alternateColor: awayTeam?.alternateColor ?? null,
  };
  const fallbackHome: TeamChartMeta = {
    id: "home",
    name: homeTeam?.name || "Home",
    color: homeTeam?.color || homeTeamColor || theme.colors.accentStrong,
    alternateColor: homeTeam?.alternateColor ?? null,
  };

  const sourceWinProb = useMemo(() => {
    if (winProbability && winProbability.length > 0) return winProbability;
    if (momentumPoints && momentumPoints.length > 0) {
      return momentumPoints.map((point) => ({
        time: Math.max(0, point.t),
        homeWinProb: clamp(0.5 + point.v * 0.5, 0.01, 0.99),
        actualTimeIso: undefined,
      }));
    }
    if (topBar) {
      return [{ time: 0, homeWinProb: clamp(topBar.homePct / 100, 0.01, 0.99), actualTimeIso: undefined }];
    }
    return [];
  }, [momentumPoints, topBar, winProbability]);

  const resolvedHomeBaseColor = safeTeamColor(
    isVeryDarkColor(safeTeamColor(fallbackHome.color, theme.colors.accentStrong))
      ? fallbackHome.alternateColor ?? fallbackHome.color
      : fallbackHome.color,
    theme.colors.accentStrong,
  );
  const resolvedAwayBaseColor = safeTeamColor(
    isVeryDarkColor(safeTeamColor(fallbackAway.color, theme.colors.textSecondary))
      ? fallbackAway.alternateColor ?? fallbackAway.color
      : fallbackAway.color,
    theme.colors.textSecondary,
  );
  const homeColor = resolvedHomeBaseColor;
  const awayColor = resolvedAwayBaseColor;

  const cleaned = useMemo(() => {
    const base = sourceWinProb
      .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.homeWinProb))
      .map((p) => ({
        time: Math.max(0, p.time),
        homeWinProb: clamp(p.homeWinProb, 0.01, 0.99),
        actualTimeIso: p.actualTimeIso,
      }))
      .sort((a, b) => a.time - b.time);

    if (base.length === 0) return [{ time: 0, homeWinProb: 0.5, actualTimeIso: undefined }];
    if (base.length === 1) return [base[0], { ...base[0], time: base[0].time + 1 }];
    return base;
  }, [sourceWinProb]);

  const plotW = Math.max(1, chartWidth - END_LABEL_GUTTER - CHART_PAD_X * 2);
  const plotH = CHART_HEIGHT - CHART_PAD_Y * 2;
  const timeStart = cleaned[0]?.time ?? 0;
  const timeEnd = cleaned[cleaned.length - 1]?.time ?? 1;
  const timeSpan = Math.max(1, timeEnd - timeStart);

  const xForTime = (t: number): number =>
    CHART_PAD_X + ((t - timeStart) / timeSpan) * plotW;

  const points = useMemo<ChartPoint[]>(() => {
    return cleaned.map((p) => {
      const x = xForTime(p.time);
      const homeProb = clamp(p.homeWinProb, 0.01, 0.99);
      const awayProb = clamp(1 - homeProb, 0.01, 0.99);
      return {
        x,
        homeY: CHART_PAD_Y + (1 - homeProb) * plotH,
        awayY: CHART_PAD_Y + (1 - awayProb) * plotH,
        homeProb,
        awayProb,
        time: p.time,
        actualTimeIso: p.actualTimeIso,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartWidth, cleaned]);

  const interactiveMinX = CHART_PAD_X;
  const interactiveMaxX = Math.max(CHART_PAD_X, chartWidth - END_LABEL_GUTTER - CHART_PAD_X);

  const active = useMemo<ChartPoint | undefined>(() => {
    if (points.length === 0) return undefined;
    if (selectedX === null) return points[points.length - 1];
    const x = clamp(selectedX, interactiveMinX, interactiveMaxX);
    const first = points[0];
    const last = points[points.length - 1];
    if (x <= first.x) return first;
    if (x >= last.x) return last;
    for (let i = 1; i < points.length; i++) {
      const right = points[i];
      if (x > right.x) continue;
      const left = points[i - 1];
      const span = Math.max(0.0001, right.x - left.x);
      const t = clamp((x - left.x) / span, 0, 1);
      const homeProb = clamp(left.homeProb + (right.homeProb - left.homeProb) * t, 0.01, 0.99);
      return {
        x,
        homeProb,
        awayProb: clamp(1 - homeProb, 0.01, 0.99),
        homeY: left.homeY + (right.homeY - left.homeY) * t,
        awayY: left.awayY + (right.awayY - left.awayY) * t,
        time: left.time + (right.time - left.time) * t,
        actualTimeIso: undefined,
      };
    }
    return points[points.length - 1];
  }, [interactiveMaxX, interactiveMinX, points, selectedX]);

  const activeTimeLabel = useMemo(() => {
    if (selectedX === null || !active) return null;
    let nearestPoint: ChartPoint | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const point of points) {
      if (!point.actualTimeIso) continue;
      const distance = Math.abs(point.x - active.x);
      if (distance < nearestDistance) { nearestDistance = distance; nearestPoint = point; }
    }
    return formatActualTimeLabel(nearestPoint?.actualTimeIso) ?? estimateActualTimeLabel(startDateTime, active.time);
  }, [active, points, selectedX, startDateTime]);

  // Stepped SVG path strings
  const homePts = points.map((p) => ({ x: p.x, y: p.homeY }));
  const awayPts = points.map((p) => ({ x: p.x, y: p.awayY }));
  const homePathD = stepSvgPath(homePts);
  const awayPathD = stepSvgPath(awayPts);

  // Period markers (only render ones that fall within the chart's time range)
  const periodMarkers = useMemo(() => {
    if (chartWidth === 0) return [];
    const maxTime = cleaned[cleaned.length - 1]?.time ?? 0;
    return detectPeriodMarkers(maxTime).filter((m) => m.time > timeStart && m.time < timeEnd);
  }, [chartWidth, cleaned, timeStart, timeEnd]);

  // Collision-avoidance for end labels: separate home/away if they're too close
  const lastPt = points[points.length - 1];
  const homeEndY = lastPt ? lastPt.homeY : CHART_HEIGHT / 2;
  const awayEndY = lastPt ? lastPt.awayY : CHART_HEIGHT / 2;
  const MIN_LABEL_GAP = 16;
  let homeEndLabelY = homeEndY;
  let awayEndLabelY = awayEndY;
  if (Math.abs(homeEndY - awayEndY) < MIN_LABEL_GAP) {
    const midY = (homeEndY + awayEndY) / 2;
    homeEndLabelY = midY - MIN_LABEL_GAP / 2;
    awayEndLabelY = midY + MIN_LABEL_GAP / 2;
  }

  const timeLabelLeft =
    active && activeTimeLabel
      ? clamp(
          active.x - timeLabelWidth / 2,
          CHART_PAD_X,
          Math.max(CHART_PAD_X, interactiveMaxX - timeLabelWidth),
        )
      : CHART_PAD_X;

  const endLabelX = interactiveMaxX + 6;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          height: CARD_HEIGHT,
        },
        chartWrap: {
          height: CHART_HEIGHT,
          overflow: "hidden",
        },
        xAxis: {
          height: X_AXIS_HEIGHT,
          flexDirection: "row",
          alignItems: "flex-start",
          position: "relative",
          paddingTop: 4,
        },
        periodLabel: {
          position: "absolute",
          fontSize: 10,
          fontWeight: "700",
          color: isDark ? "rgba(148,163,184,0.7)" : "rgba(71,85,105,0.7)",
          textAlign: "center",
        },
        scrubTimeLabel: {
          position: "absolute",
          top: 6,
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 10,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
          backgroundColor: isDark ? "rgba(12,18,29,0.92)" : "rgba(248,251,255,0.96)",
          alignItems: "center",
          justifyContent: "center",
        },
        scrubTimeLabelText: {
          color: isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.8)",
          fontSize: 11,
          fontWeight: "800",
        },
      }),
    [isDark],
  );

  useEffect(() => {
    return () => {
      setSwipeEnabled(true);
      setContentScrollEnabled(true);
    };
  }, [setContentScrollEnabled, setSwipeEnabled]);

  const onChartLayout = (event: LayoutChangeEvent) => {
    const w = event.nativeEvent.layout.width;
    if (w !== chartWidth) setChartWidth(w);
  };

  const updateFromTouch = (touchX: number) => {
    setSelectedX(clamp(touchX, interactiveMinX, interactiveMaxX));
  };

  const beginChartInteraction = (touchX: number) => {
    setSwipeEnabled(false);
    setContentScrollEnabled(false);
    updateFromTouch(touchX);
  };

  const endChartInteraction = () => {
    setSelectedX(null);
    setSwipeEnabled(true);
    setContentScrollEnabled(true);
  };

  return (
    <View style={styles.card}>
      {/* Line chart */}
      <View
        style={styles.chartWrap}
        onLayout={onChartLayout}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => beginChartInteraction(e.nativeEvent.locationX)}
        onResponderMove={(e) => updateFromTouch(e.nativeEvent.locationX)}
        onResponderRelease={endChartInteraction}
        onResponderTerminate={endChartInteraction}
      >
        <Svg width="100%" height={CHART_HEIGHT}>
          {/* Period boundary lines */}
          {periodMarkers.map((marker) => {
            const mx = xForTime(marker.time);
            return (
              <Line
                key={marker.label}
                x1={mx}
                y1={CHART_PAD_Y}
                x2={mx}
                y2={CHART_HEIGHT - CHART_PAD_Y}
                stroke={theme.colors.borderSoft}
                strokeWidth={1}
                strokeDasharray="3 5"
              />
            );
          })}

          {/* Away line */}
          <Path
            d={awayPathD}
            fill="none"
            stroke={awayColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Home line */}
          <Path
            d={homePathD}
            fill="none"
            stroke={homeColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Live endpoint dots */}
          {selectedX === null && lastPt ? (
            <>
              <PulsingEndpointDot cx={lastPt.x} cy={lastPt.awayY} color={awayColor} isLive={isLive} />
              <PulsingEndpointDot cx={lastPt.x} cy={lastPt.homeY} color={homeColor} isLive={isLive} />
            </>
          ) : null}

          {/* Scrubber line */}
          {selectedX !== null ? (
            <Line
              x1={active?.x ?? 0}
              y1={CHART_PAD_Y}
              x2={active?.x ?? 0}
              y2={CHART_HEIGHT - CHART_PAD_Y}
              stroke={isDark ? "rgba(215,228,255,0.4)" : "rgba(13,23,38,0.14)"}
              strokeWidth={0.8}
            />
          ) : null}

          {/* End-of-line win% labels (shown when not scrubbing) */}
          {selectedX === null && lastPt ? (
            <>
              <SvgText
                x={endLabelX}
                y={clamp(homeEndLabelY + 4, CHART_PAD_Y + 4, CHART_HEIGHT - 4)}
                fill={homeColor}
                fontSize="11"
                fontWeight="800"
              >
                {formatPercent(lastPt.homeProb)}
              </SvgText>
              <SvgText
                x={endLabelX}
                y={clamp(awayEndLabelY + 4, CHART_PAD_Y + 4, CHART_HEIGHT - 4)}
                fill={awayColor}
                fontSize="11"
                fontWeight="800"
              >
                {formatPercent(lastPt.awayProb)}
              </SvgText>
            </>
          ) : null}

          {/* Scrubbing win% labels */}
          {selectedX !== null && active ? (
            <>
              <SvgText
                x={endLabelX}
                y={clamp(active.homeY + 4, CHART_PAD_Y + 4, CHART_HEIGHT - 4)}
                fill={homeColor}
                fontSize="11"
                fontWeight="800"
              >
                {formatPercent(active.homeProb)}
              </SvgText>
              <SvgText
                x={endLabelX}
                y={clamp(active.awayY + 4, CHART_PAD_Y + 4, CHART_HEIGHT - 4)}
                fill={awayColor}
                fontSize="11"
                fontWeight="800"
              >
                {formatPercent(active.awayProb)}
              </SvgText>
            </>
          ) : null}

          {/* Period boundary labels inside chart (near top of each boundary line) */}
          {periodMarkers.map((marker) => {
            const mx = xForTime(marker.time);
            return (
              <SvgText
                key={`lbl-${marker.label}`}
                x={mx}
                y={CHART_PAD_Y + 10}
                fill={isDark ? "rgba(148,163,184,0.65)" : "rgba(71,85,105,0.65)"}
                fontSize="9"
                fontWeight="700"
                textAnchor="middle"
              >
                {marker.label}
              </SvgText>
            );
          })}
        </Svg>

        {/* Scrub time label */}
        {active && activeTimeLabel ? (
          <View
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              if (w !== timeLabelWidth) setTimeLabelWidth(w);
            }}
            style={[styles.scrubTimeLabel, { left: timeLabelLeft }]}
          >
            <Text style={styles.scrubTimeLabelText}>{activeTimeLabel}</Text>
          </View>
        ) : null}
      </View>

      {/* X-axis period section labels */}
      {chartWidth > 0 ? (
        <View style={[styles.xAxis, { paddingLeft: CHART_PAD_X, paddingRight: END_LABEL_GUTTER }]}>
          {/* "1H" at far left */}
          <Text style={[styles.periodLabel, { left: 0 }]}>1H</Text>

          {/* Marker labels centered on their boundary x position */}
          {periodMarkers.map((marker) => {
            const mx = xForTime(marker.time) - CHART_PAD_X;
            return (
              <Text
                key={`axis-${marker.label}`}
                style={[styles.periodLabel, { left: mx - 12, width: 24, textAlign: "center" }]}
              >
                {marker.label}
              </Text>
            );
          })}

          {/* "2H" just after halftime marker */}
          {periodMarkers.some((m) => m.label === "HT") ? (
            <Text
              style={[
                styles.periodLabel,
                {
                  left: xForTime(HALF_DURATION) - CHART_PAD_X + 8,
                },
              ]}
            >
              2H
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
