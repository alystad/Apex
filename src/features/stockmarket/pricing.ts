/**
 * The ONE place a rating becomes a price.
 *
 * The app already has a single Impact Rating (0-10) definition — live in-game
 * ratings come from `hooks/useLiveGame` and season/trend ratings come from
 * `getPlayerSeasonRatingSeries` in `src/features/basketball/playerApi.ts`,
 * both computed by `apps/mobile/src/ratings/impactRating`. This module only
 * RESCALES that number; it never recomputes it.
 *
 * Scale: $10 per rating point. A 9.2 rating reads as $92, a 4.5 reads as $45 —
 * a clean 1:1 mental mapping between the badge everyone already recognizes and
 * the ticker price.
 *
 * VIRTUAL CURRENCY ONLY. No real money is involved anywhere in this feature.
 */

/** Every user starts with this much virtual cash on first entry. */
export const STARTING_CASH = 10_000;

export const PRICE_PER_RATING_POINT = 10;

/** Floor so a 0.0 rating never produces a free (or negative) share. */
export const MIN_PRICE = 1;

export const MAX_SHARES_PER_ORDER = 10_000;

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundShares(value: number): number {
  // Simple decimal shares only — no fractional-share machinery beyond 2dp.
  return Math.round(value * 100) / 100;
}

export function ratingToPrice(rating: number | null | undefined): number | null {
  if (typeof rating !== "number" || !Number.isFinite(rating)) {
    return null;
  }
  const clamped = Math.max(0, Math.min(10, rating));
  return roundMoney(Math.max(MIN_PRICE, clamped * PRICE_PER_RATING_POINT));
}

export function formatMoney(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  const negative = value < 0;
  const formatted = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? "-" : ""}$${formatted}`;
}

export function formatSignedMoney(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const formatted = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${formatted}`;
}

export function formatSignedPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

export function formatShares(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function computeGainPct(costBasis: number, gain: number): number {
  if (costBasis <= 0) {
    return 0;
  }
  return (gain / costBasis) * 100;
}
