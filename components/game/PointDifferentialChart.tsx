import { useEffect, useId, useMemo, useState } from "react";
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import type { LiveGameScoreMarginPoint } from "@/hooks/useLiveGame";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { useInGameTabNavigation } from "@/src/ui/inGameTabNavigationContext";

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];
type PlottedMarginPoint = LiveGameScoreMarginPoint & { cx: number; cy: number };

const FULL_CHART_HEIGHT = 168;
// Mini variant used on the Recap tab — same curve/scale math and the same
// Q1..Qn axis labels, just a shorter canvas with the legend and scrub
// interaction dropped, since it's a tap-to-open-the-full-chart affordance
// rather than something to explore in place.
const COMPACT_CHART_HEIGHT = 112;
// Vertical strip reserved at the bottom of the COMPACT canvas for the period
// labels. The full-size chart has enough headroom to draw them over the plot
// without collision, so it keeps a zero band and renders exactly as before —
// reserving space there would move its zero line and change the Stats tab.
const COMPACT_AXIS_BAND = 16;

// Short label for period `index` (0-based). College men play two 20-minute
// halves; the NBA plays four quarters. Anything past regulation is overtime.
export function periodShortLabel(index: number, regulationPeriods: number): string {
  if (index < regulationPeriods) {
    return regulationPeriods === 2 ? ["1H", "2H"][index] ?? `H${index + 1}` : `Q${index + 1}`;
  }
  const overtimeNumber = index - regulationPeriods + 1;
  return overtimeNumber === 1 ? "OT" : `${overtimeNumber}OT`;
}

// Several plays can share the exact same period+clock (a made shot and the
// foul on it, a rebound and the ensuing timeout, etc.). Those land on the
// same x with different margins, which reads as a vertical spike and also
// skews any index-based smoothing, since "N neighbors" spans a varying amount
// of real game time depending on local play density. Collapsing same-instant
// clusters down to the FINAL play at that instant (the state once every
// simultaneous event has resolved) removes those redundant duplicate-x points
// before smoothing ever runs.
export function collapseSameInstantPlays(
  points: LiveGameScoreMarginPoint[],
): LiveGameScoreMarginPoint[] {
  if (points.length <= 1) {
    return points;
  }
  const collapsed: LiveGameScoreMarginPoint[] = [];
  let clusterStart = 0;
  for (let index = 1; index <= points.length; index += 1) {
    const isClusterBoundary =
      index === points.length ||
      points[index].period !== points[clusterStart].period ||
      points[index].time !== points[clusterStart].time;
    if (isClusterBoundary) {
      collapsed.push(points[index - 1]);
      clusterStart = index;
    }
  }
  return collapsed;
}

// Smooth over a fixed RADIUS OF REAL GAME SECONDS (not array-index neighbors),
// so every point gets a consistent amount of real-time smoothing regardless of
// how bursty or sparse the plays are around it. `time` is already a
// continuous elapsed-seconds value across periods (see buildScoreMargin), so
// it can be compared directly even across a half/quarter boundary.
//
// sigma=40s (radius=120s, a 2-minute half-width) was picked by sweeping 8s-120s
// against two real games (an NBA quarters game and an NCAA halves game) and
// counting local peaks/valleys of at least 2.5 margin points: possession-level
// noise is gone well before this point (NBA drops from ~17 meaningful wiggles
// at 8s to ~5 broad waves by 40s; NCAA from ~13 to ~3), and going wider than
// this barely reduces that count further while it keeps eroding the amplitude
// of real runs — i.e. 40s sits at the knee of the noise-vs-signal tradeoff
// rather than past it.
const MARGIN_SMOOTH_TIME_SIGMA_SECONDS = 40;

export function timeGaussianSmoothMargins(points: LiveGameScoreMarginPoint[]): number[] {
  const n = points.length;
  if (n < 3) {
    return points.map((point) => point.margin);
  }
  const sigma = MARGIN_SMOOTH_TIME_SIGMA_SECONDS;
  const radiusSeconds = sigma * 3;

  return points.map((point, index) => {
    let weightedSum = 0;
    let weightTotal = 0;
    // Points are time-sorted, so scanning outward from `index` and stopping
    // once we're past the time radius (in either direction) is enough — no
    // need to touch every point in the series for every point.
    for (let i = index; i >= 0; i -= 1) {
      const dt = point.time - points[i].time;
      if (dt > radiusSeconds) {
        break;
      }
      const weight = Math.exp(-(dt * dt) / (2 * sigma * sigma));
      weightedSum += points[i].margin * weight;
      weightTotal += weight;
    }
    for (let i = index + 1; i < n; i += 1) {
      const dt = points[i].time - point.time;
      if (dt > radiusSeconds) {
        break;
      }
      const weight = Math.exp(-(dt * dt) / (2 * sigma * sigma));
      weightedSum += points[i].margin * weight;
      weightTotal += weight;
    }
    return weightTotal > 0 ? weightedSum / weightTotal : point.margin;
  });
}

// Catmull-Rom spline through a point sequence. Unlike the basis/B-spline this
// replaced, it passes exactly through every point (it only uses neighbors to
// pick each segment's tangent), so it can't add a second, silent layer of
// amplitude loss on top of `timeGaussianSmoothMargins` — the flowing, rounded
// look comes purely from the tangent-based curve, not from blending points
// away. Endpoints reuse the adjacent point as their own neighbor (clamped/
// natural end condition), which anchors the curve at the real first/last value.
export function buildCatmullRomPath(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) {
    return "";
  }
  if (n === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }
  if (n === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const commands: string[] = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 0; index < n - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(n - 1, index + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    commands.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`);
  }

  return commands.join(" ");
}

export type PointDifferentialChartProps = {
  series: LiveGameScoreMarginPoint[];
  regulationPeriods: number;
  awayColor: string;
  homeColor: string;
  awayAbbr: string;
  homeAbbr: string;
  /**
   * Mini presentation for the Recap tab: shorter canvas, no legend, and no
   * scrub interaction (the whole card is a tap target that opens the full
   * Stats-tab chart instead).
   */
  compact?: boolean;
};

export default function PointDifferentialChart({
  series,
  regulationPeriods,
  awayColor,
  homeColor,
  awayAbbr,
  homeAbbr,
  compact = false,
}: PointDifferentialChartProps) {
  const { tokens: theme } = useAppTheme();
  const { setSwipeEnabled, setContentScrollEnabled } = useInGameTabNavigation();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const posGradientId = `pointDiff-pos-${instanceId}`;
  const negGradientId = `pointDiff-neg-${instanceId}`;
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const height = compact ? COMPACT_CHART_HEIGHT : FULL_CHART_HEIGHT;
  // Plot occupies everything above the axis band; the band is 0 for the
  // full-size chart, so its geometry is byte-for-byte what it was before.
  const axisBand = compact ? COMPACT_AXIS_BAND : 0;
  const plotHeight = height - axisBand;
  const padV = compact ? 8 : 12;
  const zeroY = plotHeight / 2;
  const scrubEnabled = !compact;

  const onLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  const hasData = series.length >= 2;
  const maxAbs = useMemo(
    () => Math.max(10, ...series.map((point) => Math.abs(point.margin))),
    [series],
  );

  // Equal-width quarter layout. Order strictly by period (then by in-period time)
  // so the line always reads Q1..Qn left to right even if the elapsed-time
  // parsing is imperfect across periods; give each period that has occurred an
  // equal-width slot; and place each point by its fraction of the elapsed time
  // WITHIN its own period. Q1 (period 1, t=0) therefore starts flush at x=0.
  const layout = useMemo(() => {
    const ordered = [...series].sort(
      (a, b) => a.period - b.period || a.time - b.time,
    );
    const totalSlots = Math.max(1, ordered.reduce((m, p) => Math.max(m, p.period), 1));
    const bounds = new Map<number, { min: number; max: number }>();
    ordered.forEach((point) => {
      const current = bounds.get(point.period);
      if (!current) {
        bounds.set(point.period, { min: point.time, max: point.time });
      } else {
        current.min = Math.min(current.min, point.time);
        current.max = Math.max(current.max, point.time);
      }
    });
    const slotX = (point: LiveGameScoreMarginPoint, chartWidth: number) => {
      const slot = Math.min(Math.max(point.period - 1, 0), totalSlots - 1);
      const bound = bounds.get(point.period);
      const frac =
        bound && bound.max > bound.min
          ? (point.time - bound.min) / (bound.max - bound.min)
          : 0;
      return ((slot + frac) / totalSlots) * chartWidth;
    };
    return { ordered, totalSlots, slotX };
  }, [series]);

  const y = (margin: number) => zeroY - (margin / maxAbs) * (zeroY - padV);
  // Collapse redundant same-instant plays first, then smooth over a fixed
  // radius of real game seconds (not array-index neighbors) — see the doc
  // comments on `collapseSameInstantPlays` / `timeGaussianSmoothMargins` for
  // why. The real max lead (`maxAbs`, above) still comes from the raw series,
  // so the chart's scale stays honest even though the curve removes
  // possession-to-possession jitter.
  const collapsedOrdered = useMemo(
    () => collapseSameInstantPlays(layout.ordered),
    [layout.ordered],
  );
  const smoothedMargins = useMemo(
    () => timeGaussianSmoothMargins(collapsedOrdered),
    [collapsedOrdered],
  );
  const plotted = useMemo<PlottedMarginPoint[]>(
    () =>
      collapsedOrdered.map((point, index) => ({
        ...point,
        cx: layout.slotX(point, width),
        cy: y(smoothedMargins[index] ?? point.margin),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collapsedOrdered, layout, width, maxAbs, smoothedMargins, height],
  );

  // Catmull-Rom (not a basis/blend-away spline) so the curve is flowing and
  // kink-free but still hits every smoothed value exactly — a real double-
  // digit run should read as a real peak, not a shallow bump.
  const linePath = buildCatmullRomPath(plotted.map((point) => ({ x: point.cx, y: point.cy })));
  const areaPath = (mode: "pos" | "neg") => {
    const clampMargin = (margin: number) =>
      mode === "pos" ? Math.max(margin, 0) : Math.min(margin, 0);
    const clampedPoints = plotted.map((point, index) => ({
      x: point.cx,
      y: y(clampMargin(smoothedMargins[index] ?? point.margin)),
    }));
    const curve = buildCatmullRomPath(clampedPoints);
    if (!curve) {
      return "";
    }
    const firstX = plotted[0]?.cx ?? 0;
    const lastX = plotted[plotted.length - 1]?.cx ?? 0;
    return `${curve} L ${lastX} ${zeroY} L ${firstX} ${zeroY} Z`;
  };

  // One equal-width slot per period that has occurred: interior boundaries at
  // slot edges, labels centered in each slot (Q1, Q2, ... left to right).
  const boundaries = Array.from({ length: layout.totalSlots - 1 }, (_, index) =>
    ((index + 1) / layout.totalSlots) * width,
  );
  const periodLabels = Array.from({ length: layout.totalSlots }, (_, index) => ({
    label: periodShortLabel(index, regulationPeriods),
    x: ((index + 0.5) / layout.totalSlots) * width,
  }));

  const activePoint = activeIndex !== null ? plotted[activeIndex] ?? null : null;

  const scrubToX = (touchX: number) => {
    if (plotted.length === 0 || width <= 0) {
      return;
    }
    const clamped = Math.max(0, Math.min(width, touchX));
    let nearest = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < plotted.length; index += 1) {
      const distance = Math.abs(plotted[index].cx - clamped);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = index;
      }
    }
    setActiveIndex(nearest);
  };
  const beginScrub = (event: GestureResponderEvent) => {
    // Lock tab-swipe and vertical scroll while scrubbing so the drag stays on
    // the chart (same pattern as MomentumTopStatsCard's scrub interaction).
    setSwipeEnabled(false);
    setContentScrollEnabled(false);
    scrubToX(event.nativeEvent.locationX);
  };
  const endScrub = () => {
    setSwipeEnabled(true);
    setContentScrollEnabled(true);
    setActiveIndex(null);
  };

  useEffect(() => {
    return () => {
      setSwipeEnabled(true);
      setContentScrollEnabled(true);
    };
  }, [setContentScrollEnabled, setSwipeEnabled]);

  const tooltipWidth = 132;
  const tooltipLeft = activePoint
    ? Math.max(0, Math.min(width - tooltipWidth, activePoint.cx - tooltipWidth / 2))
    : 0;

  return (
    <View style={compact ? styles.chartWrapCompact : styles.chartWrap}>
      {compact ? null : (
        <View style={styles.chartLegend}>
          <View style={styles.chartLegendItem}>
            <View style={[styles.chartLegendDot, { backgroundColor: homeColor }]} />
            <Text style={styles.chartLegendText}>{homeAbbr} leading</Text>
          </View>
          <View style={styles.chartLegendItem}>
            <View style={[styles.chartLegendDot, { backgroundColor: awayColor }]} />
            <Text style={styles.chartLegendText}>{awayAbbr} leading</Text>
          </View>
        </View>
      )}

      <View
        onLayout={onLayout}
        style={[styles.chartCanvas, { height }]}
        onStartShouldSetResponder={() => scrubEnabled && hasData}
        onMoveShouldSetResponder={() => scrubEnabled && hasData}
        onResponderGrant={beginScrub}
        onResponderMove={(event) => scrubToX(event.nativeEvent.locationX)}
        onResponderRelease={endScrub}
        onResponderTerminate={endScrub}
      >
        {width > 0 && hasData ? (
          <Svg width={width} height={height}>
            <Defs>
              {/* Solid near the wave AND still clearly filled all the way down
                  to the zero line (not faded to nothing there) — a big run
                  reads as a vivid fill, a small wiggle still shows real color
                  down at the axis instead of washing out. */}
              <LinearGradient
                id={posGradientId}
                x1="0"
                y1="0"
                x2="0"
                y2={zeroY}
                gradientUnits="userSpaceOnUse"
              >
                <Stop offset="0" stopColor={homeColor} stopOpacity={0.75} />
                <Stop offset="0.6" stopColor={homeColor} stopOpacity={0.5} />
                <Stop offset="1" stopColor={homeColor} stopOpacity={0.32} />
              </LinearGradient>
              <LinearGradient
                id={negGradientId}
                x1="0"
                y1={plotHeight}
                x2="0"
                y2={zeroY}
                gradientUnits="userSpaceOnUse"
              >
                <Stop offset="0" stopColor={awayColor} stopOpacity={0.75} />
                <Stop offset="0.6" stopColor={awayColor} stopOpacity={0.5} />
                <Stop offset="1" stopColor={awayColor} stopOpacity={0.32} />
              </LinearGradient>
            </Defs>
            <Path d={areaPath("pos")} fill={`url(#${posGradientId})`} />
            <Path d={areaPath("neg")} fill={`url(#${negGradientId})`} />
            {boundaries.map((boundaryX, index) => (
              <Line
                key={`${index}-${boundaryX}`}
                x1={boundaryX}
                y1={0}
                x2={boundaryX}
                y2={plotHeight}
                stroke={theme.colors.borderSoft}
                strokeWidth={1}
                strokeDasharray="3 5"
              />
            ))}
            <Line
              x1={0}
              y1={zeroY}
              x2={width}
              y2={zeroY}
              stroke={theme.colors.borderSoft}
              strokeWidth={1}
            />
            <Path d={linePath} stroke={theme.colors.textPrimary} strokeWidth={1.5} fill="none" />
            {periodLabels.map((entry) => (
              <SvgText
                key={`${entry.label}-${entry.x}`}
                x={entry.x}
                y={height - 4}
                fill={theme.colors.textMuted}
                fontSize={compact ? 10 : 11}
                fontWeight="700"
                textAnchor="middle"
              >
                {entry.label}
              </SvgText>
            ))}
            {activePoint ? (
              <>
                <Line
                  x1={activePoint.cx}
                  y1={0}
                  x2={activePoint.cx}
                  y2={plotHeight}
                  stroke={theme.colors.textPrimary}
                  strokeWidth={1.5}
                />
                <Circle
                  cx={activePoint.cx}
                  cy={activePoint.cy}
                  r={4}
                  fill={theme.colors.textPrimary}
                />
              </>
            ) : null}
          </Svg>
        ) : null}

        {activePoint ? (
          <View
            pointerEvents="none"
            style={[styles.chartTooltip, { left: tooltipLeft, width: tooltipWidth }]}
          >
            <Text style={styles.chartTooltipText} numberOfLines={1}>
              {awayAbbr} {activePoint.awayScore} - {homeAbbr} {activePoint.homeScore}
            </Text>
          </View>
        ) : null}
      </View>

      {!hasData ? (
        <Text style={styles.footerNote}>
          Point differential will appear once scoring begins.
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    chartWrap: {
      marginTop: theme.spacing[12],
      gap: theme.spacing[8],
    },
    chartWrapCompact: {
      gap: theme.spacing[6],
    },
    chartLegend: {
      flexDirection: "row",
      gap: theme.spacing[14],
    },
    chartLegendItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
    },
    chartLegendDot: {
      width: 8,
      height: 8,
      borderRadius: theme.radius.pill,
    },
    chartLegendText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    chartCanvas: {
      width: "100%",
      borderRadius: theme.radius.md,
      overflow: "hidden",
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
    },
    chartTooltip: {
      position: "absolute",
      top: theme.spacing[6],
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[4],
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.bg,
      alignItems: "center",
      justifyContent: "center",
    },
    chartTooltipText: {
      fontSize: 12,
      lineHeight: 15,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      textAlign: "center",
    },
    footerNote: {
      marginTop: theme.spacing[10],
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
  });
}
