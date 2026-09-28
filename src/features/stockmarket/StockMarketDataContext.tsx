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
import { AppState } from "react-native";

import {
  createLiveQuoteCaches,
  EMPTY_LIVE_SNAPSHOT,
  IDLE_QUOTE_POLL_MS,
  LIVE_QUOTE_POLL_MS,
  loadLiveSlateSnapshot,
  type LiveQuoteCaches,
  type LiveSlateSnapshot,
} from "@/src/features/stockmarket/liveQuotes";
import {
  loadSeasonSeriesForPlayers,
  loadWnbaStockPlayers,
  type StockSeasonSeries,
} from "@/src/features/stockmarket/stockUniverse";
import type {
  StockPlayer,
  StockPlayerGame,
  StockQuote,
} from "@/src/features/stockmarket/types";

/** How often buffered season-price results are flushed into render state. */
const SERIES_FLUSH_MS = 250;

type StockMarketDataValue = {
  players: StockPlayer[];
  quotes: Map<string, StockQuote>;
  getQuote: (playerId: string) => StockQuote | null;
  getPlayer: (playerId: string) => StockPlayer | null;
  /** True while the roster universe itself is still loading. */
  loading: boolean;
  /** True while season prices are still filling in behind the list. */
  hydrating: boolean;
  hydratedCount: number;
  error: string | null;
  refresh: () => Promise<void>;
  refreshing: boolean;
  liveGames: StockPlayerGame[];
  hasLiveGame: boolean;
  lastUpdatedAt: number;
};

const StockMarketDataContext = createContext<StockMarketDataValue | null>(null);

function buildQuote(
  player: StockPlayer,
  season: StockSeasonSeries | undefined,
  live: LiveSlateSnapshot,
): StockQuote {
  const seasonRating = season?.seasonRating ?? null;
  const seasonPrice = season?.seasonPrice ?? null;
  const liveEntry = live.byPlayerId.get(player.playerId);
  const game = liveEntry?.game ?? live.gamesByTeamId.get(player.teamId) ?? null;

  // Pregame, the season-trend price IS the day's opening price (spec rule 3);
  // once the game tips, the live in-game rating takes over (rule 2).
  const openPrice = seasonPrice;
  const price = liveEntry?.price ?? openPrice;
  const changeAbs =
    price !== null && openPrice !== null ? Math.round((price - openPrice) * 100) / 100 : null;
  const changePct =
    changeAbs !== null && openPrice !== null && openPrice > 0
      ? (changeAbs / openPrice) * 100
      : null;

  return {
    playerId: player.playerId,
    seasonRating,
    seasonPrice,
    liveRating: liveEntry?.rating ?? null,
    livePrice: liveEntry?.price ?? null,
    openPrice,
    price,
    changeAbs,
    changePct,
    game,
    seasonHistory: season?.history ?? [],
    liveHistory: liveEntry?.history ?? [],
    hasSeasonPrice: seasonPrice !== null,
  };
}

export function StockMarketDataProvider({ children }: { children: ReactNode }) {
  const [players, setPlayers] = useState<StockPlayer[]>([]);
  const [seasonById, setSeasonById] = useState<Map<string, StockSeasonSeries>>(
    () => new Map(),
  );
  const [live, setLive] = useState<LiveSlateSnapshot>(EMPTY_LIVE_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [hydrating, setHydrating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cachesRef = useRef<LiveQuoteCaches>(createLiveQuoteCaches());
  const pendingSeriesRef = useRef<StockSeasonSeries[]>([]);
  const mountedRef = useRef(true);
  const universeRunRef = useRef(0);
  // Read by the polling loop's own closure so a game going live speeds the
  // cadence up without tearing down and restarting the loop.
  const hasLiveGameRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Season prices land one player at a time; buffer them and flush on a timer
  // so a 140-player league doesn't trigger 140 separate list re-renders.
  const flushPendingSeries = useCallback(() => {
    if (pendingSeriesRef.current.length === 0) {
      return;
    }
    const batch = pendingSeriesRef.current;
    pendingSeriesRef.current = [];
    setSeasonById((previous) => {
      const next = new Map(previous);
      batch.forEach((series) => next.set(series.playerId, series));
      return next;
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(flushPendingSeries, SERIES_FLUSH_MS);
    return () => {
      clearInterval(timer);
      flushPendingSeries();
    };
  }, [flushPendingSeries]);

  const loadUniverse = useCallback(async () => {
    const run = universeRunRef.current + 1;
    universeRunRef.current = run;
    const isCancelled = () => !mountedRef.current || universeRunRef.current !== run;

    try {
      const roster = await loadWnbaStockPlayers();
      if (isCancelled()) {
        return;
      }
      setPlayers(roster);
      setLoading(false);
      setError(roster.length === 0 ? "No WNBA players available right now." : null);

      if (roster.length === 0) {
        return;
      }

      setHydrating(true);
      await loadSeasonSeriesForPlayers(
        roster.map((player) => player.playerId),
        {
          isCancelled,
          onResult: (series) => {
            pendingSeriesRef.current.push(series);
          },
        },
      );
    } catch (caught) {
      if (isCancelled()) {
        return;
      }
      setError(caught instanceof Error ? caught.message : "Failed to load the market.");
      setLoading(false);
    } finally {
      if (!isCancelled()) {
        setHydrating(false);
        flushPendingSeries();
      }
    }
  }, [flushPendingSeries]);

  useEffect(() => {
    void loadUniverse();
  }, [loadUniverse]);

  // Live pricing sweep. Runs at the app's normal 5s rating cadence while a game
  // is in progress and drops to a slow slate check otherwise.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const snapshot = await loadLiveSlateSnapshot(cachesRef.current);
        if (!cancelled) {
          hasLiveGameRef.current = snapshot.hasLiveGame;
          setLive(snapshot);
        }
      } catch {
        // Keep the last good snapshot — a dropped poll shouldn't blank prices.
      } finally {
        if (!cancelled) {
          timer = setTimeout(
            () => {
              void tick();
            },
            AppState.currentState === "active" && hasLiveGameRef.current
              ? LIVE_QUOTE_POLL_MS
              : IDLE_QUOTE_POLL_MS,
          );
        }
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    // Finished games are cached for the session; drop them so a refresh can
    // pick up a late stat correction.
    cachesRef.current.finalGames.clear();
    try {
      const snapshot = await loadLiveSlateSnapshot(cachesRef.current);
      if (mountedRef.current) {
        setLive(snapshot);
      }
      await loadUniverse();
    } finally {
      if (mountedRef.current) {
        setRefreshing(false);
      }
    }
  }, [loadUniverse]);

  const quotes = useMemo(() => {
    const map = new Map<string, StockQuote>();
    players.forEach((player) => {
      map.set(player.playerId, buildQuote(player, seasonById.get(player.playerId), live));
    });
    return map;
  }, [live, players, seasonById]);

  const playersById = useMemo(() => {
    const map = new Map<string, StockPlayer>();
    players.forEach((player) => map.set(player.playerId, player));
    return map;
  }, [players]);

  const value = useMemo<StockMarketDataValue>(
    () => ({
      players,
      quotes,
      getQuote: (playerId) => quotes.get(playerId) ?? null,
      getPlayer: (playerId) => playersById.get(playerId) ?? null,
      loading,
      hydrating,
      hydratedCount: seasonById.size,
      error,
      refresh,
      refreshing,
      liveGames: live.games,
      hasLiveGame: live.hasLiveGame,
      lastUpdatedAt: live.fetchedAt,
    }),
    [
      error,
      hydrating,
      live.fetchedAt,
      live.games,
      live.hasLiveGame,
      loading,
      players,
      playersById,
      quotes,
      refresh,
      refreshing,
      seasonById.size,
    ],
  );

  return (
    <StockMarketDataContext.Provider value={value}>
      {children}
    </StockMarketDataContext.Provider>
  );
}

export function useStockMarketData(): StockMarketDataValue {
  const context = useContext(StockMarketDataContext);
  if (!context) {
    throw new Error("useStockMarketData must be used inside StockMarketDataProvider");
  }
  return context;
}
