import React, { useId, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Polyline,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import { tokens } from "@/src/theme/tokens";
import { colors } from "@/theme/colors";

type GraphPoint = {
  tSec: number;
  /** The plotted value. In rating view this is the 0-10 rating; in rank view it
   *  is the player's rank (1 = best). Kept named `rating` for back-compat. */
  rating: number;
  /** 1-based game period this point belongs to (half/quarter/OT). Used to draw
   *  only the x-axis markers for periods that have actually occurred. */
  period?: number;
  /** Game clock (seconds remaining) within the period, used to place points at
   *  their true position inside an equal-width quarter slot. */
  clockSec?: number;
};

type PlayerRatingGraphProps = {
  points: GraphPoint[];
  width?: number;
  height?: number;
  lineColor?: string;
  colorMode?: "solid" | "ratingBands";
  showBaseline?: boolean;
  smooth?: boolean;
  showFotmobStyle?: boolean;
  gridColor?: string;
  labelColor?: string;
  chartBackgroundColor?: string;
  yAxisWidth?: number;
  showSubtleAreaFill?: boolean;
  /** When set (0-10), draws a dashed horizontal reference line at this rating. */
  referenceRating?: number | null;
  referenceLineColor?: string;
  /** Detailed mode only: render Q1-Q4 markers along the x-axis. */
  showQuarterMarkers?: boolean;
  /** When true, the y-axis auto-zooms to the visible rating range (padded and
   *  clamped to 0-10) instead of a fixed 0-10 scale. */
  dynamicYAxis?: boolean;
  /** When true, each game period (quarter/half) gets EQUAL horizontal width on
   *  the x-axis regardless of how many events fell in it, instead of spacing
   *  points proportionally to elapsed time. Requires points to carry `period`. */
  equalQuarterSpacing?: boolean;
  /** Explicit y-axis domain override (e.g. rank view uses [1, rankablePlayers]).
   *  When set it takes precedence over the fixed/dynamic rating domain. */
  valueDomain?: { min: number; max: number } | null;
  /** Invert the y-axis so the domain MIN renders at the TOP (used by rank view
   *  so rank 1 is at the top). */
  invertY?: boolean;
  /** When set, draws the fotmob line in this single solid color instead of the
   *  red-to-green rating gradient (used by rank view, which is not good/bad). */
  lineColorSolid?: string | null;
  /** When set (with showFotmobStyle), reserves this many px on the left for
   *  the y-axis number labels and renders them there instead of as an
   *  overlay chip inside the plotted/background area — so the chart's own
   *  background only ever contains the line/gridlines, no overlapping text.
   *  Opt-in and defaults to 0 (existing callers render exactly as before). */
  axisMarginLeft?: number;
  /** Same idea for the bottom: reserves this many px for the Q1-Q4 labels
   *  below the plotted/background area instead of overlaying them on it. */
  axisMarginBottom?: number;
};

export default function PlayerRatingGraph({
  points,
  width = 84,
  height = 24,
  lineColor = tokens.colors.accent,
  colorMode = "ratingBands",
  showBaseline = true,
  smooth = false,
  showFotmobStyle = false,
  gridColor = "#333333",
  labelColor = tokens.colors.textMuted,
  chartBackgroundColor = "transparent",
  yAxisWidth = showFotmobStyle ? 24 : 0,
  showSubtleAreaFill = false,
  referenceRating = null,
  referenceLineColor = tokens.colors.textSecondary,
  showQuarterMarkers = false,
  dynamicYAxis = false,
  equalQuarterSpacing = false,
  valueDomain = null,
  invertY = false,
  lineColorSolid = null,
  axisMarginLeft = 0,
  axisMarginBottom = 0,
}: PlayerRatingGraphProps) {
  const hasReference =
    typeof referenceRating === "number" && Number.isFinite(referenceRating);
  // In rank view the value is not a 0-10 rating, so don't clamp to that range.
  const clampValue = (value: number) =>
    valueDomain ? value : Math.max(0, Math.min(10, value));
  const safe = points
    .filter((point) => Number.isFinite(point.tSec) && Number.isFinite(point.rating))
    .map((point) => ({
      tSec: Math.max(0, point.tSec),
      rating: clampValue(point.rating),
      period: point.period,
      clockSec: point.clockSec,
    }))
    .sort((a, b) => a.tSec - b.tSec);

  // Y-axis domain: an explicit override (rank view), else fixed 0-10 (sparklines)
  // or auto-zoomed to the on-screen rating range when dynamicYAxis is set.
  // `ratingToY` maps a value to its pixel y; when invertY is set the domain MIN
  // renders at the top (rank 1 highest).
  const yDomain = valueDomain
    ? valueDomain
    : dynamicYAxis
      ? computeRatingDomain(safe.map((point) => point.rating), {
          reference: hasReference ? (referenceRating as number) : null,
        })
      : { min: 0, max: 10 };
  const valueToFraction = (value: number) => {
    const base = ratingToYFraction(value, yDomain);
    return invertY ? 1 - base : base;
  };
  // innerHeight is the plotted area's own height — the full canvas height
  // minus whatever's reserved at the bottom for axisMarginBottom (Q-labels).
  // Everything that scales/anchors to the plot's vertical extent (the line,
  // gridlines, area fills, background rect) uses this instead of `height`
  // directly, so it never bleeds into the reserved label margin.
  const innerHeight = Math.max(1, height - axisMarginBottom);
  const ratingToY = (value: number) => valueToFraction(value) * innerHeight;

  const referenceY = hasReference ? ratingToY(referenceRating as number) : 0;

  const fallback = safe.length ? safe : [{ tSec: 0, rating: 5 }, { tSec: 1, rating: 5 }];
  const duration = Math.max(1, fallback[fallback.length - 1]?.tSec ?? 1);
  // Data spans the full width starting at x=xOrigin. Historically xOrigin was
  // always 0 with y-axis labels overlaid on top of the plot; when
  // axisMarginLeft is set (labels rendered in their own reserved margin
  // instead) the plot starts after it.
  const xOrigin = axisMarginLeft;
  const plotWidth = Math.max(1, width - axisMarginLeft);
  // Equal-width quarters: each period occupies the same horizontal slot,
  // 1/totalQuarters wide, with points placed by their fractional position within
  // that period. Falls back to time-proportional spacing when disabled.
  const quarterXMap = buildQuarterXMap(points, duration);
  const totalQuarters = quarterXMap.totalQuarters;
  const pointToX = (point: { tSec: number; period?: number; clockSec?: number }) =>
    equalQuarterSpacing
      ? xOrigin + (quarterXMap.coordFor(point) / totalQuarters) * plotWidth
      : xOrigin + (point.tSec / duration) * plotWidth;
  const normalized = fallback.map((point) => {
    const x = pointToX(point);
    const y = ratingToY(point.rating);
    return { ...point, x, y };
  });
  const coords = normalized.map((point) => `${point.x},${point.y}`);
  const segments = buildBandSegments(normalized);
  const smoothPath = smooth ? buildMonotoneLinePath(normalized) : "";
  const smoothSegments = smooth ? buildSmoothBandSegments(normalized, innerHeight) : [];
  const minAreaY = Math.min(...normalized.map((point) => point.y));
  const areaPath = showSubtleAreaFill
    ? smooth && smoothPath
      ? buildAreaPathFromLinePath(smoothPath, normalized, innerHeight)
      : buildPolylineAreaPath(normalized, innerHeight)
    : "";
  const areaFillColor = getSparklineFillColor(normalized[normalized.length - 1]?.rating ?? 5);
  // Gradient ids must be BOTH unique per chart instance AND change whenever the
  // plotted line changes:
  //  - `useId` keeps the id unique per instance so two charts on screen can't
  //    collide on the same id (which used to paint one with the other's colors).
  //  - the geometry hash makes react-native-svg mount a FRESH gradient whenever
  //    the data changes; without it, reusing a constant id left the line stuck on
  //    its first-render color (e.g. the flat orange baseline) instead of picking
  //    up the real red->green rating gradient. This mirrors the leaderboard
  //    sparkline, whose id is likewise derived from the point geometry.
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradientGeometryKey = normalized
    .map((point) => `${Math.round(point.x)}x${Math.round(point.y)}`)
    .join("_");
  const gradientBaseId = `${instanceId}-${gradientGeometryKey}`;
  const areaGradientId = `subtleAreaFill-${gradientBaseId}`;
  const gridRatings =
    valueDomain || dynamicYAxis ? niceRatingTicks(yDomain) : [3, 5, 7, 9];
  // Rank view draws a single neutral color; rating view keeps the red->green
  // gradient keyed to the rating value.
  const colorForValue = (value: number) => lineColorSolid ?? smoothRatingColor(value);

  // --- Premium detailed-chart computations (used when showFotmobStyle) ---
  const smoothLinePath = smoothPath || `M ${coords.join(" L ")}`;
  const lastPoint = normalized[normalized.length - 1] ?? { x: width, y: innerHeight / 2, rating: 5 };
  const currentColor = colorForValue(lastPoint.rating);
  const plotXStart = normalized[0]?.x ?? xOrigin;
  const plotXEnd = lastPoint.x;
  const xSpan = Math.max(1e-6, plotXEnd - plotXStart);
  const lineGradientId = `ratingLine-${gradientBaseId}`;
  const areaGradientPremiumId = `${lineGradientId}-area`;
  const lineStops = useMemo(() => {
    if (normalized.length <= 1) {
      const only = colorForValue(normalized[0]?.rating ?? 5);
      return [
        { offset: 0, color: only },
        { offset: 1, color: only },
      ];
    }
    let lastOffset = -1;
    return normalized.map((point) => {
      let offset = Math.max(0, Math.min(1, (point.x - plotXStart) / xSpan));
      if (offset <= lastOffset) {
        offset = Math.min(1, lastOffset + 1e-4);
      }
      lastOffset = offset;
      return { offset, color: colorForValue(point.rating) };
    });
  }, [normalized, plotXStart, xSpan, lineColorSolid]);
  const minLineY = Math.min(...normalized.map((point) => point.y));
  const premiumAreaPath = `${smoothLinePath} L ${plotXEnd} ${innerHeight} L ${plotXStart} ${innerHeight} Z`;
  // One equally-spaced label per period that has occurred (Q1..QtotalQuarters),
  // each centered in its equal-width slot — future quarters are never labelled.
  const quarterCenters = (() => {
    return Array.from({ length: totalQuarters }, (_, index) => ({
      label: `Q${index + 1}`,
      x: xOrigin + ((index + 0.5) / totalQuarters) * plotWidth,
    }));
  })();
  // Gridlines sit at quarter BOUNDARIES (slot edges), not centers — matches
  // the Momentum chart's `boundaries` array in PlayerModal.tsx exactly, so
  // all three charts (Rating/Rank/Momentum) mark the same Q1/Q2/Q3/Q4 edges.
  const quarterBoundaries = Array.from({ length: totalQuarters - 1 }, (_, index) =>
    xOrigin + ((index + 1) / totalQuarters) * plotWidth,
  );

  return (
    <View style={styles.wrap}>
      <Svg width={width} height={height}>
        {showSubtleAreaFill ? (
          <Defs>
            <LinearGradient
              id={areaGradientId}
              x1="0"
              y1={minAreaY}
              x2="0"
              y2={innerHeight}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0" stopColor={areaFillColor} stopOpacity="0.2" />
              <Stop offset="1" stopColor={areaFillColor} stopOpacity="0" />
            </LinearGradient>
          </Defs>
        ) : null}
        {showFotmobStyle ? (
          <>
            <Path
              d={`M ${xOrigin} 0 H ${width} V ${innerHeight} H ${xOrigin} Z`}
              fill={chartBackgroundColor}
            />

            {/* Quarter-boundary gridlines — identical positioning/styling to
                the Momentum chart's (PlayerModal.tsx): drawn at slot EDGES
                (not centers), borderSoft stroke, width 1, dash "3 5", full
                opacity (no strokeOpacity override). */}
            {showQuarterMarkers
              ? quarterBoundaries.map((boundaryX, index) => (
                  <Line
                    key={`boundary-${index}`}
                    x1={boundaryX}
                    y1={innerHeight}
                    x2={boundaryX}
                    y2={0}
                    stroke={tokens.colors.borderSoft}
                    strokeWidth={1}
                    strokeDasharray="3 5"
                  />
                ))
              : null}
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
                id={areaGradientPremiumId}
                x1="0"
                y1={minLineY}
                x2="0"
                y2={innerHeight}
                gradientUnits="userSpaceOnUse"
              >
                <Stop offset="0" stopColor={currentColor} stopOpacity="0.24" />
                <Stop offset="0.28" stopColor={currentColor} stopOpacity="0.05" />
                <Stop offset="0.5" stopColor={currentColor} stopOpacity="0" />
                <Stop offset="1" stopColor={currentColor} stopOpacity="0" />
              </LinearGradient>
            </Defs>

            {/* Soft gradient area fill: light tint near line -> transparent */}
            <Path d={premiumAreaPath} fill={`url(#${areaGradientPremiumId})`} />

            {/* Glassy glow: wide, low-opacity strokes under the crisp line */}
            <Path
              d={smoothLinePath}
              fill="none"
              stroke={`url(#${lineGradientId})`}
              strokeWidth={10}
              strokeOpacity={0.1}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d={smoothLinePath}
              fill="none"
              stroke={`url(#${lineGradientId})`}
              strokeWidth={6}
              strokeOpacity={0.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Crisp gradient line */}
            <Path
              d={smoothLinePath}
              fill="none"
              stroke={`url(#${lineGradientId})`}
              strokeWidth={2.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Y-axis value labels. With axisMarginLeft set, they render in
                their own reserved margin to the left of the plot/background
                (no backing chip needed — there's nothing under them to
                obscure). Without it (default), fall back to the original
                left-overlay-with-backing-chip treatment so existing callers
                (e.g. the team profile chart) render unchanged. */}
            {gridRatings.map((rating) => {
              const y = ratingToY(rating);
              const label = `${rating}`;
              if (axisMarginLeft > 0) {
                return (
                  <SvgText
                    key={`label-${rating}`}
                    x={xOrigin - 6}
                    y={y + 3}
                    fill={labelColor}
                    fontSize={9}
                    fontWeight="600"
                    textAnchor="end"
                  >
                    {label}
                  </SvgText>
                );
              }
              return (
                <React.Fragment key={`label-${rating}`}>
                  <Rect
                    x={0}
                    y={y - 6}
                    width={label.length * 6 + 4}
                    height={12}
                    rx={3}
                    fill={chartBackgroundColor}
                    opacity={0.7}
                  />
                  <SvgText
                    x={2}
                    y={y + 3}
                    fill={labelColor}
                    fontSize={9}
                    fontWeight="600"
                  >
                    {label}
                  </SvgText>
                </React.Fragment>
              );
            })}

            {/* Quarter markers along the x-axis */}
            {showQuarterMarkers
              ? quarterCenters.map((quarter) => (
                  <SvgText
                    key={quarter.label}
                    x={quarter.x}
                    y={height - 3}
                    fill={labelColor}
                    fontSize={10}
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {quarter.label}
                  </SvgText>
                ))
              : null}

            {/* Current-value glowing dot */}
            <Circle cx={lastPoint.x} cy={lastPoint.y} r={9} fill={currentColor} opacity={0.18} />
            <Circle cx={lastPoint.x} cy={lastPoint.y} r={5} fill={currentColor} />
            <Circle cx={lastPoint.x} cy={lastPoint.y} r={2.1} fill="#FFFFFF" />
          </>
        ) : null}
        {showSubtleAreaFill && areaPath ? (
          <Path d={areaPath} fill={`url(#${areaGradientId})`} />
        ) : null}
        {showBaseline ? (
          <Line
            x1={xOrigin}
            y1={innerHeight}
            x2={width}
            y2={innerHeight}
            stroke={tokens.colors.borderSoft}
            strokeWidth={1}
          />
        ) : null}
        {hasReference ? (
          <Line
            x1={xOrigin}
            y1={referenceY}
            x2={width}
            y2={referenceY}
            stroke={referenceLineColor}
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        ) : null}
        {showFotmobStyle ? null : colorMode === "solid" ? (
          smooth && smoothPath ? (
            <Path
              d={smoothPath}
              fill="none"
              stroke={lineColor}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : (
            <Polyline
              points={coords.join(" ")}
              fill="none"
              stroke={lineColor}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )
        ) : (
          smooth
            ? smoothSegments.map((segment, index) => (
                <Path
                  key={`${index}-${segment.d}`}
                  d={segment.d}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))
            : segments.map((segment, index) => (
                <Line
                  key={`${index}-${segment.x1}-${segment.y1}-${segment.x2}-${segment.y2}`}
                  x1={segment.x1}
                  y1={segment.y1}
                  x2={segment.x2}
                  y2={segment.y2}
                  stroke={segment.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              ))
        )}
      </Svg>
    </View>
  );
}

type NormalizedPoint = GraphPoint & { x: number; y: number };
type ChartPoint = Pick<NormalizedPoint, "x" | "y">;
type Segment = { x1: number; y1: number; x2: number; y2: number; color: string };
type PathSegment = { d: string; color: string; areaD?: string };
type CubicCurve = {
  p0: ChartPoint;
  p1: ChartPoint;
  p2: ChartPoint;
  p3: ChartPoint;
};

const BAND_THRESHOLDS = [4, 6, 8];
const EPSILON = 1e-6;

type RatingDomain = { min: number; max: number };

// Compute a padded y-axis domain from the rating values currently on screen.
// Pads by ~0.75 on each side, clamps to the valid 0-10 range, and guarantees at
// least a 1-point span so a nearly-flat line still gets a sensible scale.
// Exported so overlays rendered outside the SVG (e.g. the season-average label)
// can map through the identical domain and stay aligned with the chart.
export function computeRatingDomain(
  ratings: number[],
  options?: { padding?: number; reference?: number | null },
): RatingDomain {
  const pad = options?.padding ?? 0.75;
  const values = ratings.filter((rating) => Number.isFinite(rating));
  if (options?.reference != null && Number.isFinite(options.reference)) {
    values.push(options.reference);
  }
  if (values.length === 0) {
    return { min: 0, max: 10 };
  }
  let min = Math.max(0, Math.min(...values) - pad);
  let max = Math.min(10, Math.max(...values) + pad);
  if (max - min < 1) {
    max = Math.min(10, min + 1);
    if (max - min < 1) {
      min = Math.max(0, max - 1);
    }
  }
  return { min, max };
}

// Fraction from the top (0) to the bottom (1) of the plot for a rating within
// the domain.
export function ratingToYFraction(rating: number, domain: RatingDomain): number {
  const span = Math.max(EPSILON, domain.max - domain.min);
  const clamped = Math.min(domain.max, Math.max(domain.min, rating));
  return 1 - (clamped - domain.min) / span;
}

// Build an equal-width quarter x-mapping. Each period (quarter/half/OT) that has
// occurred owns a slot of width 1/totalQuarters; a point's x-coordinate is
// `slotIndex + fractionWithinPeriod`, so quarters render equally wide no matter
// how many events fell in them. Points that carry no period (the synthetic
// baseline at t=0 and the "current" endpoint at t=duration) are placed at the
// start of the first period and the live edge of the latest period respectively.
export function buildQuarterXMap(
  points: GraphPoint[],
  duration: number,
): {
  totalQuarters: number;
  coordFor: (point: { tSec: number; period?: number; clockSec?: number }) => number;
} {
  let maxPeriod = 1;
  // Per period: the tSec range seen, plus the largest game clock seen (which
  // approximates the period length, since the clock is highest at period start).
  const infoByPeriod = new Map<
    number,
    { minTSec: number; maxTSec: number; maxClock: number }
  >();
  for (const point of points) {
    if (
      typeof point.period === "number" &&
      Number.isFinite(point.period) &&
      Number.isFinite(point.tSec)
    ) {
      const period = Math.round(point.period);
      const tSec = Math.max(0, point.tSec);
      maxPeriod = Math.max(maxPeriod, period);
      const info = infoByPeriod.get(period) ?? {
        minTSec: tSec,
        maxTSec: tSec,
        maxClock: 0,
      };
      info.minTSec = Math.min(info.minTSec, tSec);
      info.maxTSec = Math.max(info.maxTSec, tSec);
      if (typeof point.clockSec === "number" && Number.isFinite(point.clockSec)) {
        info.maxClock = Math.max(info.maxClock, point.clockSec);
      }
      infoByPeriod.set(period, info);
    }
  }
  const totalQuarters = Math.min(Math.max(1, maxPeriod), 8);
  const presentPeriods = [...infoByPeriod.keys()].sort((a, b) => a - b);
  const lastPeriod = presentPeriods[presentPeriods.length - 1] ?? 1;

  const coordFor = (point: {
    tSec: number;
    period?: number;
    clockSec?: number;
  }): number => {
    const tSec = Math.max(0, point.tSec);
    const period =
      typeof point.period === "number" && Number.isFinite(point.period)
        ? Math.round(point.period)
        : tSec <= 0
          ? 1
          : lastPeriod;
    const slot = Math.min(Math.max(period - 1, 0), totalQuarters - 1);
    const info = infoByPeriod.get(period);
    let fraction: number;
    if (
      typeof point.clockSec === "number" &&
      Number.isFinite(point.clockSec) &&
      info &&
      info.maxClock > 0
    ) {
      // Position by the true game clock within the period: clock counts down
      // from ~maxClock (period start) to 0 (period end), so events sit at their
      // real place in the quarter instead of being stretched to fill the slot.
      fraction = Math.min(Math.max((info.maxClock - point.clockSec) / info.maxClock, 0), 1);
    } else if (info && info.maxTSec > info.minTSec) {
      const lo = info.minTSec;
      // The current (latest) period stays "open" to now so the live endpoint
      // reaches the right edge of its slot as the game progresses.
      const hi = period === lastPeriod ? Math.max(info.maxTSec, duration) : info.maxTSec;
      fraction = Math.min(Math.max((tSec - lo) / (hi - lo), 0), 1);
    } else {
      fraction = tSec <= 0 ? 0 : period === lastPeriod ? 1 : 0.5;
    }
    return slot + fraction;
  };

  return { totalQuarters, coordFor };
}

// Integer gridline values that fall inside the (padded) domain, thinned to at
// most ~5 lines. A domain span of >= 1 always contains at least one integer.
function niceRatingTicks(domain: RatingDomain): number[] {
  const lo = Math.ceil(domain.min);
  const hi = Math.floor(domain.max);
  const ticks: number[] = [];
  for (let rating = lo; rating <= hi; rating += 1) {
    ticks.push(rating);
  }
  if (ticks.length <= 5) {
    return ticks;
  }
  const step = Math.ceil(ticks.length / 5);
  return ticks.filter((_, index) => index % step === 0);
}

function ratingBandColor(rating: number): string {
  if (rating < 4) return colors.ratingLow;
  if (rating < 6) return colors.ratingOrange;
  if (rating < 8) return colors.ratingMid;
  return colors.ratingHigh;
}

function getSparklineFillColor(rating: number): string {
  if (rating < 5) return colors.ratingLow;
  if (rating < 8) return colors.ratingOrange;
  return colors.ratingHigh;
}

// Anchor the four rating-badge colors at band centers and interpolate between
// them so the line color shifts gradually (red -> orange -> yellow -> green)
// instead of snapping at hard band thresholds.
const RATING_COLOR_STOPS: { rating: number; color: string }[] = [
  { rating: 2, color: colors.ratingLow },
  { rating: 5, color: colors.ratingOrange },
  { rating: 7, color: colors.ratingMid },
  { rating: 9, color: colors.ratingHigh },
];

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace("#", "");
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) =>
    Math.round(clampNumber(value, 0, 255)).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexLerp(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t,
  );
}

// Exported so leaderboard sparklines use the identical smoothed rating-color
// transition as the detailed chart.
export function smoothRatingColor(rating: number): string {
  const value = clampNumber(rating, 0, 10);
  const stops = RATING_COLOR_STOPS;
  if (value <= stops[0].rating) {
    return stops[0].color;
  }
  if (value >= stops[stops.length - 1].rating) {
    return stops[stops.length - 1].color;
  }
  for (let i = 1; i < stops.length; i += 1) {
    if (value <= stops[i].rating) {
      const previous = stops[i - 1];
      const next = stops[i];
      const t = (value - previous.rating) / (next.rating - previous.rating);
      return hexLerp(previous.color, next.color, t);
    }
  }
  return stops[stops.length - 1].color;
}

function buildBandSegments(points: NormalizedPoint[]): Segment[] {
  const segments: Segment[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dr = b.rating - a.rating;

    if (Math.abs(dr) <= EPSILON) {
      segments.push({
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        color: ratingBandColor(a.rating),
      });
      continue;
    }

    const minR = Math.min(a.rating, b.rating);
    const maxR = Math.max(a.rating, b.rating);
    const cuts = BAND_THRESHOLDS.filter((threshold) => threshold > minR + EPSILON && threshold < maxR - EPSILON)
      .map((threshold) => (threshold - a.rating) / dr)
      .filter((t) => Number.isFinite(t) && t > EPSILON && t < 1 - EPSILON)
      .sort((x, y) => x - y);
    const stops = [0, ...cuts, 1];

    for (let j = 1; j < stops.length; j += 1) {
      const t0 = stops[j - 1];
      const t1 = stops[j];
      if (t1 - t0 <= EPSILON) continue;

      const x1 = a.x + (b.x - a.x) * t0;
      const y1 = a.y + (b.y - a.y) * t0;
      const x2 = a.x + (b.x - a.x) * t1;
      const y2 = a.y + (b.y - a.y) * t1;
      const midRating = a.rating + dr * ((t0 + t1) / 2);

      segments.push({
        x1,
        y1,
        x2,
        y2,
        color: ratingBandColor(midRating),
      });
    }
  }

  return segments;
}

// Monotone cubic interpolation (Fritsch–Carlson, equivalent to d3.curveMonotoneX).
// The curve passes through EVERY real data point (no values are altered) but is
// monotone between consecutive points, so it can never overshoot the data — which
// removes the zigzag/glitch artifacts that a Catmull-Rom spline produces at sharp
// direction changes, while a genuine rating drop still renders as a drop.
//
// Exported so the small leaderboard sparklines can reuse the exact same
// interpolation instead of a separate (jagged) implementation.
export function buildMonotoneLinePath(points: { x: number; y: number }[]): string {
  if (points.length < 2) {
    return points.length === 1 ? `M ${points[0].x} ${points[0].y}` : "";
  }

  const tangents = computeMonotoneTangents(points);
  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const dx = (p1.x - p0.x) / 3;
    const c1x = p0.x + dx;
    const c1y = p0.y + dx * tangents[i];
    const c2x = p1.x - dx;
    const c2y = p1.y - dx * tangents[i + 1];
    commands.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${p1.x} ${p1.y}`);
  }

  return commands.join(" ");
}

function computeMonotoneTangents(points: { x: number; y: number }[]): number[] {
  const n = points.length;
  const tangents = new Array<number>(n).fill(0);
  if (n < 2) {
    return tangents;
  }

  const sign = (value: number) => (value > 0 ? 1 : value < 0 ? -1 : 0);
  const secant = (i: number) => {
    const dx = points[i + 1].x - points[i].x;
    return dx !== 0 ? (points[i + 1].y - points[i].y) / dx : 0;
  };

  for (let i = 1; i < n - 1; i += 1) {
    const s0 = secant(i - 1);
    const s1 = secant(i);
    // Local extremum (opposite slopes or a flat) -> zero tangent, no overshoot.
    if (sign(s0) * sign(s1) <= 0) {
      tangents[i] = 0;
      continue;
    }
    const h0 = points[i].x - points[i - 1].x;
    const h1 = points[i + 1].x - points[i].x;
    const weighted = (s0 * h1 + s1 * h0) / (h0 + h1 || 1);
    tangents[i] =
      (sign(s0) + sign(s1)) *
      Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(weighted));
  }

  // One-sided end tangents.
  tangents[0] = n > 2 ? (3 * secant(0) - tangents[1]) / 2 : secant(0);
  tangents[n - 1] =
    n > 2 ? (3 * secant(n - 2) - tangents[n - 2]) / 2 : secant(n - 2);

  return tangents;
}

function buildSmoothBandSegments(points: NormalizedPoint[], height: number): PathSegment[] {
  const segments: PathSegment[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dr = b.rating - a.rating;
    const curve = buildSmoothCurve(points, i - 1);

    if (Math.abs(dr) <= EPSILON) {
      segments.push({
        d: cubicToPath(curve),
        areaD: cubicToAreaPath(curve, height),
        color: ratingBandColor(a.rating),
      });
      continue;
    }

    const minR = Math.min(a.rating, b.rating);
    const maxR = Math.max(a.rating, b.rating);
    const cuts = BAND_THRESHOLDS.filter((threshold) => threshold > minR + EPSILON && threshold < maxR - EPSILON)
      .map((threshold) => (threshold - a.rating) / dr)
      .filter((t) => Number.isFinite(t) && t > EPSILON && t < 1 - EPSILON)
      .sort((x, y) => x - y);
    const stops = [0, ...cuts, 1];

    for (let j = 1; j < stops.length; j += 1) {
      const t0 = stops[j - 1];
      const t1 = stops[j];
      if (t1 - t0 <= EPSILON) continue;

      const subcurve = extractCubicSegment(curve, t0, t1);
      const midRating = a.rating + dr * ((t0 + t1) / 2);

      segments.push({
        d: cubicToPath(subcurve),
        areaD: cubicToAreaPath(subcurve, height),
        color: ratingBandColor(midRating),
      });
    }
  }

  return segments;
}

function buildSmoothCurve(points: NormalizedPoint[], index: number): CubicCurve {
  const p0 = points[index];
  const p1 = points[index + 1];
  const previous = points[index - 1] ?? p0;
  const next = points[index + 2] ?? p1;

  return {
    p0,
    p1: {
      x: p0.x + (p1.x - previous.x) / 6,
      y: p0.y + (p1.y - previous.y) / 6,
    },
    p2: {
      x: p1.x - (next.x - p0.x) / 6,
      y: p1.y - (next.y - p0.y) / 6,
    },
    p3: p1,
  };
}

function cubicToPath(curve: CubicCurve): string {
  return `M ${curve.p0.x} ${curve.p0.y} C ${curve.p1.x} ${curve.p1.y} ${curve.p2.x} ${curve.p2.y} ${curve.p3.x} ${curve.p3.y}`;
}

function cubicToAreaPath(curve: CubicCurve, height: number): string {
  return `${cubicToPath(curve)} L ${curve.p3.x} ${height} L ${curve.p0.x} ${height} Z`;
}

function buildPolylineAreaPath(points: NormalizedPoint[], height: number): string {
  if (points.length < 2) {
    return "";
  }

  const line = points.map((point) => `${point.x} ${point.y}`).join(" L ");
  const first = points[0];
  const last = points[points.length - 1];
  return `M ${first.x} ${height} L ${line} L ${last.x} ${height} Z`;
}

function buildAreaPathFromLinePath(
  linePath: string,
  points: NormalizedPoint[],
  height: number,
): string {
  if (!linePath || points.length < 2) {
    return "";
  }

  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath} L ${last.x} ${height} L ${first.x} ${height} Z`;
}

function extractCubicSegment(curve: CubicCurve, t0: number, t1: number): CubicCurve {
  const clampedT0 = Math.max(0, Math.min(1, t0));
  const clampedT1 = Math.max(0, Math.min(1, t1));

  if (clampedT0 <= EPSILON && clampedT1 >= 1 - EPSILON) {
    return curve;
  }

  const [startSegment] = splitCubic(curve, clampedT1);
  if (clampedT0 <= EPSILON) {
    return startSegment;
  }

  const [, subcurve] = splitCubic(startSegment, clampedT0 / clampedT1);
  return subcurve;
}

function splitCubic(curve: CubicCurve, t: number): [CubicCurve, CubicCurve] {
  const p01 = lerpPoint(curve.p0, curve.p1, t);
  const p12 = lerpPoint(curve.p1, curve.p2, t);
  const p23 = lerpPoint(curve.p2, curve.p3, t);
  const p012 = lerpPoint(p01, p12, t);
  const p123 = lerpPoint(p12, p23, t);
  const p0123 = lerpPoint(p012, p123, t);

  return [
    {
      p0: curve.p0,
      p1: p01,
      p2: p012,
      p3: p0123,
    },
    {
      p0: p0123,
      p1: p123,
      p2: p23,
      p3: curve.p3,
    },
  ];
}

function lerpPoint(a: ChartPoint, b: ChartPoint, t: number): ChartPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

const styles = StyleSheet.create({
  wrap: {
    justifyContent: "center",
  },
});
