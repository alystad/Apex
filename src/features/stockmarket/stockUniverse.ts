/**
 * The tradeable universe: every WNBA player, plus their season Impact Rating
 * trend.
 *
 * WNBA ONLY — stock-market data is explicitly pinned to
 * `STOCK_MARKET_PRO_LEAGUE` and does not follow the pro schedule toggle.
 * Nothing here is generalized to other leagues on purpose.
 */

import {
  getPlayerSeasonRatingSeries,
  type PlayerSeasonRatingSeries,
} from "@/src/features/basketball/playerApi";
import { getNbaTeamDirectory, getNbaTeamRoster } from "@/src/features/nba/teamApi";
import type { ProBasketballLeague } from "@/src/features/nba/proBasketballLeague";
import type { GameMode } from "@/src/mode/gameModeTypes";
import type { StockPlayer, StockPricePoint } from "@/src/features/stockmarket/types";
import { ratingToPrice } from "@/src/features/stockmarket/pricing";

export const STOCK_MARKET_MODE: GameMode = "nba";
export const STOCK_MARKET_PRO_LEAGUE: ProBasketballLeague = "wnba";

const SEASON = new Date().getFullYear();

/** How many season-rating requests are in flight at once while hydrating. */
const SERIES_CONCURRENCY = 8;

function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }
  const normalized = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : null;
}

function toShortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) {
    return name;
  }
  return `${parts[0]![0]}. ${parts.slice(1).join(" ")}`;
}

/**
 * Every player on every WNBA roster. Rosters are cached for 30 minutes by
 * `getNbaTeamRoster`, so re-entering the section is cheap.
 */
export async function loadWnbaStockPlayers(): Promise<StockPlayer[]> {
  const teams = await getNbaTeamDirectory(STOCK_MARKET_PRO_LEAGUE);

  const rosters = await Promise.allSettled(
    teams.map(async (team) => {
      const roster = await getNbaTeamRoster(STOCK_MARKET_PRO_LEAGUE, team.teamId, SEASON);
      return roster.map<StockPlayer>((player) => ({
        playerId: player.playerId,
        name: player.name,
        shortName: player.shortName || toShortName(player.name),
        headshot: player.headshot,
        jersey: player.jersey,
        position: player.position,
        teamId: team.teamId,
        teamName: team.shortName || team.name,
        teamAbbreviation: team.abbreviation || team.shortName,
        teamLogo: team.logo ?? "",
        teamColor: normalizeHexColor(team.color),
        teamAlternateColor: normalizeHexColor(team.alternateColor),
      }));
    }),
  );

  const players = rosters.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  // Guard against a player appearing on two rosters mid-trade.
  const deduped = new Map<string, StockPlayer>();
  players.forEach((player) => {
    if (player.playerId && !deduped.has(player.playerId)) {
      deduped.set(player.playerId, player);
    }
  });

  return [...deduped.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

/**
 * Season price history: the player's ROLLING season-average Impact Rating
 * after each game, rescaled to a price. This is the series a season holding
 * trades against — it steps once per game rather than moving in-game.
 */
export function toSeasonPriceHistory(
  series: PlayerSeasonRatingSeries,
): StockPricePoint[] {
  return series.games
    .map<StockPricePoint | null>((game, index) => {
      const price = ratingToPrice(game.rollingAverage);
      if (price === null) {
        return null;
      }
      return {
        index: index + 1,
        price,
        label: `${game.location === "A" ? "@" : "vs"} ${game.opponentAbbreviation}`,
        date: game.date,
      };
    })
    .filter((point): point is StockPricePoint => point !== null);
}

export type StockSeasonSeries = {
  playerId: string;
  seasonRating: number | null;
  seasonPrice: number | null;
  history: StockPricePoint[];
  gamesPlayed: number;
};

export async function loadPlayerSeasonSeries(
  playerId: string,
): Promise<StockSeasonSeries> {
  const series = await getPlayerSeasonRatingSeries(STOCK_MARKET_MODE, playerId, STOCK_MARKET_PRO_LEAGUE);
  const seasonRating = series.currentTrendRating ?? series.seasonAverage;
  return {
    playerId,
    seasonRating,
    seasonPrice: ratingToPrice(seasonRating),
    history: toSeasonPriceHistory(series),
    gamesPlayed: series.games.length,
  };
}

/**
 * Hydrate season pricing for a batch of players, reporting each result as it
 * lands so the market list can fill in progressively instead of blocking on
 * every roster at once.
 */
export async function loadSeasonSeriesForPlayers(
  playerIds: string[],
  options: {
    onResult: (series: StockSeasonSeries) => void;
    isCancelled?: () => boolean;
    concurrency?: number;
  },
): Promise<void> {
  const queue = [...playerIds];
  const concurrency = Math.max(1, options.concurrency ?? SERIES_CONCURRENCY);

  const worker = async () => {
    while (queue.length > 0) {
      if (options.isCancelled?.()) {
        return;
      }
      const playerId = queue.shift();
      if (!playerId) {
        return;
      }
      try {
        const series = await loadPlayerSeasonSeries(playerId);
        if (!options.isCancelled?.()) {
          options.onResult(series);
        }
      } catch {
        // A player with no gamelog (injured/inactive all season) simply has no
        // price yet — the row stays unpriced rather than failing the screen.
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()),
  );
}
