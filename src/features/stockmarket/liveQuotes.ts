/**
 * The LIVE half of stock pricing: the same in-game Impact Rating the
 * leaderboard, court, and player modal already show, keyed by player.
 *
 * Nothing is recomputed here — this builds the exact same `LiveGameData` the
 * rest of the app builds (`buildLiveGameDataFromPayload`) and reads
 * `player.inGameRating10` off it.
 */

import {
  buildLiveGameDataFromPayload,
  getHydratedHistoricalLiveGameData,
  type LiveGameData,
  type LiveGamePlayer,
} from "@/hooks/useLiveGame";
import {
  fetchLiveGamePayload,
  fetchLiveGames,
} from "@/src/features/basketball/api";
import type { LiveGameListItem } from "@/src/features/cbb/api";
import { getApiBaseUrl } from "@/src/config/api";
import {
  STOCK_MARKET_MODE,
  STOCK_MARKET_PRO_LEAGUE,
} from "@/src/features/stockmarket/stockUniverse";
import type {
  StockGameState,
  StockPlayerGame,
  StockPricePoint,
} from "@/src/features/stockmarket/types";
import { ratingToPrice } from "@/src/features/stockmarket/pricing";

/** Matches the app-wide live rating cadence (POLL_INTERVAL_MS in useLiveGame). */
export const LIVE_QUOTE_POLL_MS = 5000;
/** Slower sweep used when nothing on the slate is actually in progress. */
export const IDLE_QUOTE_POLL_MS = 60_000;

export type LivePlayerQuote = {
  playerId: string;
  rating: number | null;
  price: number | null;
  game: StockPlayerGame;
  history: StockPricePoint[];
};

export type LiveSlateSnapshot = {
  /** playerId -> live/final quote for the game they're in today. */
  byPlayerId: Map<string, LivePlayerQuote>;
  /**
   * teamId -> today's game, including SCHEDULED ones. Lets a pregame player be
   * shown (and traded) against the game they're about to play even though no
   * in-game rating exists for them yet.
   */
  gamesByTeamId: Map<string, StockPlayerGame>;
  games: StockPlayerGame[];
  hasLiveGame: boolean;
  fetchedAt: number;
};

export const EMPTY_LIVE_SNAPSHOT: LiveSlateSnapshot = {
  byPlayerId: new Map(),
  gamesByTeamId: new Map(),
  games: [],
  hasLiveGame: false,
  fetchedAt: 0,
};

function buildGameLabel(game: LiveGameListItem): string {
  const away = game.away.abbreviation || game.away.shortDisplayName || game.away.name;
  const home = game.home.abbreviation || game.home.shortDisplayName || game.home.name;
  return `${away} @ ${home}`;
}

function classifyListItem(game: LiveGameListItem): StockGameState {
  if (game.isLive) {
    return "in";
  }
  return game.statusText.toLowerCase().includes("final") ? "post" : "pre";
}

function normalizeState(state: string | undefined): StockGameState {
  const value = (state ?? "").toLowerCase();
  if (value === "in" || value === "live") {
    return "in";
  }
  if (value === "post") {
    return "post";
  }
  return "pre";
}

function toLiveHistory(player: LiveGamePlayer): StockPricePoint[] {
  return (player.ratingTimelinePoints ?? [])
    .map<StockPricePoint | null>((point, index) => {
      const price = ratingToPrice(point.rating);
      if (price === null) {
        return null;
      }
      return {
        index: index + 1,
        price,
        label: point.period ? `Q${point.period}` : "",
      };
    })
    .filter((point): point is StockPricePoint => point !== null);
}

/**
 * Caches used across polls so a rebuilt game reuses roster/logo/season lookups
 * instead of refetching them every 5 seconds — the same caches the cross-game
 * leaderboard in app/live-games.tsx threads through.
 */
export type LiveQuoteCaches = {
  roster: Map<string, LiveGamePlayer[]>;
  logo: Map<string, string>;
  seasonInput: Map<string, unknown>;
  seasonPower: Map<string, unknown>;
  /** Final games already resolved this session — never rebuilt. */
  finalGames: Map<string, LiveGameData>;
};

export function createLiveQuoteCaches(): LiveQuoteCaches {
  return {
    roster: new Map(),
    logo: new Map(),
    seasonInput: new Map(),
    seasonPower: new Map(),
    finalGames: new Map(),
  };
}

async function buildGameData(
  gameId: string,
  caches: LiveQuoteCaches,
): Promise<LiveGameData | null> {
  const payload = await fetchLiveGamePayload(STOCK_MARKET_MODE, gameId, STOCK_MARKET_PRO_LEAGUE);
  const built = await buildLiveGameDataFromPayload({
    // WNBA payloads come straight from ESPN (see fetchNbaLiveGamePayload), so
    // the local API server isn't required here — `apiBase` only feeds a debug
    // `summaryUrl` string on the built data.
    apiBase: getApiBaseUrl() ?? "",
    gameId,
    mode: STOCK_MARKET_MODE,
    proLeague: STOCK_MARKET_PRO_LEAGUE,
    payload,
    rosterCache: caches.roster,
    logoCache: caches.logo,
    seasonInputCache: caches.seasonInput as never,
    seasonPowerCache: caches.seasonPower as never,
  });

  return built.status === "ok" ? built.data : null;
}

function collectPlayers(
  data: LiveGameData,
  game: StockPlayerGame,
  into: Map<string, LivePlayerQuote>,
): void {
  Object.values(data.playersByTeam)
    .flat()
    .forEach((player) => {
      const rating =
        typeof player.inGameRating10 === "number" &&
        Number.isFinite(player.inGameRating10)
          ? player.inGameRating10
          : null;
      into.set(player.id, {
        playerId: player.id,
        rating,
        price: ratingToPrice(rating),
        game,
        history: toLiveHistory(player),
      });
    });
}

/**
 * One sweep of today's WNBA slate. Scheduled (pregame) games are listed but
 * never built — there are no in-game ratings yet, so those players simply
 * trade at their season-trend opening price.
 */
export async function loadLiveSlateSnapshot(
  caches: LiveQuoteCaches,
): Promise<LiveSlateSnapshot> {
  const slate = await fetchLiveGames(STOCK_MARKET_MODE, STOCK_MARKET_PRO_LEAGUE);
  const byPlayerId = new Map<string, LivePlayerQuote>();
  const gamesByTeamId = new Map<string, StockPlayerGame>();
  const games: StockPlayerGame[] = [];
  let hasLiveGame = false;

  const buildable: Array<{ item: LiveGameListItem; game: StockPlayerGame }> = [];

  slate.forEach((item) => {
    const state = classifyListItem(item);
    const game: StockPlayerGame = {
      gameId: item.gameId,
      state,
      statusText: item.statusText,
      label: buildGameLabel(item),
    };
    games.push(game);
    [item.home.id, item.away.id].forEach((teamId) => {
      if (teamId) {
        gamesByTeamId.set(teamId, game);
      }
    });
    if (state === "in") {
      hasLiveGame = true;
    }
    if (state !== "pre") {
      buildable.push({ item, game });
    }
  });

  const results = await Promise.allSettled(
    buildable.map(async ({ game }) => {
      if (game.state === "post") {
        const cached = caches.finalGames.get(game.gameId);
        if (cached) {
          return { game, data: cached };
        }
        const data = await buildGameData(game.gameId, caches);
        if (data) {
          caches.finalGames.set(game.gameId, data);
        }
        return { game, data };
      }
      return { game, data: await buildGameData(game.gameId, caches) };
    }),
  );

  results.forEach((result) => {
    if (result.status !== "fulfilled" || !result.value.data) {
      return;
    }
    const { game, data } = result.value;
    // Trust the built payload's own status over the scoreboard list item —
    // it's the same source the in-game screens read.
    const resolved: StockPlayerGame = {
      ...game,
      state: normalizeState(data.status.state),
      statusText: data.status.shortDetail || game.statusText,
    };
    data.teams.forEach((team) => gamesByTeamId.set(team.id, resolved));
    collectPlayers(data, resolved, byPlayerId);
  });

  return {
    byPlayerId,
    gamesByTeamId,
    games,
    hasLiveGame,
    fetchedAt: Date.now(),
  };
}

/**
 * Final Impact Rating for one player in one finished game — used to settle a
 * game position whose buzzer went off while the app was closed, so it can't be
 * resolved from today's slate.
 */
export async function loadFinalGameQuote(
  gameId: string,
  playerId: string,
): Promise<{ rating: number | null; price: number | null; isFinal: boolean } | null> {
  const data = await getHydratedHistoricalLiveGameData(STOCK_MARKET_MODE, gameId, STOCK_MARKET_PRO_LEAGUE);
  if (!data) {
    return null;
  }
  const player = Object.values(data.playersByTeam)
    .flat()
    .find((entry) => entry.id === playerId);
  const rating =
    typeof player?.inGameRating10 === "number" &&
    Number.isFinite(player.inGameRating10)
      ? player.inGameRating10
      : null;

  return {
    rating,
    price: ratingToPrice(rating),
    isFinal: normalizeState(data.status.state) === "post",
  };
}
