/**
 * Time-range selection behind the chart's 1D / 1W / 1M / Season / All control.
 *
 * Two underlying series feed this (see StockMarketDataContext):
 *  - `seasonHistory` — one point per game, the rolling season-average price.
 *  - `liveHistory`   — the intraday price path for a game happening right now.
 */

import type { StockPricePoint, StockQuote } from "@/src/features/stockmarket/types";

export type MarketRange = "1D" | "1W" | "1M" | "SEASON" | "ALL";

export const MARKET_RANGES: Array<{ key: MarketRange; label: string }> = [
  { key: "1D", label: "1D" },
  { key: "1W", label: "1W" },
  { key: "1M", label: "1M" },
  { key: "SEASON", label: "Season" },
  { key: "ALL", label: "All" },
];

const DAY_MS = 86_400_000;

/** Caption under the change figure, so "+4.2%" is never ambiguous about "since when". */
export function rangeChangeLabel(range: MarketRange): string {
  switch (range) {
    case "1D":
      return "Today";
    case "1W":
      return "Past week";
    case "1M":
      return "Past month";
    case "SEASON":
      return "This season";
    default:
      return "All time";
  }
}

/** x-positions are index-based, so any filtered slice has to be renumbered. */
function reindex(points: StockPricePoint[]): StockPricePoint[] {
  return points.map((point, index) => ({ ...point, index: index + 1 }));
}

function withinDays(points: StockPricePoint[], days: number, now: number): StockPricePoint[] {
  const cutoff = now - days * DAY_MS;
  return points.filter((point) => {
    if (!point.date) {
      return true;
    }
    const time = new Date(point.date).getTime();
    return Number.isFinite(time) ? time >= cutoff : true;
  });
}

export type RangeSeries = {
  points: StockPricePoint[];
  /** First -> last change across the visible series. */
  changeAbs: number | null;
  changePct: number | null;
  /** True when there isn't enough data in this range to draw a line. */
  isEmpty: boolean;
  emptyReason: string | null;
};

export function selectRangeSeries(
  quote: StockQuote,
  range: MarketRange,
  now = Date.now(),
): RangeSeries {
  const season = quote.seasonHistory;
  let points: StockPricePoint[];
  let emptyReason: string | null = null;

  if (range === "1D") {
    // Intraday only exists while (or just after) a game is being played.
    points = quote.liveHistory;
    emptyReason =
      quote.game && quote.game.state !== "pre"
        ? "Waiting for the first rated possession."
        : "No live game today — switch ranges to see the season price.";
  } else if (range === "1W") {
    points = reindex(withinDays(season, 7, now));
    emptyReason = "No games in the past week.";
  } else if (range === "1M") {
    points = reindex(withinDays(season, 30, now));
    emptyReason = "No games in the past month.";
  } else if (range === "SEASON") {
    points = season;
    emptyReason = "No rated games this season yet.";
  } else {
    // ALL: the full season line, plus today's current mark as a trailing point
    // so the complete record includes live movement without letting a single
    // game's intraday path dominate the shape.
    const trailing =
      quote.livePrice !== null && quote.game
        ? [
            {
              index: season.length + 1,
              price: quote.livePrice,
              label: "Now",
            } satisfies StockPricePoint,
          ]
        : [];
    points = [...season, ...trailing];
    emptyReason = "No price history yet.";
  }

  if (points.length < 2) {
    return { points, changeAbs: null, changePct: null, isEmpty: true, emptyReason };
  }

  const first = points[0]!.price;
  const last = points[points.length - 1]!.price;
  const changeAbs = Math.round((last - first) * 100) / 100;

  return {
    points,
    changeAbs,
    changePct: first > 0 ? (changeAbs / first) * 100 : null,
    isEmpty: false,
    emptyReason: null,
  };
}

/**
 * The range a player's detail view should open on: today's intraday line when
 * there's a live game to watch, otherwise the season line.
 */
export function defaultRangeFor(quote: StockQuote): MarketRange {
  return quote.liveHistory.length >= 2 ? "1D" : "SEASON";
}

/** Compact series for list-row sparklines. */
export function sparklineSeries(quote: StockQuote): StockPricePoint[] {
  if (quote.liveHistory.length >= 2) {
    return quote.liveHistory;
  }
  return quote.seasonHistory.slice(-20);
}
