import { getCachedJson, setCachedJson } from "@/utils/cache";
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
  getProBasketballLeagueConfig,
  type ProBasketballLeague,
} from "@/src/features/nba/proBasketballLeague";

const DEFAULT_TTL_MS = 1000 * 60 * 5;
const LONG_TTL_MS = 1000 * 60 * 30;

type NbaTeamResponse = {
  team?: {
    id?: string;
    displayName?: string;
    shortDisplayName?: string;
    abbreviation?: string;
    color?: string;
    alternateColor?: string;
    standingSummary?: string;
    logos?: Array<{ href?: string; rel?: string[] }>;
    record?: {
      items?: Array<{
        type?: string;
        summary?: string;
      }>;
    };
    nextEvent?: Array<{
      id?: string;
      date?: string;
    }>;
  };
};

type NbaScheduleResponse = {
  events?: Array<{
    id?: string;
    date?: string;
    seasonType?: { type?: number };
    competitions?: Array<{
      neutralSite?: boolean;
      competitors?: Array<{
        homeAway?: "home" | "away";
        winner?: boolean;
        score?: string | { displayValue?: string; value?: number };
        team?: {
          id?: string;
          displayName?: string;
          shortDisplayName?: string;
          abbreviation?: string;
          logos?: Array<{ href?: string }>;
        };
      }>;
      status?: {
        type?: {
          state?: string;
          description?: string;
          shortDetail?: string;
        };
      };
    }>;
  }>;
};

type NbaRosterResponse = {
  athletes?: Array<{
    id?: string;
    displayName?: string;
    shortName?: string;
    jersey?: string;
    position?: {
      abbreviation?: string;
    };
    headshot?: {
      href?: string;
    };
  }>;
};

type NbaStatisticsResponse = {
  results?: {
    stats?: Array<{
      categories?: Array<{
        stats?: Array<{
          name?: string;
          displayName?: string;
          displayValue?: string;
          value?: number;
        }>;
      }>;
    }>;
  };
};

function safeText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function safeScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (
    typeof value === "object" &&
    value &&
    "value" in value &&
    typeof (value as { value?: unknown }).value === "number"
  ) {
    const parsed = (value as { value?: number }).value;
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickLogo(logos?: Array<{ href?: string; rel?: string[] }>): string {
  if (!logos?.length) {
    return "";
  }
  return (
    logos.find((logo) => logo.rel?.includes("default"))?.href?.trim() ||
    logos[0]?.href?.trim() ||
    ""
  );
}

function getNbaTeamBase(league: ProBasketballLeague): string {
  const { espnLeaguePath } = getProBasketballLeagueConfig(league);
  return `https://site.api.espn.com/apis/site/v2/sports/${espnLeaguePath}/teams`;
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

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = await getCachedJson<T>(key);
  if (hit) {
    return hit;
  }
  const data = await loader();
  await setCachedJson(key, data, ttlMs);
  return data;
}

function getConferenceLabel(league: ProBasketballLeague, _teamId: string): string {
  return getProBasketballLeagueConfig(league).label;
}

export async function getNbaTeamSummary(
  league: ProBasketballLeague,
  teamId: string,
  _season: number,
): Promise<TeamSummary> {
  const config = getProBasketballLeagueConfig(league);
  const teamBase = getNbaTeamBase(league);
  return cached(`${league}:team-summary:${teamId}`, DEFAULT_TTL_MS, async () => {
    const payload = await fetchNbaJson<NbaTeamResponse>(league, `${teamBase}/${teamId}`);
    const team = payload.team;
    const record =
      team?.record?.items?.find((item) => item.type === "total")?.summary ||
      team?.standingSummary ||
      "-";

    return {
      teamId,
      name: safeText(team?.displayName, config.fallbackTeamName),
      shortName: safeText(team?.shortDisplayName, safeText(team?.displayName, "Team")),
      logo: pickLogo(team?.logos),
      record,
      conference: getConferenceLabel(league, teamId),
      ranking: null,
      color: safeText(team?.color) || null,
      alternateColor: safeText(team?.alternateColor) || null,
      dynamicRating: {
        current: null,
        trendLast5: null,
      },
      availableFilters: {
        hasTop25Games: false,
      },
    };
  });
}

function mapScheduleGame(teamId: string, event: NonNullable<NbaScheduleResponse["events"]>[number]): TeamGame | null {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const teamCompetitor = competitors.find((row) => row.team?.id === teamId);
  const opponentCompetitor = competitors.find((row) => row.team?.id !== teamId);
  const gameId = safeText(event.id);

  if (!competition || !teamCompetitor || !opponentCompetitor || !gameId) {
    return null;
  }

  const homeAway = teamCompetitor.homeAway;
  const location: TeamGame["location"] =
    competition.neutralSite ? "N" : homeAway === "away" ? "A" : "H";
  const gameState = competition.status?.type?.state?.toLowerCase() ?? "";
  const result: TeamGame["result"] =
    gameState === "post"
      ? teamCompetitor.winner
        ? "W"
        : "L"
      : "";

  return {
    gameId,
    date: safeText(event.date, new Date().toISOString()),
    opponentTeamId: safeText(opponentCompetitor.team?.id),
    opponent:
      safeText(opponentCompetitor.team?.displayName) ||
      safeText(opponentCompetitor.team?.shortDisplayName) ||
      "Opponent",
    opponentLogo:
      opponentCompetitor.team?.logos?.[0]?.href?.trim() || "",
    opponentRank: null,
    location,
    result,
    teamScore: safeScore(teamCompetitor.score),
    opponentScore: safeScore(opponentCompetitor.score),
    status:
      safeText(competition.status?.type?.shortDetail) ||
      safeText(competition.status?.type?.description) ||
      "Scheduled",
    completed: gameState === "post",
    competition:
      event.seasonType?.type === 3 ? "postseason" : "regular",
    ratingBeforeGame: null,
    ratingAfterGame: null,
    ratingDelta: null,
    offenseRating: null,
    defenseRating: null,
    sosAdjustment: null,
  };
}

export async function getNbaTeamGames(
  league: ProBasketballLeague,
  teamId: string,
  _season: number,
  page: number,
  pageSize = 20,
  _competition = "all",
  _search = "",
): Promise<TeamGamesPage> {
  const teamBase = getNbaTeamBase(league);
  return cached(
    `${league}:team-games:${teamId}:${page}:${pageSize}:${_competition}`,
    DEFAULT_TTL_MS,
    async () => {
      const scheduleUrls =
        _competition === "regular"
          ? [`${teamBase}/${teamId}/schedule?seasontype=2`]
          : _competition === "postseason"
            ? [`${teamBase}/${teamId}/schedule?seasontype=3`]
            : [
                `${teamBase}/${teamId}/schedule`,
                `${teamBase}/${teamId}/schedule?seasontype=2`,
              ];
      const payloads = await Promise.all(
        scheduleUrls.map((url) => fetchNbaJson<NbaScheduleResponse>(league, url)),
      );
      const rows = payloads
        .flatMap((payload) => payload.events ?? [])
        .map((event) => mapScheduleGame(teamId, event))
        .filter((game): game is TeamGame => Boolean(game))
        .filter(
          (game, index, all) =>
            all.findIndex((candidate) => candidate.gameId === game.gameId) === index,
        );

      const total = rows.length;
      const start = page * pageSize;
      const pagedRows = rows.slice(start, start + pageSize);

      return {
        rows: pagedRows,
        page,
        hasMore: start + pageSize < total,
        total,
      };
    },
  );
}

export async function getNbaTeamRoster(
  league: ProBasketballLeague,
  teamId: string,
  _season: number,
): Promise<TeamRosterPlayer[]> {
  const teamBase = getNbaTeamBase(league);
  return cached(`${league}:team-roster:${teamId}`, LONG_TTL_MS, async () => {
    const payload = await fetchNbaJson<NbaRosterResponse>(
      league,
      `${teamBase}/${teamId}/roster`,
    );

    return (payload.athletes ?? []).map((athlete) => ({
      playerId: safeText(athlete.id),
      name: safeText(athlete.displayName, "Player"),
      shortName: safeText(athlete.shortName, safeText(athlete.displayName, "Player")),
      jersey: safeText(athlete.jersey, "-"),
      position: safeText(athlete.position?.abbreviation, "-"),
      headshot: safeText(athlete.headshot?.href),
    }));
  });
}

export async function getNbaTeamPlayerStats(
  league: ProBasketballLeague,
  teamId: string,
  season: number,
): Promise<TeamPlayerStats[]> {
  const roster = await getNbaTeamRoster(league, teamId, season);
  return roster.map((player) => ({
    ...player,
    games: 0,
    minutes: 0,
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fgm: 0,
    fga: 0,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
    perGame: {
      minutes: 0,
      points: 0,
      rebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
    },
    efficiency: 0,
    usage: null,
    onOff: null,
    ratingImpact: null,
    seasonRating10: null,
    ratingTimelinePoints: [],
  }));
}

const NBA_TEAM_STAT_NAMES: Array<{ key: string; label: string }> = [
  { key: "avgPoints", label: "Points Per Game" },
  { key: "fieldGoalPct", label: "Field Goal %" },
  { key: "threePointPct", label: "3-Point %" },
  { key: "freeThrowPct", label: "Free Throw %" },
  { key: "avgRebounds", label: "Rebounds Per Game" },
  { key: "avgAssists", label: "Assists Per Game" },
  { key: "avgTurnovers", label: "Turnovers Per Game" },
  { key: "avgSteals", label: "Steals Per Game" },
  { key: "avgBlocks", label: "Blocks Per Game" },
];

export async function getNbaTeamStats(
  league: ProBasketballLeague,
  teamId: string,
  _season: number,
): Promise<TeamStatRow[]> {
  const teamBase = getNbaTeamBase(league);
  return cached(`${league}:team-stats:${teamId}`, LONG_TTL_MS, async () => {
    const payload = await fetchNbaJson<NbaStatisticsResponse>(
      league,
      `${teamBase}/${teamId}/statistics`,
    );

    const allStats =
      payload.results?.stats?.flatMap((split) =>
        split.categories?.flatMap((category) => category.stats ?? []) ?? [],
      ) ?? [];
    const statMap = new Map(
      allStats
        .filter((stat) => safeText(stat.name).length > 0)
        .map((stat) => [safeText(stat.name), stat]),
    );

    return NBA_TEAM_STAT_NAMES.map((entry) => {
      const stat = statMap.get(entry.key);
      return {
        key: entry.key,
        label: entry.label,
        value: typeof stat?.value === "number" ? stat.value : null,
        displayValue: safeText(stat?.displayValue, "-"),
        leagueAverage: null,
        conferenceAverage: null,
      };
    });
  });
}

export async function getNbaTeamRatingsTimeline(
  league: ProBasketballLeague,
  _teamId: string,
  _season: number,
): Promise<TeamRatingsTimeline> {
  return {
    formula: `${getProBasketballLeagueConfig(league).label} ratings are not available yet.`,
    points: [],
  };
}

type NbaTeamsDirectoryResponse = {
  sports?: Array<{
    leagues?: Array<{
      teams?: Array<{
        team?: {
          id?: string;
          displayName?: string;
          shortDisplayName?: string;
          abbreviation?: string;
          color?: string;
          alternateColor?: string;
          logos?: Array<{ href?: string }>;
        };
      }>;
    }>;
  }>;
};

export type NbaDirectoryTeam = TeamSearchResult & {
  color: string | null;
  alternateColor: string | null;
};

/**
 * Every team in the selected pro league. Exported so features that need the
 * whole league roster-by-roster (e.g. the Stock Market player universe) don't
 * have to reach for team search with a guessed query.
 */
export async function getNbaTeamDirectory(
  league: ProBasketballLeague,
): Promise<NbaDirectoryTeam[]> {
  const config = getProBasketballLeagueConfig(league);
  const teamBase = getNbaTeamBase(league);
  return cached(`${league}:team-directory`, LONG_TTL_MS, async () => {
    const payload = await fetchNbaJson<NbaTeamsDirectoryResponse>(league, teamBase);
    const teams = payload.sports?.[0]?.leagues?.[0]?.teams ?? [];

    const directory: NbaDirectoryTeam[] = [];
    teams.forEach((entry) => {
      const team = entry.team;
      const teamId = safeText(team?.id);
      if (!teamId) {
        return;
      }

      directory.push({
        teamId,
        name: safeText(team?.displayName, config.fallbackTeamName),
        shortName: safeText(
          team?.shortDisplayName,
          safeText(team?.displayName, "Team"),
        ),
        abbreviation: safeText(team?.abbreviation),
        logo: team?.logos?.[0]?.href?.trim() || null,
        conference: getConferenceLabel(league, teamId),
        color: safeText(team?.color) || null,
        alternateColor: safeText(team?.alternateColor) || null,
      });
    });

    return directory;
  });
}

async function getNbaDirectory(
  league: ProBasketballLeague,
): Promise<TeamSearchResult[]> {
  return getNbaTeamDirectory(league);
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function scoreSearch(team: TeamSearchResult, query: string): number {
  const fields = [team.name, team.shortName, team.abbreviation]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  if (fields.includes(query)) return 100;
  if (fields.some((value) => value.startsWith(query))) return 75;
  if (fields.some((value) => value.includes(query))) return 50;
  return 0;
}

export async function searchNbaTeams(
  league: ProBasketballLeague,
  query: string,
  limit = 20,
): Promise<TeamSearchResult[]> {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [];
  }
  const directory = await getNbaDirectory(league);
  return directory
    .map((team) => ({ team, score: scoreSearch(team, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.team.name.localeCompare(b.team.name))
    .slice(0, limit)
    .map((entry) => entry.team);
}
