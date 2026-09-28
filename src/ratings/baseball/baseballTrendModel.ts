import type { BaseballImpactTrendPoint } from "@/src/ratings/baseball/types";
import { roundTo2, safeAverage } from "@/src/ratings/baseball/baseballImpactFormulas";

export const BASEBALL_RECENCY_WEIGHTS = [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6] as const;

export function averageRating(values: number[]): number {
  return roundTo2(safeAverage(values));
}

export function recentWeightedAverage(values: number[]): number {
  const recent = values.slice(-BASEBALL_RECENCY_WEIGHTS.length).reverse();
  if (recent.length === 0) {
    return 0;
  }

  let weightedTotal = 0;
  let weightTotal = 0;
  recent.forEach((rating, index) => {
    const weight = BASEBALL_RECENCY_WEIGHTS[index] ?? BASEBALL_RECENCY_WEIGHTS[BASEBALL_RECENCY_WEIGHTS.length - 1];
    weightedTotal += rating * weight;
    weightTotal += weight;
  });

  return roundTo2(weightedTotal / Math.max(1e-6, weightTotal));
}

export function computeRollingRating(gameRatings: number[]): number {
  if (gameRatings.length === 0) {
    return 0;
  }
  const seasonAverage = averageRating(gameRatings);
  const recentAverage = recentWeightedAverage(gameRatings);
  return roundTo2(0.55 * recentAverage + 0.45 * seasonAverage);
}

export function computeTrendDelta(gameRatings: number[]): number {
  if (gameRatings.length === 0) {
    return 0;
  }
  const latest = gameRatings[gameRatings.length - 1] ?? 0;
  const previous = gameRatings.length > 1 ? gameRatings[gameRatings.length - 2] ?? latest : latest;
  return roundTo2(latest - previous);
}

export function buildTrendPoints(
  entries: Array<{ gameId: string; date: string; rating: number; opponent?: string; role?: string; impactShare?: number }>,
  limit = 7,
): BaseballImpactTrendPoint[] {
  return entries.slice(-limit).map((entry) => ({
    gameId: entry.gameId,
    rating: roundTo2(entry.rating),
    date: entry.date,
    opponent: entry.opponent,
    role: entry.role as BaseballImpactTrendPoint["role"],
    impactShare: entry.impactShare,
  }));
}
