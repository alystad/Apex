import { useId, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";

import { buildMonotoneLinePath } from "@/components/ui/PlayerRatingGraph";
import {
  marketColors,
  marketSpacing,
  marketType,
} from "@/src/features/stockmarket/marketTheme";
import type { StockPricePoint } from "@/src/features/stockmarket/types";

type MarketChartProps = {
  points: StockPricePoint[];
  width: number;
  height: number;
  /** Green when the series ends at or above where it opened, red otherwise. */
  up: boolean;
  /**
   * "detail" adds the dashed open-price reference line (the one gridline this
   * chart draws). "spark" is the bare curve used in list rows.
   */
  variant?: "detail" | "spark";
  emptyLabel?: string;
};

// Breathing room so the stroke and its glow never clip at the extremes.
const VERTICAL_PADDING = 10;
const LINE_WIDTH_DETAIL = 2.25;
const LINE_WIDTH_SPARK = 1.75;

/**
 * A trading-app price chart: one smooth monotone curve, a gradient area fading
 * to transparent beneath it, and a single dashed line at the opening price.
 *
 * No axis labels, no value chips, no container border, no vertical gridlines —
 * the number that matters is already rendered at 52pt above the chart, so this
 * only has to carry the shape.
 *
 * The curve interpolation is `buildMonotoneLinePath`, shared with the app's
 * rating charts: monotone cubic passes through every real point without
 * overshooting, which is what keeps the line soft instead of jagged.
 */
export default function MarketChart({
  points,
  width,
  height,
  up,
  variant = "detail",
  emptyLabel = "No price history in this range.",
}: MarketChartProps) {
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const isDetail = variant === "detail";
  const color = up ? marketColors.up : marketColors.down;

  const geometry = useMemo(() => {
    const clean = points.filter((point) => Number.isFinite(point.price));
    if (clean.length < 2) {
      return null;
    }

    const prices = clean.map((point) => point.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    // A flat series would divide by zero and also deserves to render as a
    // centered horizontal line rather than pinned to an edge.
    const span = max - min;
    const domainMin = span > 0.01 ? min : min - 1;
    const domainMax = span > 0.01 ? max : max + 1;

    const plotTop = VERTICAL_PADDING;
    const plotHeight = Math.max(1, height - VERTICAL_PADDING * 2);
    const toY = (price: number) =>
      plotTop +
      (1 - (price - domainMin) / Math.max(1e-6, domainMax - domainMin)) * plotHeight;

    const step = width / Math.max(1, clean.length - 1);
    const coords = clean.map((point, index) => ({
      x: index * step,
      y: toY(point.price),
    }));

    const linePath = buildMonotoneLinePath(coords);
    const lastX = coords[coords.length - 1]!.x;
    const firstX = coords[0]!.x;

    return {
      linePath,
      areaPath: `${linePath} L ${lastX} ${height} L ${firstX} ${height} Z`,
      openY: toY(clean[0]!.price),
      minY: Math.min(...coords.map((coord) => coord.y)),
    };
  }, [height, points, width]);

  if (!geometry) {
    return (
      <View style={[styles.empty, { width, height }]}>
        {isDetail ? <Text style={styles.emptyText}>{emptyLabel}</Text> : null}
      </View>
    );
  }

  const areaGradientId = `market-area-${instanceId}`;

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient
            id={areaGradientId}
            x1="0"
            y1={geometry.minY}
            x2="0"
            y2={height}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={color} stopOpacity={isDetail ? 0.28 : 0.22} />
            <Stop offset="0.55" stopColor={color} stopOpacity={0.06} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        <Path d={geometry.areaPath} fill={`url(#${areaGradientId})`} />

        {/* The one gridline: a hairline dashed marker at the opening price, so
            "above the line" reads as up at a glance. */}
        {isDetail ? (
          <Line
            x1={0}
            y1={geometry.openY}
            x2={width}
            y2={geometry.openY}
            stroke={marketColors.hairlineStrong}
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        ) : null}

        <Path
          d={geometry.linePath}
          fill="none"
          stroke={color}
          strokeWidth={isDetail ? LINE_WIDTH_DETAIL : LINE_WIDTH_SPARK}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: marketSpacing[24],
  },
  emptyText: {
    ...marketType.rowSecondary,
    color: marketColors.textMuted,
    textAlign: "center",
  },
});
