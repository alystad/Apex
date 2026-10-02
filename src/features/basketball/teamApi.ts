import type {
  TeamGame,
  TeamGamesPage,
  TeamPlayerStats,
  TeamQuickFilter,
  TeamRatingsTimeline,
  TeamRosterPlayer,
  TeamSearchResult,
  TeamStatRow,
  TeamSummary,
} from "@/src/features/cbb/teamApi";
import {
  getTeamGames as getCollegeTeamGames,
  getTeamPlayerStats as getCollegeTeamPlayerStats,
  getTeamRatingsTimeline as getCollegeTeamRatingsTimeline,
  getTeamRoster as getCollegeTeamRoster,
  getTeamStats as getCollegeTeamStats,
  getTeamSummary as getCollegeTeamSummary,
  searchTeams as searchCollegeTeams,
} from "@/src/features/cbb/teamApi";
import {
  DEFAULT_PRO_BASKETBALL_LEAGUE,
  type ProBasketballLeague,
} from "@/src/features/nba/proBasketballLeague";
import type { GameMode } from "@/src/mode/gameModeTypes";
import {
  getCollegeBaseballGames,
  getCollegeBaseballPlayerStats,
  getCollegeBaseballRatingsTimeline,
  getCollegeBaseballRoster,
  getCollegeBaseballStats,
  getCollegeBaseballSummary,
  searchCollegeBaseballTeams,
} from "@/src/features/cbaseball/teamApi";
import {
  getNbaTeamGames,
  getNbaTeamPlayerStats,
  getNbaTeamRatingsTimeline,
  getNbaTeamRoster,
  getNbaTeamStats,
  getNbaTeamSummary,
  searchNbaTeams,
} from "@/src/features/nba/teamApi";

export type {
  TeamGame,
  TeamGamesPage,
  TeamPlayerStats,
  TeamQuickFilter,
  TeamRatingsTimeline,
  TeamRosterPlayer,
  TeamSearchResult,
  TeamStatRow,
  TeamSummary,
} from "@/src/features/cbb/teamApi";

export async function getTeamSummary(
  mode: GameMode,
  teamId: string,
  season: number,
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): Promise<TeamSummary> {
  if (mode === "nba") {
    return getNbaTeamSummary(proLeague, teamId, season);
  }
  if (mode === "baseball") {
    return getCollegeBaseballSummary(teamId, season);
  }
  return getCollegeTeamSummary(teamId, season);
}

export async function getTeamGames(
  mode: GameMode,
  teamId: string,
  season: number,
  page: number,
  pageSize = 20,
  competition = "all",
  search = "",
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): Promise<TeamGamesPage> {
  if (mode === "nba") {
    return getNbaTeamGames(proLeague, teamId, season, page, pageSize, competition, search);
  }
  if (mode === "baseball") {
    return getCollegeBaseballGames(teamId, season, page, pageSize, competition, search);
  }
  return getCollegeTeamGames(teamId, season, page, pageSize, competition, search);
}

export async function getTeamRoster(
  mode: GameMode,
  teamId: string,
  season: number,
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): Promise<TeamRosterPlayer[]> {
  if (mode === "nba") {
    return getNbaTeamRoster(proLeague, teamId, season);
  }
  if (mode === "baseball") {
    return getCollegeBaseballRoster(teamId, season);
  }
  return getCollegeTeamRoster(teamId, season);
}

export async function getTeamPlayerStats(
  mode: GameMode,
  teamId: string,
  season: number,
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): Promise<TeamPlayerStats[]> {
  if (mode === "nba") {
    return getNbaTeamPlayerStats(proLeague, teamId, season);
  }
  if (mode === "baseball") {
    return getCollegeBaseballPlayerStats(teamId, season);
  }
  return getCollegeTeamPlayerStats(teamId, season);
}

export async function getTeamRatingsTimeline(
  mode: GameMode,
  teamId: string,
  season: number,
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): Promise<TeamRatingsTimeline> {
  if (mode === "nba") {
    return getNbaTeamRatingsTimeline(proLeague, teamId, season);
  }
  if (mode === "baseball") {
    return getCollegeBaseballRatingsTimeline(teamId, season);
  }
  return getCollegeTeamRatingsTimeline(teamId, season);
}

export async function getTeamStats(
  mode: GameMode,
  teamId: string,
  season: number,
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): Promise<TeamStatRow[]> {
  if (mode === "nba") {
    return getNbaTeamStats(proLeague, teamId, season);
  }
  if (mode === "baseball") {
    return getCollegeBaseballStats(teamId, season);
  }
  return getCollegeTeamStats(teamId, season);
}

export async function searchTeams(
  mode: GameMode,
  query: string,
  limit = 20,
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): Promise<TeamSearchResult[]> {
  if (mode === "nba") {
    return searchNbaTeams(proLeague, query, limit);
  }
  if (mode === "baseball") {
    return searchCollegeBaseballTeams(query, limit);
  }
  return searchCollegeTeams(query, limit);
}
