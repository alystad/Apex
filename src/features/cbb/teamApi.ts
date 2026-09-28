import { apiFetch, getApiUrl } from '@/src/config/api';
import { getCachedJson, setCachedJson } from '@/utils/cache';
import type {
  BaseballPlayerCardData,
} from "@/src/features/baseball/baseballTypes";
import type { BaseballImpactOutput } from "@/src/ratings/baseball/types";

const DEFAULT_TTL_MS = 1000 * 60 * 5;
const LONG_TTL_MS = 1000 * 60 * 30;
const DIRECTORY_TTL_MS = 1000 * 60 * 60 * 6;
const ESPN_TEAM_DIRECTORY_BASE =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams';

export type TeamQuickFilter = 'season' | 'last10' | 'home' | 'away' | 'vsTop25';

export type TeamSummary = {
  sport?: "basketball" | "baseball";
  teamId: string;
  name: string;
  shortName: string;
  logo: string;
  record: string;
  conference: string;
  ranking: number | null;
  color: string | null;
  alternateColor: string | null;
  dynamicRating: {
    current: number | null;
    trendLast5: number | null;
  };
  availableFilters: {
    hasTop25Games: boolean;
  };
  baseball?: {
    standingSummary?: string | null;
  };
};

export type TeamGame = {
  sport?: "basketball" | "baseball";
  gameId: string;
  date: string;
  opponentTeamId: string;
  opponent: string;
  opponentLogo: string;
  opponentRank: number | null;
  location: 'H' | 'A' | 'N';
  result: 'W' | 'L' | '';
  teamScore: number | null;
  opponentScore: number | null;
  status: string;
  completed: boolean;
  competition: 'regular' | 'postseason' | 'other';
  ratingBeforeGame: number | null;
  ratingAfterGame: number | null;
  ratingDelta: number | null;
  offenseRating: number | null;
  defenseRating: number | null;
  sosAdjustment: number | null;
  baseball?: {
    inningLabel?: string | null;
    venue?: string | null;
    teamHits?: number | null;
    teamErrors?: number | null;
    opponentHits?: number | null;
    opponentErrors?: number | null;
    teamLinescores?: string[];
    opponentLinescores?: string[];
  };
};

export type TeamGamesPage = {
  rows: TeamGame[];
  page: number;
  hasMore: boolean;
  total: number;
};

export type TeamRosterPlayer = {
  playerId: string;
  name: string;
  shortName: string;
  jersey: string;
  position: string;
  headshot: string;
  sport?: "basketball" | "baseball";
  baseball?: BaseballPlayerCardData | null;
};

export type TeamPlayerStats = TeamRosterPlayer & {
  games: number;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  perGame: {
    minutes: number;
    points: number;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
  };
  efficiency: number;
  usage: number | null;
  onOff: number | null;
  ratingImpact: number | null;
  seasonRating10: number | null;
  confidence?: number | null;
  trendDelta?: number | null;
  impactShare?: number | null;
  ratingTimelinePoints: Array<{
    tSec: number;
    rating: number;
  }>;
  baseball?: BaseballPlayerCardData | null;
  baseballImpact?: BaseballImpactOutput | null;
};

export type TeamRatingsTimeline = {
  formula: string;
  points: TeamGame[];
};

export type TeamStatRow = {
  key: string;
  label: string;
  value: number | null;
  displayValue: string;
  leagueAverage: number | null;
  conferenceAverage: number | null;
};

export type TeamSearchResult = {
  teamId: string;
  name: string;
  shortName: string;
  abbreviation: string;
  logo: string | null;
  conference: string | null;
};

type EspnTeamsDirectoryResponse = {
  sports?: Array<{
    leagues?: Array<{
      teams?: Array<{
        team?: {
          id?: string;
          displayName?: string;
          shortDisplayName?: string;
          abbreviation?: string;
          location?: string;
          name?: string;
          logos?: Array<{ href?: string }>;
        };
      }>;
    }>;
  }>;
};

async function fetchJson<T>(path: string): Promise<T> {
  const url = getApiUrl(path);
  console.log(`[cbb api] request -> ${url}`);
  const response = await apiFetch(path);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = await getCachedJson<T>(key);
  if (hit) {
    return hit;
  }
  const data = await loader();
  await setCachedJson(key, data, ttlMs);
  return data;
}

function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function teamSearchScore(team: TeamSearchResult, normalizedQuery: string): number {
  const fields = [team.name, team.shortName, team.abbreviation]
    .filter(Boolean)
    .map((entry) => entry.toLowerCase());
  if (fields.includes(normalizedQuery)) {
    return 100;
  }
  if (fields.some((entry) => entry.startsWith(normalizedQuery))) {
    return 75;
  }
  if (fields.some((entry) => entry.includes(normalizedQuery))) {
    return 50;
  }
  return 0;
}

async function fetchEspnTeamDirectoryPage(page: number, limit = 200): Promise<TeamSearchResult[]> {
  const response = await fetch(`${ESPN_TEAM_DIRECTORY_BASE}?limit=${limit}&page=${page}`);
  if (!response.ok) {
    throw new Error(`ESPN team directory HTTP ${response.status}`);
  }
  const json = (await response.json()) as EspnTeamsDirectoryResponse;
  const teams = json.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return teams
    .map<TeamSearchResult | null>((entry) => {
      const team = entry.team;
      const teamId = team?.id?.trim();
      if (!teamId) {
        return null;
      }
      const fallbackName = `${team?.location ?? ''} ${team?.name ?? ''}`.trim() || 'Team';
      return {
        teamId,
        name: team?.displayName?.trim() || fallbackName,
        shortName: team?.shortDisplayName?.trim() || team?.displayName?.trim() || fallbackName,
        abbreviation: team?.abbreviation?.trim() || '',
        logo: team?.logos?.[0]?.href?.trim() || null,
        conference: null as string | null,
      };
    })
    .filter((team): team is TeamSearchResult => team !== null);
}

async function getEspnTeamDirectory(): Promise<TeamSearchResult[]> {
  return cached('team-directory:espn', DIRECTORY_TTL_MS, async () => {
    const allTeams: TeamSearchResult[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const teams = await fetchEspnTeamDirectoryPage(page);
      allTeams.push(...teams);
      if (teams.length < 200) {
        break;
      }
    }
    return allTeams.sort((a, b) => a.name.localeCompare(b.name));
  });
}

async function searchTeamsFallback(query: string, limit: number): Promise<TeamSearchResult[]> {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return [];
  }
  const directory = await getEspnTeamDirectory();
  return directory
    .map((team) => ({
      team,
      score: teamSearchScore(team, normalized),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.team.name.localeCompare(b.team.name))
    .slice(0, limit)
    .map((entry) => entry.team);
}

export async function getTeamSummary(teamId: string, season: number): Promise<TeamSummary> {
  return cached(`team-summary:${teamId}:${season}`, DEFAULT_TTL_MS, () =>
    fetchJson<TeamSummary>(`/cbb/team/${encodeURIComponent(teamId)}/summary?season=${season}`),
  );
}

export async function getTeamGames(
  teamId: string,
  season: number,
  page: number,
  pageSize = 20,
  competition = 'all',
  search = '',
): Promise<TeamGamesPage> {
  const query = new URLSearchParams({
    season: String(season),
    page: String(page),
    pageSize: String(pageSize),
    competition,
    search,
  });
  return cached(
    `team-games:${teamId}:${season}:${page}:${pageSize}:${competition}:${search}`,
    DEFAULT_TTL_MS,
    () => fetchJson<TeamGamesPage>(`/cbb/team/${encodeURIComponent(teamId)}/games?${query.toString()}`),
  );
}

export async function getTeamRoster(teamId: string, season: number): Promise<TeamRosterPlayer[]> {
  return cached(`team-roster:${teamId}:${season}`, LONG_TTL_MS, () =>
    fetchJson<TeamRosterPlayer[]>(`/cbb/team/${encodeURIComponent(teamId)}/roster?season=${season}`),
  );
}

export async function getTeamPlayerStats(teamId: string, season: number): Promise<TeamPlayerStats[]> {
  return cached(`team-player-stats:${teamId}:${season}`, LONG_TTL_MS, async () => {
    const raw = await fetchJson<unknown>(
      `/cbb/team/${encodeURIComponent(teamId)}/player-stats?season=${season}`,
    );
    if (!Array.isArray(raw)) {
      console.warn(
        `[cbb api] player-stats for team ${teamId} was not an array, got:`,
        raw,
      );
      return [];
    }
    return raw as TeamPlayerStats[];
  });
}

export async function getTeamRatingsTimeline(
  teamId: string,
  season: number,
): Promise<TeamRatingsTimeline> {
  return cached(`team-ratings:${teamId}:${season}`, DEFAULT_TTL_MS, () =>
    fetchJson<TeamRatingsTimeline>(`/cbb/team/${encodeURIComponent(teamId)}/ratings?season=${season}`),
  );
}

export async function getTeamStats(teamId: string, season: number): Promise<TeamStatRow[]> {
  return cached(`team-stats:${teamId}:${season}`, LONG_TTL_MS, () =>
    fetchJson<TeamStatRow[]>(`/cbb/team/${encodeURIComponent(teamId)}/stats?season=${season}`),
  );
}

export async function searchTeams(query: string, limit = 20): Promise<TeamSearchResult[]> {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return [];
  }
  const safeLimit = Math.max(1, Math.min(50, limit));
  const params = new URLSearchParams({
    q: normalized,
    limit: String(safeLimit),
  });
  return cached(`team-search:${normalized}:${safeLimit}`, DEFAULT_TTL_MS, async () => {
    try {
      return await fetchJson<TeamSearchResult[]>(`/cbb/teams/search?${params.toString()}`);
    } catch (error) {
      console.warn('[cbb api] team search API failed, falling back to ESPN directory', error);
      return searchTeamsFallback(normalized, safeLimit);
    }
  });
}
