/**
 * Stock Market leaderboard.
 *
 * This app has no user accounts or shared backend (see apps/api — there is no
 * user/portfolio service), so a live cross-device ranking isn't available.
 * The board therefore ranks the real local portfolio against a fixed field of
 * SIMULATED practice traders, whose values move deterministically from the day
 * index so the standings are stable within a day and shift between days. The
 * UI labels the field as simulated — nothing here implies real opponents, and
 * every value is virtual currency.
 *
 * Swapping in a real ranking later means replacing `buildLeaderboard`'s rival
 * source with a fetch; the entry shape and the UI stay as they are.
 */

import { computeGainPct, roundMoney, STARTING_CASH } from "@/src/features/stockmarket/pricing";
import type { StockLeaderboardEntry } from "@/src/features/stockmarket/types";

type SimulatedTrader = {
  id: string;
  name: string;
  /** Baseline return vs. the starting balance, as a fraction. */
  baseReturn: number;
  /** How much the daily drift swings this trader's value. */
  volatility: number;
};

const SIMULATED_TRADERS: SimulatedTrader[] = [
  { id: "sim-1", name: "CourtVision", baseReturn: 0.412, volatility: 0.09 },
  { id: "sim-2", name: "DoubleDoubleDown", baseReturn: 0.286, volatility: 0.12 },
  { id: "sim-3", name: "PaintProtector", baseReturn: 0.203, volatility: 0.07 },
  { id: "sim-4", name: "FastBreakFund", baseReturn: 0.147, volatility: 0.15 },
  { id: "sim-5", name: "GlassCleaner", baseReturn: 0.091, volatility: 0.06 },
  { id: "sim-6", name: "PickAndRoll", baseReturn: 0.038, volatility: 0.1 },
  { id: "sim-7", name: "BuzzerBeater", baseReturn: -0.024, volatility: 0.13 },
  { id: "sim-8", name: "BenchMob", baseReturn: -0.066, volatility: 0.05 },
  { id: "sim-9", name: "ColdStreak", baseReturn: -0.128, volatility: 0.08 },
];

/** Days since epoch — the seed that keeps a day's standings stable. */
function dayIndex(now: Date): number {
  return Math.floor(now.getTime() / 86_400_000);
}

/** Deterministic, seeded [-1, 1] drift. No Math.random, so no reshuffling. */
function seededDrift(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

export function buildLeaderboard(
  userTotalValue: number,
  userDisplayName: string,
  now = new Date(),
): StockLeaderboardEntry[] {
  const seedDay = dayIndex(now);

  const rivals = SIMULATED_TRADERS.map<StockLeaderboardEntry>((trader, index) => {
    const drift = seededDrift(seedDay + index * 17) * trader.volatility;
    const totalValue = roundMoney(
      Math.max(0, STARTING_CASH * (1 + trader.baseReturn + drift)),
    );
    const netGain = roundMoney(totalValue - STARTING_CASH);
    return {
      id: trader.id,
      name: trader.name,
      totalValue,
      netGain,
      netGainPct: computeGainPct(STARTING_CASH, netGain),
      isCurrentUser: false,
    };
  });

  const userNetGain = roundMoney(userTotalValue - STARTING_CASH);
  const user: StockLeaderboardEntry = {
    id: "you",
    name: userDisplayName.trim() || "You",
    totalValue: roundMoney(userTotalValue),
    netGain: userNetGain,
    netGainPct: computeGainPct(STARTING_CASH, userNetGain),
    isCurrentUser: true,
  };

  return [...rivals, user].sort((left, right) => right.totalValue - left.totalValue);
}
