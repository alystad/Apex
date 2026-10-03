import {
  getTeamGames,
  type TeamGame,
} from "@/src/features/basketball/teamApi";
import {
  DEFAULT_PRO_BASKETBALL_LEAGUE,
  type ProBasketballLeague,
} from "@/src/features/nba/proBasketballLeague";
import type { GameMode } from "@/src/mode/gameModeTypes";

const TEAM_GAMES_PAGE_SIZE = 50;
const TEAM_GAMES_MAX_PAGES = 8;

function parseGameDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isCompletedGame(game: TeamGame): boolean {
  if (game.completed) return true;
  if (game.result === "W" || game.result === "L") return true;
  if (
    typeof game.teamScore === "number" &&
    Number.isFinite(game.teamScore) &&
    typeof game.opponentScore === "number" &&
    Number.isFinite(game.opponentScore)
  ) {
    return true;
  }
  const status = (game.status ?? "").toLowerCase();
  return status.includes("final") || status.includes("post");
}

export function isPostponedGame(game: TeamGame): boolean {
  const status = (game.status ?? "").toLowerCase();
  return (
    status.includes("postponed") ||
    status.includes("ppd") ||
    status.includes("canceled") ||
    status.includes("cancelled")
  );
}

export async function getAllTeamSeasonGames(
  mode: GameMode,
  teamId: string,
  season: number,
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): Promise<TeamGame[]> {
  const rows: TeamGame[] = [];
  let page = 0;

  while (page <= TEAM_GAMES_MAX_PAGES) {
    const data = await getTeamGames(
      mode,
      teamId,
      season,
      page,
      TEAM_GAMES_PAGE_SIZE,
      "all",
      "",
      proLeague,
    );
    rows.push(...(data.rows ?? []));
    if (!data.hasMore || (data.rows ?? []).length === 0) {
      break;
    }
    page += 1;
  }

  const seen = new Set<string>();
  return rows.filter((game) => {
    if (!game?.gameId || seen.has(game.gameId)) return false;
    seen.add(game.gameId);
    return true;
  });
}

export function deriveHomeAway(
  game: TeamGame,
  _teamId?: string,
): {
  label: "Home" | "Away" | "Neutral";
  matchupPrefix: "vs" | "@";
  shortLabel: "H" | "A" | "N";
} {
  if (game.location === "A") {
    return { label: "Away", matchupPrefix: "@", shortLabel: "A" };
  }
  if (game.location === "N") {
    return { label: "Neutral", matchupPrefix: "vs", shortLabel: "N" };
  }
  return { label: "Home", matchupPrefix: "vs", shortLabel: "H" };
}

export function formatGameDate(game: TeamGame): string {
  const date = parseGameDate(game.date);
  if (!date) {
    return "Date TBD";
  }
  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatGameTime(game: TeamGame): string {
  if (isPostponedGame(game)) {
    return game.status || "Postponed";
  }
  const date = parseGameDate(game.date);
  if (!date) {
    return game.status || "Time TBD";
  }
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function compareUpcomingGames(a: TeamGame, b: TeamGame): number {
  const aDate = parseGameDate(a.date);
  const bDate = parseGameDate(b.date);

  if (aDate && bDate) {
    return aDate.getTime() - bDate.getTime();
  }
  if (aDate && !bDate) return -1;
  if (!aDate && bDate) return 1;
  return a.opponent.localeCompare(b.opponent);
}

function comparePastGames(a: TeamGame, b: TeamGame): number {
  const aDate = parseGameDate(a.date);
  const bDate = parseGameDate(b.date);

  if (aDate && bDate) {
    return bDate.getTime() - aDate.getTime();
  }
  if (aDate && !bDate) return -1;
  if (!aDate && bDate) return 1;
  return a.opponent.localeCompare(b.opponent);
}

export function getUpcomingGames(
  schedule: TeamGame[],
  now = new Date(),
): TeamGame[] {
  const nowTime = now.getTime();
  return [...schedule]
    .filter((game) => {
      if (isCompletedGame(game)) {
        return false;
      }
      const date = parseGameDate(game.date);
      if (!date) {
        return true;
      }
      return date.getTime() > nowTime || isPostponedGame(game);
    })
    .sort(compareUpcomingGames);
}

export function getPastGames(schedule: TeamGame[]): TeamGame[] {
  return [...schedule].filter(isCompletedGame).sort(comparePastGames);
}
