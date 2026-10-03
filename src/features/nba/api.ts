import type {
  GameComment,
  LiveGameListItem,
} from "@/src/features/cbb/api";
import { getGameComments, postGameComment } from "@/src/features/cbb/api";
import {
  getProBasketballLeagueConfig,
  type ProBasketballLeague,
} from "@/src/features/nba/proBasketballLeague";

type EspnCompetitionTeam = {
  homeAway?: "home" | "away";
  score?: string | { displayValue?: string; value?: number };
  team?: {
    id?: string;
    displayName?: string;
    shortDisplayName?: string;
    abbreviation?: string;
    logos?: Array<{ href?: string }>;
    logo?: string;
  };
};

type EspnScoreboardEvent = {
  id?: string;
  status?: {
    type?: {
      state?: string;
      shortDetail?: string;
      description?: string;
    };
    period?: number;
    displayClock?: string;
  };
  competitions?: Array<{
    venue?: { fullName?: string };
    competitors?: EspnCompetitionTeam[];
  }>;
};

type EspnScoreboardResponse = {
  events?: EspnScoreboardEvent[];
};

function buildConference(_teamId?: string): { name?: string; shortName?: string } | undefined {
  return undefined;
}

function getLogo(
  team?: EspnCompetitionTeam["team"],
): string | undefined {
  return (
    team?.logos?.[0]?.href?.trim() ||
    team?.logo?.trim() ||
    undefined
  );
}

function getScore(value: EspnCompetitionTeam["score"]): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "object" && value) {
    if (typeof value.displayValue === "string" && value.displayValue.trim().length > 0) {
      return value.displayValue.trim();
    }
    if (typeof value.value === "number" && Number.isFinite(value.value)) {
      return String(Math.round(value.value));
    }
  }
  return "-";
}

function mapCompetitor(
  competitor?: EspnCompetitionTeam,
): LiveGameListItem["home"] {
  const teamId = competitor?.team?.id?.trim() || undefined;
  return {
    id: teamId,
    name:
      competitor?.team?.displayName?.trim() ||
      competitor?.team?.shortDisplayName?.trim() ||
      "Team",
    shortDisplayName: competitor?.team?.shortDisplayName?.trim() || undefined,
    abbreviation: competitor?.team?.abbreviation?.trim() || undefined,
    score: getScore(competitor?.score),
    logo: getLogo(competitor?.team),
    conference: buildConference(teamId),
  };
}

function mapNbaEventToGameItem(event: EspnScoreboardEvent): LiveGameListItem | null {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const home = competitors.find((row) => row.homeAway === "home");
  const away = competitors.find((row) => row.homeAway === "away");
  const gameId = event.id?.trim();

  if (!competition || !home || !away || !gameId) {
    return null;
  }

  const state = event.status?.type?.state?.toLowerCase() ?? "";

  return {
    gameId,
    home: mapCompetitor(home),
    away: mapCompetitor(away),
    statusText:
      event.status?.type?.shortDetail?.trim() ||
      event.status?.type?.description?.trim() ||
      "Scheduled",
    period: event.status?.period ?? 0,
    clock: event.status?.displayClock ?? "",
    isLive: state === "in" || state === "live",
    venue: competition.venue?.fullName?.trim() || undefined,
    conference: null,
  };
}

async function fetchNbaJson<T>(
  league: ProBasketballLeague,
  url: string,
): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${getProBasketballLeagueConfig(league).label} HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function getScoreboardBase(league: ProBasketballLeague): string {
  const { espnLeaguePath } = getProBasketballLeagueConfig(league);
  return `https://site.api.espn.com/apis/site/v2/sports/${espnLeaguePath}/scoreboard`;
}

function getSummaryBase(league: ProBasketballLeague): string {
  const { espnLeaguePath } = getProBasketballLeagueConfig(league);
  return `https://site.api.espn.com/apis/site/v2/sports/${espnLeaguePath}/summary`;
}

function getScoreboardUrl(
  league: ProBasketballLeague,
  dateKey?: string,
): string {
  const base = getScoreboardBase(league);
  if (!dateKey) {
    return base;
  }
  const compactDate = dateKey.replace(/-/g, "");
  return `${base}?dates=${compactDate}`;
}

function buildCommentKey(league: ProBasketballLeague, gameId: string): string {
  return `${league}:${gameId}`;
}

export async function fetchNbaGamesForDate(
  league: ProBasketballLeague,
  dateKey: string,
): Promise<LiveGameListItem[]> {
  const payload = await fetchNbaJson<EspnScoreboardResponse>(
    league,
    getScoreboardUrl(league, dateKey),
  );

  return (payload.events ?? [])
    .map(mapNbaEventToGameItem)
    .filter((game): game is LiveGameListItem => Boolean(game));
}

export async function fetchNbaLiveGames(
  league: ProBasketballLeague,
): Promise<LiveGameListItem[]> {
  const payload = await fetchNbaJson<EspnScoreboardResponse>(
    league,
    getScoreboardBase(league),
  );
  return (payload.events ?? [])
    .map(mapNbaEventToGameItem)
    .filter((game): game is LiveGameListItem => Boolean(game));
}

export async function fetchNbaTodayGames(
  league: ProBasketballLeague,
): Promise<LiveGameListItem[]> {
  return fetchNbaLiveGames(league);
}

export async function fetchNbaLiveGamePayload(
  league: ProBasketballLeague,
  gameId: string,
): Promise<unknown> {
  return fetchNbaJson<unknown>(
    league,
    `${getSummaryBase(league)}?event=${encodeURIComponent(gameId)}`,
  );
}

export async function getNbaGameComments(
  league: ProBasketballLeague,
  gameId: string,
  limit = 100,
): Promise<GameComment[]> {
  return getGameComments(buildCommentKey(league, gameId), limit);
}

export async function postNbaGameComment(
  league: ProBasketballLeague,
  gameId: string,
  input: { authorName: string; body: string },
): Promise<GameComment> {
  return postGameComment(buildCommentKey(league, gameId), input);
}
