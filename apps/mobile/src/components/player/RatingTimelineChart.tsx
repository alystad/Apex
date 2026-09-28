import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS, useSharedValue } from "react-native-reanimated";
import Svg, { Circle, Line, Polyline } from "react-native-svg";

import { colors } from "@/theme/colors";

export type RatingTimelinePoint = {
  tSec: number;
  rating: number;
  reason?: string;
  stats?: {
    minutesDisplay: string;
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    tov: number;
    fls: number;
    fg: string;
    threePt: string;
    ft: string;
  };
};

type RatingTimelineChartProps = {
  points: RatingTimelinePoint[];
  durationSec: number;
  startRating: number;
  endRating: number;
  onActivePointChange?: (point: RatingTimelinePoint | null) => void;
};

const CHART_HEIGHT = 120;
const CHART_PADDING_X = 10;
const CHART_PADDING_Y = 8;
const INFO_STRIP_HEIGHT = 30;
const PLOT_TOP = CHART_PADDING_Y + INFO_STRIP_HEIGHT;
const PLOT_BOTTOM = CHART_HEIGHT - CHART_PADDING_Y;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;
const DEFAULT_TIMELINE_STATS: NonNullable<RatingTimelinePoint["stats"]> = {
  minutesDisplay: "0.0",
  pts: 0,
  reb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  tov: 0,
  fls: 0,
  fg: "0-0",
  threePt: "0-0",
  ft: "0-0",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatClockMmSs(tSec: number): string {
  const clamped = Math.max(0, Math.floor(tSec));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatOneDecimal(value: number): string {
  return Number(value.toFixed(1)).toString();
}

function nearestIndexByBinarySearch(xs: number[], targetX: number): number {
  if (xs.length <= 1) {
    return 0;
  }
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (xs[mid] < targetX) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  if (lo === 0) {
    return 0;
  }
  const prev = lo - 1;
  return Math.abs(xs[lo] - targetX) < Math.abs(xs[prev] - targetX) ? lo : prev;
}

export default function RatingTimelineChart({
  points,
  durationSec,
  startRating,
  endRating,
  onActivePointChange,
}: RatingTimelineChartProps) {
  const [width, setWidth] = useState(0);
  const [scrubChangeIndex, setScrubChangeIndex] = useState<number | null>(null);
  const [selectedChangeIndex, setSelectedChangeIndex] = useState<number | null>(null);
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const hasTouchStart = useSharedValue(0);
  const panActivated = useSharedValue(0);

  const normalizedPoints = useMemo<RatingTimelinePoint[]>(() => {
    let lastKnownStats: NonNullable<RatingTimelinePoint["stats"]> = DEFAULT_TIMELINE_STATS;
    const sorted = points
      .filter(
        (point) =>
          Number.isFinite(point.tSec) &&
          Number.isFinite(point.rating),
      )
      .sort((a, b) => a.tSec - b.tSec);
    const valid = sorted
      .map((point) => {
        const stats = point.stats ?? lastKnownStats;
        lastKnownStats = stats;
        return {
          tSec: Math.max(0, Math.round(point.tSec)),
          rating: Number(clamp(point.rating, 0, 10).toFixed(1)),
          reason: point.reason,
          stats,
        };
      });
    const deduped: RatingTimelinePoint[] = [];
    valid.forEach((point) => {
      const prev = deduped[deduped.length - 1];
      if (prev && prev.tSec === point.tSec) {
        deduped[deduped.length - 1] = point;
        return;
      }
      deduped.push(point);
    });
    const initialRating = Number(clamp(startRating, 0, 10).toFixed(1));
    if (!deduped.length || deduped[0].tSec !== 0) {
      deduped.unshift({ tSec: 0, rating: initialRating, stats: DEFAULT_TIMELINE_STATS });
    } else {
      deduped[0] = { ...deduped[0], rating: initialRating, stats: deduped[0].stats ?? DEFAULT_TIMELINE_STATS };
    }
    return deduped;
  }, [points, startRating]);

  const resolvedDurationSec = useMemo(() => {
    const maxPointSec = normalizedPoints[normalizedPoints.length - 1]?.tSec ?? 0;
    return Math.max(1, Math.round(durationSec), maxPointSec);
  }, [durationSec, normalizedPoints]);

  const geometry = useMemo(() => {
    if (width <= 0) {
      return null;
    }
    const innerWidth = Math.max(1, width - CHART_PADDING_X * 2);
    const mapped = normalizedPoints.map((point, sourceIndex) => {
      const x = CHART_PADDING_X + clamp(point.tSec / resolvedDurationSec, 0, 1) * innerWidth;
      const y = PLOT_TOP + (1 - clamp(point.rating / 10, 0, 1)) * Math.max(1, PLOT_HEIGHT);
      return { ...point, sourceIndex, x, y };
    });
    const changePoints = mapped.filter(
      (point) =>
        point.sourceIndex > 0 &&
        point.rating !== mapped[point.sourceIndex - 1]?.rating,
    );
    const changeXs = changePoints.map((point) => point.x);
    return {
      mapped,
      changePoints,
      changeXs,
    };
  }, [normalizedPoints, resolvedDurationSec, width]);

  const updateScrub = useCallback(
    (x: number) => {
      if (!geometry || width <= 0) {
        return;
      }
      if (geometry.changeXs.length === 0) {
        setScrubChangeIndex(null);
        return;
      }
      const clampedX = clamp(x, CHART_PADDING_X, width - CHART_PADDING_X);
      const nextIndex = nearestIndexByBinarySearch(geometry.changeXs, clampedX);
      setScrubChangeIndex(nextIndex);
    },
    [geometry, width],
  );

  const clearScrub = useCallback(() => {
    setScrubChangeIndex(null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedChangeIndex(null);
  }, []);

  const selectChangePointByTap = useCallback(
    (x: number, y: number) => {
      if (!geometry || width <= 0 || geometry.changeXs.length === 0) {
        clearSelection();
        return;
      }
      const clampedX = clamp(x, CHART_PADDING_X, width - CHART_PADDING_X);
      const candidateIndex = nearestIndexByBinarySearch(geometry.changeXs, clampedX);
      const candidate = geometry.changePoints[candidateIndex];
      if (!candidate) {
        clearSelection();
        return;
      }
      const hitHalfSize = 22;
      const withinX = Math.abs(candidate.x - clampedX) <= hitHalfSize;
      const withinY = Math.abs(candidate.y - y) <= hitHalfSize;
      if (!withinX || !withinY) {
        clearSelection();
        return;
      }
      setSelectedChangeIndex(candidateIndex);
      setScrubChangeIndex(null);
    },
    [clearSelection, geometry, width],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .hitSlop({ top: 22, bottom: 22, left: 22, right: 22 })
        .onTouchesDown((event) => {
          const touch = event.changedTouches[0];
          if (!touch) {
            return;
          }
          touchStartX.value = touch.x;
          touchStartY.value = touch.y;
          hasTouchStart.value = 1;
          panActivated.value = 0;
        })
        .onTouchesMove((event, state) => {
          const touch = event.changedTouches[0];
          if (!touch || !hasTouchStart.value || panActivated.value) {
            return;
          }
          const dx = touch.x - touchStartX.value;
          const dy = touch.y - touchStartY.value;
          if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            panActivated.value = 1;
            state.activate();
            return;
          }
          if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx) * 1.2) {
            state.fail();
          }
        })
        .onStart((event) => {
          runOnJS(setSelectedChangeIndex)(null);
          runOnJS(updateScrub)(event.x);
        })
        .onUpdate((event) => {
          runOnJS(updateScrub)(event.x);
        })
        .onEnd(() => {
          runOnJS(clearScrub)();
        })
        .onFinalize(() => {
          panActivated.value = 0;
          hasTouchStart.value = 0;
          runOnJS(clearScrub)();
        }),
    [
      clearScrub,
      hasTouchStart,
      panActivated,
      touchStartX,
      touchStartY,
      updateScrub,
    ],
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .maxDuration(300)
        .maxDistance(22)
        .hitSlop({ top: 22, bottom: 22, left: 22, right: 22 })
        .onEnd((event, success) => {
          if (!success) {
            return;
          }
          selectChangePointByTap(event.x, event.y);
        }),
    [selectChangePointByTap],
  );

  const combinedGesture = useMemo(
    () => Gesture.Simultaneous(tapGesture, panGesture),
    [tapGesture, panGesture],
  );

  const trendColor = endRating >= startRating ? colors.upColor : colors.downColor;
  const scrubbedPoint =
    geometry &&
    scrubChangeIndex !== null &&
    scrubChangeIndex >= 0 &&
    scrubChangeIndex < geometry.changePoints.length
      ? geometry.changePoints[scrubChangeIndex]
      : null;
  const selectedPoint =
    geometry &&
    selectedChangeIndex !== null &&
    selectedChangeIndex >= 0 &&
    selectedChangeIndex < geometry.changePoints.length
      ? geometry.changePoints[selectedChangeIndex]
      : null;
  const activePoint = scrubbedPoint ?? selectedPoint ?? null;
  const crosshairX = scrubbedPoint ? scrubbedPoint.x : selectedPoint ? selectedPoint.x : null;
  const showChangeMarkers = scrubbedPoint !== null || selectedPoint !== null;
  const activeReason = activePoint?.reason?.trim();

  useEffect(() => {
    if (!onActivePointChange) {
      return;
    }
    if (!activePoint) {
      onActivePointChange(null);
      return;
    }
    onActivePointChange({
      tSec: activePoint.tSec,
      rating: activePoint.rating,
      reason: activePoint.reason,
      stats: activePoint.stats,
    });
  }, [activePoint, onActivePointChange]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (Number.isFinite(nextWidth) && nextWidth > 0) {
      setWidth(nextWidth);
    }
  }, []);

  const polylinePoints = geometry?.mapped
    .map((point) => `${point.x},${point.y}`)
    .join(" ");

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <GestureDetector gesture={combinedGesture}>
        <View style={styles.gestureRegion}>
          <View style={styles.infoStrip}>
            {activePoint ? (
              <>
                <Text style={styles.infoPrimary}>
                  {formatClockMmSs(activePoint.tSec)} | {formatOneDecimal(activePoint.rating)}
                </Text>
                <Text numberOfLines={1} style={styles.infoReason}>
                  {activeReason && activeReason.length > 0 ? activeReason : "No tagged event"}
                </Text>
              </>
            ) : (
              <Text style={styles.infoIdle}>Slide or tap a change point to inspect the trend.</Text>
            )}
          </View>
          <Svg width={width} height={CHART_HEIGHT} pointerEvents="none">
            {polylinePoints ? (
              <Polyline
                points={polylinePoints}
                fill="none"
                stroke={trendColor}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {showChangeMarkers && geometry
              ? geometry.changePoints.map((point, index) => (
                  <Circle
                    key={`change-${point.tSec}-${index}`}
                    cx={point.x}
                    cy={point.y}
                    r={2.4}
                    fill={trendColor}
                    opacity={0.6}
                  />
                ))
              : null}
            {activePoint && crosshairX !== null && geometry ? (
              <Line
                x1={crosshairX}
                y1={PLOT_TOP}
                x2={crosshairX}
                y2={PLOT_BOTTOM}
                stroke={trendColor}
                strokeWidth={1}
                opacity={0.85}
              />
            ) : null}
            {activePoint ? (
              <Circle cx={activePoint.x} cy={activePoint.y} r={3.5} fill={trendColor} />
            ) : null}
          </Svg>
          <View style={styles.topLabelWrap} pointerEvents="none">
            <Text style={styles.axisLabel}>10</Text>
          </View>
          <View style={styles.bottomLabelWrap} pointerEvents="none">
            <Text style={styles.axisLabel}>0</Text>
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: CHART_HEIGHT,
  },
  gestureRegion: {
    height: CHART_HEIGHT,
    minHeight: 44,
    width: "100%",
    justifyContent: "center",
  },
  axisLabel: {
    color: colors.textMuted,
    fontSize: 9,
    opacity: 0.45,
    fontWeight: "600",
  },
  topLabelWrap: {
    position: "absolute",
    top: CHART_PADDING_Y - 1,
    left: 2,
  },
  bottomLabelWrap: {
    position: "absolute",
    bottom: CHART_PADDING_Y - 2,
    left: 2,
  },
  infoStrip: {
    position: "absolute",
    top: CHART_PADDING_Y,
    left: CHART_PADDING_X,
    right: CHART_PADDING_X,
    minHeight: INFO_STRIP_HEIGHT,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.surface,
    justifyContent: "center",
  },
  infoPrimary: {
    color: colors.text,
    fontSize: 10,
    fontWeight: "600",
  },
  infoReason: {
    marginTop: 1,
    color: colors.textMuted,
    fontSize: 9,
  },
  infoIdle: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: "600",
  },
});
