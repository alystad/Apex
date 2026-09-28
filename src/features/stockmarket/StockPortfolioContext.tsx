import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { loadFinalGameQuote } from "@/src/features/stockmarket/liveQuotes";
import {
  applyBuy,
  applySell,
  buildHoldingId,
  createInitialPortfolio,
  valuePortfolio,
  type TradeOrder,
} from "@/src/features/stockmarket/portfolioMath";
import {
  loadStockPortfolio,
  saveStockPortfolio,
} from "@/src/features/stockmarket/portfolioStorage";
import { useStockMarketData } from "@/src/features/stockmarket/StockMarketDataContext";
import type {
  StockHolding,
  StockPortfolioState,
  StockPortfolioValuation,
} from "@/src/features/stockmarket/types";

export type TradeOutcome = { ok: true } | { ok: false; reason: string };

type StockPortfolioValue = {
  state: StockPortfolioState;
  isHydrated: boolean;
  valuation: StockPortfolioValuation;
  /** Current price a given holding is marked at (live for game, trend for season). */
  priceForHolding: (holding: StockHolding) => number | null;
  buy: (order: TradeOrder) => TradeOutcome;
  sell: (order: TradeOrder & { autoClosed?: boolean }) => TradeOutcome;
  dismissDisclaimer: () => void;
  resetPortfolio: () => void;
};

const StockPortfolioContext = createContext<StockPortfolioValue | null>(null);

export function StockPortfolioProvider({ children }: { children: ReactNode }) {
  const { quotes, getPlayer } = useStockMarketData();
  const [state, setState] = useState<StockPortfolioState>(() => createInitialPortfolio());
  const [isHydrated, setIsHydrated] = useState(false);
  const lastSavedRef = useRef<string | null>(null);
  const settlingRef = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    void loadStockPortfolio().then((loaded) => {
      if (!active) {
        return;
      }
      // No stored portfolio means this is the user's first visit — that's when
      // the starting virtual balance is granted.
      const next = loaded ?? createInitialPortfolio();
      setState(next);
      lastSavedRef.current = JSON.stringify(next);
      setIsHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    const serialized = JSON.stringify(state);
    if (serialized === lastSavedRef.current) {
      return;
    }
    lastSavedRef.current = serialized;
    void saveStockPortfolio(state);
  }, [isHydrated, state]);

  /**
   * A game position is marked at the player's LIVE in-game price; a season
   * position is marked at the rolling season-average price. Falls back to the
   * other stream only when the primary one hasn't resolved yet.
   */
  const priceForHolding = useCallback(
    (holding: StockHolding): number | null => {
      const quote = quotes.get(holding.playerId);
      if (!quote) {
        return null;
      }
      if (holding.kind === "season") {
        return quote.seasonPrice;
      }
      // Only mark against the live stream when it belongs to THIS position's
      // game — otherwise a stale price from a different night would leak in.
      if (quote.game?.gameId === holding.gameId && quote.livePrice !== null) {
        return quote.livePrice;
      }
      if (quote.game?.gameId === holding.gameId) {
        return quote.openPrice;
      }
      return null;
    },
    [quotes],
  );

  const buy = useCallback((order: TradeOrder): TradeOutcome => {
    let outcome: TradeOutcome = { ok: false, reason: "Order failed." };
    setState((previous) => {
      const result = applyBuy(previous, order);
      if (!result.ok) {
        outcome = { ok: false, reason: result.reason };
        return previous;
      }
      outcome = { ok: true };
      return result.state;
    });
    return outcome;
  }, []);

  const sell = useCallback((order: TradeOrder & { autoClosed?: boolean }): TradeOutcome => {
    let outcome: TradeOutcome = { ok: false, reason: "Order failed." };
    setState((previous) => {
      const result = applySell(previous, order);
      if (!result.ok) {
        outcome = { ok: false, reason: result.reason };
        return previous;
      }
      outcome = { ok: true };
      return result.state;
    });
    return outcome;
  }, []);

  /**
   * Force-close at the final buzzer (spec rule 5). Two paths:
   *  - the game is on today's slate and has flipped to "post": settle from the
   *    live snapshot we already hold;
   *  - the buzzer went off while the app was closed: fetch that game's final
   *    ratings once and settle from those.
   */
  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    const openGamePositions = state.holdings.filter(
      (holding) => holding.kind === "game" && holding.gameId,
    );
    if (openGamePositions.length === 0) {
      return;
    }

    let cancelled = false;

    const closePosition = (holding: StockHolding, price: number) => {
      const player = getPlayer(holding.playerId);
      sell({
        kind: "game",
        playerId: holding.playerId,
        playerName: holding.playerName,
        playerHeadshot: holding.playerHeadshot,
        teamAbbreviation: holding.teamAbbreviation,
        gameId: holding.gameId,
        gameLabel: holding.gameLabel ?? player?.teamName,
        shares: holding.shares,
        price,
        autoClosed: true,
      });
    };

    openGamePositions.forEach((holding) => {
      const quote = quotes.get(holding.playerId);
      const isSameGame = quote?.game?.gameId === holding.gameId;

      if (isSameGame && quote?.game?.state === "post") {
        const finalPrice = quote.livePrice ?? quote.openPrice;
        if (finalPrice !== null) {
          closePosition(holding, finalPrice);
        }
        return;
      }

      if (isSameGame) {
        // Game is still scheduled or in progress — nothing to settle.
        return;
      }

      // Not on today's slate: resolve the final rating for that past game once.
      const settleKey = buildHoldingId("game", holding.playerId, holding.gameId);
      if (settlingRef.current.has(settleKey)) {
        return;
      }
      settlingRef.current.add(settleKey);
      void loadFinalGameQuote(holding.gameId!, holding.playerId)
        .then((result) => {
          if (cancelled || !result?.isFinal) {
            return;
          }
          // A player who never checked in has no final rating; close at cost so
          // the position doesn't linger open forever.
          closePosition(holding, result.price ?? holding.averageBuyPrice);
        })
        .finally(() => {
          settlingRef.current.delete(settleKey);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [getPlayer, isHydrated, quotes, sell, state.holdings]);

  const dismissDisclaimer = useCallback(() => {
    setState((previous) =>
      previous.hasSeenDisclaimer ? previous : { ...previous, hasSeenDisclaimer: true },
    );
  }, []);

  const resetPortfolio = useCallback(() => {
    setState(createInitialPortfolio());
  }, []);

  const valuation = useMemo(
    () => valuePortfolio(state, priceForHolding),
    [priceForHolding, state],
  );

  const value = useMemo<StockPortfolioValue>(
    () => ({
      state,
      isHydrated,
      valuation,
      priceForHolding,
      buy,
      sell,
      dismissDisclaimer,
      resetPortfolio,
    }),
    [
      buy,
      dismissDisclaimer,
      isHydrated,
      priceForHolding,
      resetPortfolio,
      sell,
      state,
      valuation,
    ],
  );

  return (
    <StockPortfolioContext.Provider value={value}>
      {children}
    </StockPortfolioContext.Provider>
  );
}

export function useStockPortfolio(): StockPortfolioValue {
  const context = useContext(StockPortfolioContext);
  if (!context) {
    throw new Error("useStockPortfolio must be used inside StockPortfolioProvider");
  }
  return context;
}
