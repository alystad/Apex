/**
 * Pure portfolio mechanics. Buy X shares, sell X shares — no shorting, no
 * options, no leverage, no margin. Every number is VIRTUAL currency.
 */

import {
  computeGainPct,
  roundMoney,
  roundShares,
  STARTING_CASH,
} from "@/src/features/stockmarket/pricing";
import type {
  StockHolding,
  StockHoldingKind,
  StockPortfolioState,
  StockPortfolioValuation,
  StockPosition,
  StockTransaction,
} from "@/src/features/stockmarket/types";

export function createInitialPortfolio(now = new Date()): StockPortfolioState {
  return {
    cash: STARTING_CASH,
    holdings: [],
    transactions: [],
    initializedAt: now.toISOString(),
    hasSeenDisclaimer: false,
  };
}

export function buildHoldingId(
  kind: StockHoldingKind,
  playerId: string,
  gameId?: string,
): string {
  return kind === "game" ? `game:${playerId}:${gameId ?? "unknown"}` : `season:${playerId}`;
}

function makeTransactionId(): string {
  return `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export type TradeOrder = {
  kind: StockHoldingKind;
  playerId: string;
  playerName: string;
  playerHeadshot: string;
  teamAbbreviation: string;
  gameId?: string;
  gameLabel?: string;
  shares: number;
  price: number;
};

export type TradeResult =
  | { ok: true; state: StockPortfolioState; transaction: StockTransaction }
  | { ok: false; reason: string };

export function findHolding(
  state: StockPortfolioState,
  kind: StockHoldingKind,
  playerId: string,
  gameId?: string,
): StockHolding | null {
  const id = buildHoldingId(kind, playerId, gameId);
  return state.holdings.find((holding) => holding.id === id) ?? null;
}

export function applyBuy(
  state: StockPortfolioState,
  order: TradeOrder,
  now = new Date(),
): TradeResult {
  const shares = roundShares(order.shares);
  if (!Number.isFinite(shares) || shares <= 0) {
    return { ok: false, reason: "Enter a share quantity greater than 0." };
  }
  if (!Number.isFinite(order.price) || order.price <= 0) {
    return { ok: false, reason: "This player has no price yet." };
  }

  const cost = roundMoney(shares * order.price);
  if (cost > state.cash) {
    return { ok: false, reason: "Not enough virtual cash for this order." };
  }

  const id = buildHoldingId(order.kind, order.playerId, order.gameId);
  const existing = state.holdings.find((holding) => holding.id === id) ?? null;
  const timestamp = now.toISOString();

  const nextHolding: StockHolding = existing
    ? {
        ...existing,
        shares: roundShares(existing.shares + shares),
        // Weighted average cost — the only cost-basis rule in the feature.
        averageBuyPrice: roundMoney(
          (existing.shares * existing.averageBuyPrice + shares * order.price) /
            (existing.shares + shares),
        ),
        updatedAt: timestamp,
      }
    : {
        id,
        kind: order.kind,
        playerId: order.playerId,
        playerName: order.playerName,
        playerHeadshot: order.playerHeadshot,
        teamAbbreviation: order.teamAbbreviation,
        gameId: order.gameId,
        gameLabel: order.gameLabel,
        shares,
        averageBuyPrice: roundMoney(order.price),
        openedAt: timestamp,
        updatedAt: timestamp,
      };

  const transaction: StockTransaction = {
    id: makeTransactionId(),
    type: "buy",
    kind: order.kind,
    playerId: order.playerId,
    playerName: order.playerName,
    teamAbbreviation: order.teamAbbreviation,
    gameId: order.gameId,
    gameLabel: order.gameLabel,
    shares,
    price: roundMoney(order.price),
    amount: cost,
    realizedGain: null,
    realizedGainPct: null,
    createdAt: timestamp,
  };

  return {
    ok: true,
    transaction,
    state: {
      ...state,
      cash: roundMoney(state.cash - cost),
      holdings: existing
        ? state.holdings.map((holding) => (holding.id === id ? nextHolding : holding))
        : [...state.holdings, nextHolding],
      transactions: [transaction, ...state.transactions],
    },
  };
}

export function applySell(
  state: StockPortfolioState,
  order: TradeOrder & { autoClosed?: boolean },
  now = new Date(),
): TradeResult {
  const id = buildHoldingId(order.kind, order.playerId, order.gameId);
  const existing = state.holdings.find((holding) => holding.id === id) ?? null;
  if (!existing) {
    return { ok: false, reason: "You don't hold this position." };
  }

  const shares = roundShares(Math.min(order.shares, existing.shares));
  if (!Number.isFinite(shares) || shares <= 0) {
    return { ok: false, reason: "Enter a share quantity greater than 0." };
  }
  if (!Number.isFinite(order.price) || order.price <= 0) {
    return { ok: false, reason: "This player has no price yet." };
  }

  const proceeds = roundMoney(shares * order.price);
  const costBasis = roundMoney(shares * existing.averageBuyPrice);
  const realizedGain = roundMoney(proceeds - costBasis);
  const timestamp = now.toISOString();
  const remainingShares = roundShares(existing.shares - shares);

  const transaction: StockTransaction = {
    id: makeTransactionId(),
    type: "sell",
    kind: order.kind,
    playerId: order.playerId,
    playerName: order.playerName,
    teamAbbreviation: order.teamAbbreviation,
    gameId: order.gameId,
    gameLabel: order.gameLabel,
    shares,
    price: roundMoney(order.price),
    amount: proceeds,
    realizedGain,
    realizedGainPct: computeGainPct(costBasis, realizedGain),
    autoClosed: order.autoClosed,
    createdAt: timestamp,
  };

  return {
    ok: true,
    transaction,
    state: {
      ...state,
      cash: roundMoney(state.cash + proceeds),
      holdings:
        remainingShares > 0
          ? state.holdings.map((holding) =>
              holding.id === id
                ? { ...holding, shares: remainingShares, updatedAt: timestamp }
                : holding,
            )
          : state.holdings.filter((holding) => holding.id !== id),
      transactions: [transaction, ...state.transactions],
    },
  };
}

export function valuePosition(
  holding: StockHolding,
  currentPrice: number | null,
): StockPosition {
  const costBasis = roundMoney(holding.shares * holding.averageBuyPrice);
  // With no live price yet, a position is worth what was paid for it — never
  // zero, which would read as a total loss rather than "still loading".
  const effectivePrice = currentPrice ?? holding.averageBuyPrice;
  const marketValue = roundMoney(holding.shares * effectivePrice);
  const unrealizedGain = roundMoney(marketValue - costBasis);

  return {
    holding,
    currentPrice,
    marketValue,
    costBasis,
    unrealizedGain,
    unrealizedGainPct: computeGainPct(costBasis, unrealizedGain),
  };
}

export function valuePortfolio(
  state: StockPortfolioState,
  priceFor: (holding: StockHolding) => number | null,
): StockPortfolioValuation {
  const positions = state.holdings.map((holding) =>
    valuePosition(holding, priceFor(holding)),
  );
  const holdingsValue = roundMoney(
    positions.reduce((sum, position) => sum + position.marketValue, 0),
  );
  const totalUnrealizedGain = roundMoney(
    positions.reduce((sum, position) => sum + position.unrealizedGain, 0),
  );
  const totalRealizedGain = roundMoney(
    state.transactions.reduce((sum, entry) => sum + (entry.realizedGain ?? 0), 0),
  );

  return {
    cash: state.cash,
    holdingsValue,
    totalValue: roundMoney(state.cash + holdingsValue),
    positions,
    totalUnrealizedGain,
    totalRealizedGain,
  };
}

/** Max whole-and-decimal shares the current cash balance can buy at `price`. */
export function maxAffordableShares(cash: number, price: number): number {
  if (!Number.isFinite(price) || price <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor((cash / price) * 100) / 100);
}
