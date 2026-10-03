import {
  computeImpactFromBox,
  type GameContext,
  type PlayerBox,
} from "@/apps/mobile/src/ratings/impactRating";
import {
  getHydratedHistoricalLiveGameData,
  type LiveGamePlayer,
  type LiveGameRatingTimelinePoint,
} from "@/hooks/useLiveGame";
import {
  getTeamPlayerStats,
  getTeamSummary,
  type TeamPlayerStats,
  type TeamSummary,
} from "@/src/features/basketball/teamApi";
import type { GameMode } from "@/src/mode/gameModeTypes";
import {
  DEFAULT_PRO_BASKETBALL_LEAGUE,
  getProBasketballLeagueConfig,
  type ProBasketballLeague,
} from "@/src/features/nba/proBasketballLeague";
import { getCachedJson, setCachedJson } from "@/utils/cache";

const PLAYER_CORE_TTL_MS = 1000 * 60 * 5;
const PLAYER_DETAIL_TTL_MS = 1000 * 60 * 10;
const DEFAULT_SEASON = new Date().getFullYear();
const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

type PlayerIdentitySeed = {
  teamId?: string;
  teamName?: string;
  teamLogo?: string;
  teamRecord?: string;
  conferenceName?: string;
  playerName?: string;
  headshot?: string;
  jersey?: string;
  position?: string;
};

type PlayerApiResponse = {
  athlete?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
    fullName?: string;
    jersey?: string;
    displayJersey?: string;
    headshot?: { href?: string };
    position?: {
      abbreviation?: string;
      displayName?: string;
    };
    team?: {
      id?: string;
      displayName?: string;
      shortDisplayName?: string;
      abbreviation?: string;
      color?: string;
      alternateColor?: string;
      logos?: Array<{ href?: string; rel?: string[] }>;
    };
    active?: boolean;
    // The real shape is flat ({id, name, type, abbreviation}, type being a
    // STRING like "active"/"inactive") — this previously declared a nested
    // status.type.{name,description,shortDetail} object that never matches
    // anything ESPN actually returns, so player.status silently parsed to
    // null for every player regardless of active/inactive state.
    status?: {
      name?: string;
      type?: string;
      abbreviation?: string;
    };
    statsSummary?: string;
    displayBirthPlace?: string;
    displayHeight?: string;
    displayWeight?: string;
    displayDOB?: string;
    age?: number;
    displayExperience?: string;
    displayDraft?: string;
    debutYear?: number;
    college?: {
      name?: string;
      shortName?: string;
    };
    flag?: {
      href?: string;
      alt?: string;
    };
  };
  season?: {
    year?: number;
    displayName?: string;
  };
  // The college ("mens-college-basketball") athlete endpoint nests this as
  // { header, link, articles } instead of a flat array like every other
  // league/endpoint returns — normalizeNews() below handles both shapes.
  news?: NewsResponseItem[] | { articles?: NewsResponseItem[] };
};

type PlayerStatsCategory = {
  name?: string;
  displayName?: string;
  labels?: string[];
  names?: string[];
  displayNames?: string[];
  descriptions?: string[];
  totals?: string[];
  statistics?: Array<{
    teamId?: string;
    teamSlug?: string;
    season?: {
      year?: number;
      displayName?: string;
    };
    stats?: string[];
    position?: string;
  }>;
};

type PlayerStatsResponse = {
  teams?: Record<
    string,
    {
      id?: string;
      displayName?: string;
      shortDisplayName?: string;
      abbreviation?: string;
      color?: string;
      alternateColor?: string;
      logos?: Array<{ href?: string; rel?: string[] }>;
    }
  >;
  filters?: Array<{
    name?: string;
    value?: string;
    options?: Array<{ value?: string; displayValue?: string }>;
  }>;
  categories?: PlayerStatsCategory[];
};

type OverviewResponse = {
  statistics?: {
    displayName?: string;
    labels?: string[];
    names?: string[];
    displayNames?: string[];
    splits?: Array<{
      displayName?: string;
      stats?: string[];
    }>;
  };
  news?: NewsResponseItem[];
  nextGame?: {
    displayName?: string;
    statistics?: {
      labels?: string[];
      names?: string[];
      displayNames?: string[];
      splits?: Array<{
        displayName?: string;
        stats?: string[];
      }>;
    };
    summaryStatistics?: Array<{
      displayValue?: string;
      abbreviation?: string;
      displayName?: string;
    }>;
    league?: {
      events?: Array<{
        id?: string;
        date?: string;
        status?: { type?: { description?: string; shortDetail?: string } };
        competitions?: Array<{
          competitors?: Array<{
            homeAway?: "home" | "away";
            score?: string;
            team?: {
              id?: string;
              displayName?: string;
              shortDisplayName?: string;
              abbreviation?: string;
              logos?: Array<{ href?: string }>;
            };
          }>;
        }>;
      }>;
    };
  };
  gameLog?: {
    displayName?: string;
    statistics?: Array<{
      displayName?: string;
      labels?: string[];
      names?: string[];
      displayNames?: string[];
      events?: Array<{
        eventId?: string;
        stats?: string[];
      }>;
    }>;
    events?: Record<
      string,
      {
        id?: string;
        gameDate?: string;
        gameResult?: string;
        atVs?: string;
        score?: string;
        opponent?: {
          id?: string;
          displayName?: string;
          abbreviation?: string;
          logos?: Array<{ href?: string }>;
        };
      }
    >;
  };
  rotowire?: {
    headline?: string;
    description?: string;
    story?: string;
    published?: string;
  };
};

type GameLogResponse = {
  labels?: string[];
  names?: string[];
  displayNames?: string[];
  filters?: Array<{
    name?: string;
    value?: string;
    options?: Array<{ value?: string; displayValue?: string }>;
  }>;
  // The real per-game box-score stats live here — response.statistics (below)
  // does not actually exist on the live endpoint despite the type having
  // carried it for a while; every category under every season type gets
  // merged (see normalizeGameLog) since a single response can span multiple
  // categories (e.g. regular season vs. postseason).
  seasonTypes?: Array<{
    displayName?: string;
    categories?: Array<{
      displayName?: string;
      events?: Array<{
        eventId?: string;
        stats?: string[];
      }>;
    }>;
  }>;
  // Kept for backwards compatibility in case some response variant does use
  // this shape — normalizeGameLog merges it in alongside seasonTypes rather
  // than relying on it exclusively.
  statistics?: Array<{
    displayName?: string;
    labels?: string[];
    names?: string[];
    displayNames?: string[];
    events?: Array<{
      eventId?: string;
      stats?: string[];
    }>;
  }>;
  events?: Record<
    string,
    {
      id?: string;
      atVs?: string;
      gameDate?: string;
      score?: string;
      homeTeamId?: string;
      awayTeamId?: string;
      homeTeamScore?: string;
      awayTeamScore?: string;
      gameResult?: string;
      eventNote?: string;
      opponent?: {
        id?: string;
        displayName?: string;
        abbreviation?: string;
        // ESPN's college gamelog nests a single `logo` string here, not the
        // `logos` array other endpoints use — normalizeGameLog checks both.
        logo?: string;
        logos?: Array<{ href?: string }>;
      };
      team?: {
        id?: string;
        // Present on some leagues, but the college endpoint's per-event
        // `team` omits both name fields entirely (only id/abbreviation/logo
        // are present) — normalizeGameLog falls back to a teamId -> full
        // school name map built from the /stats response for that case.
        displayName?: string;
        shortDisplayName?: string;
        abbreviation?: string;
        logo?: string;
        logos?: Array<{ href?: string }>;
      };
    }
  >;
};

type SplitsResponse = {
  labels?: string[];
  names?: string[];
  displayNames?: string[];
  splitCategories?: Array<{
    name?: string;
    displayName?: string;
    splits?: Array<{
      displayName?: string;
      abbreviation?: string;
      stats?: string[];
    }>;
  }>;
};

type NewsResponseItem = {
  id?: string | number;
  headline?: string;
  description?: string;
  published?: string;
  categorized?: string;
  section?: string;
  links?: {
    web?: {
      href?: string;
      self?: { href?: string };
    };
  };
  images?: Array<{
    url?: string;
    width?: number;
    height?: number;
  }>;
};

type PlayerGameLogTimelinePoint = {
  tSec: number;
  rating: number;
};

export type PlayerProfileStatDatum = {
  key: string;
  label: string;
  value: number | null;
  displayValue: string;
};

export type PlayerProfileGameLogEntry = {
  gameId: string;
  date: string;
  location: "H" | "A" | "N" | "";
  result: "W" | "L" | "";
  finalScore: string;
  teamScore: number | null;
  opponentScore: number | null;
  opponent: {
    id?: string;
    name: string;
    abbreviation: string;
    logo: string;
  };
  team: {
    id?: string;
    name: string;
    abbreviation: string;
    logo: string;
  };
  minutes: number;
  minutesDisplay: string;
  points: number;
  rebounds: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fg: string;
  threePt: string;
  ft: string;
  fgPct: number | null;
  threePct: number | null;
  ftPct: number | null;
  plusMinus: string | null;
  dynamicRating: number | null;
  ratingRawImpact: number | null;
  eventNote: string | null;
  ratingTimelinePoints: PlayerGameLogTimelinePoint[];
};

export type PlayerProfileSplitRow = {
  key: string;
  label: string;
  games: number;
  minutes: string;
  points: string;
  rebounds: string;
  assists: string;
  steals: string;
  blocks: string;
  turnovers: string;
  fgPct: string;
  threePct: string;
  ftPct: string;
  rating: string;
};

export type PlayerProfileSplitGroup = {
  key: string;
  title: string;
  source: "derived" | "espn";
  rows: PlayerProfileSplitRow[];
};

export type PlayerProfileNewsItem = {
  id: string;
  headline: string;
  description: string;
  published: string;
  section: string;
  href: string;
  image: string;
};

export type PlayerProfileNote = {
  headline: string;
  description: string;
  published: string;
};

export type PlayerProfileNextGame = {
  gameId: string;
  date: string;
  statusText: string;
  opponentName: string;
  opponentAbbreviation: string;
  opponentLogo: string;
};

export type PlayerProfileRatingStretch = {
  label: string;
  average: number;
  gameIds: string[];
};

export type PlayerProfileMonthlyRating = {
  label: string;
  average: number;
  games: number;
};

export type PlayerProfileData = {
  player: {
    id: string;
    firstName: string;
    lastName: string;
    fullName: string;
    headshot: string;
    jersey: string;
    position: string;
    active: boolean;
    status: string | null;
    statsSummary: string | null;
    displayHeight: string | null;
    displayWeight: string | null;
    displayDOB: string | null;
    age: string | null;
    birthPlace: string | null;
    experience: string | null;
    draft: string | null;
    debutYear: number | null;
    college: string | null;
    flagHref: string | null;
    team: {
      id?: string;
      name: string;
      shortName: string;
      abbreviation: string;
      logo: string;
      record: string | null;
      conferenceName: string | null;
      color: string | null;
      alternateColor: string | null;
    };
  };
  season: {
    label: string;
    gamesPlayed: number;
    gamesStarted: number | null;
    minutesPerGame: number | null;
    pointsPerGame: number | null;
    reboundsPerGame: number | null;
    assistsPerGame: number | null;
    stealsPerGame: number | null;
    blocksPerGame: number | null;
    turnoversPerGame: number | null;
    foulsPerGame: number | null;
    fgPct: number | null;
    threePct: number | null;
    ftPct: number | null;
    teamRecordWhenPlayerAppeared: string | null;
    averages: PlayerProfileStatDatum[];
    totals: PlayerProfileStatDatum[];
    shooting: PlayerProfileStatDatum[];
    advanced: PlayerProfileStatDatum[];
    misc: PlayerProfileStatDatum[];
  };
  rating: {
    currentAvailable: number | null;
    seasonAverage: number | null;
    recentAverage: number | null;
    bestGameId: string | null;
    worstGameId: string | null;
    bestStretch: PlayerProfileRatingStretch | null;
    worstStretch: PlayerProfileRatingStretch | null;
    consistencyLabel: string | null;
    volatility: number | null;
    monthly: PlayerProfileMonthlyRating[];
  };
  gameLog: PlayerProfileGameLogEntry[];
  splitGroups: PlayerProfileSplitGroup[];
  strengths: string[];
  weaknesses: string[];
  notes: string[];
  news: PlayerProfileNewsItem[];
  rotowireNote: PlayerProfileNote | null;
  nextGame: PlayerProfileNextGame | null;
  teamSummary: TeamSummary | null;
  teamPlayerStat: TeamPlayerStats | null;
  teammateRanks: {
    dynamicRating: number | null;
    scoring: number | null;
    minutes: number | null;
    usage: number | null;
  };
};

function getLeaguePath(
  mode: GameMode,
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): string {
  if (mode === "nba") {
    return getProBasketballLeagueConfig(proLeague).espnLeaguePath;
  }
  if (mode === "baseball") {
    return "baseball/college-baseball";
  }
  return "basketball/mens-college-basketball";
}

async function fetchPlayerJson<T>(
  mode: GameMode,
  proLeague: ProBasketballLeague,
  playerId: string,
  suffix: string,
  ttlMs: number,
  season?: number,
): Promise<T> {
  const leagueKey = mode === "nba" ? proLeague : mode;
  const cacheKey = `player-profile:${leagueKey}:${playerId}:${suffix || "base"}${season ? `:${season}` : ""}`;
  const cached = await getCachedJson<T>(cacheKey);
  if (cached) {
    return cached;
  }

  const path = suffix ? `/${suffix}` : "";
  const query = season ? `?season=${season}` : "";
  const response = await fetch(
    `https://site.web.api.espn.com/apis/common/v3/sports/${getLeaguePath(mode, proLeague)}/athletes/${playerId}${path}${query}`,
  );
  if (!response.ok) {
    throw new Error(`Player endpoint HTTP ${response.status}`);
  }
  const json = (await response.json()) as T;
  await setCachedJson(cacheKey, json, ttlMs);
  return json;
}

function safeText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^0-9.+-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safePercent(value: unknown): number | null {
  const numeric = safeNumber(value);
  return numeric === null ? null : numeric;
}

function pickLogo(
  logos?: Array<{ href?: string; rel?: string[] }>,
  fallback = FALLBACK_IMAGE_URI,
): string {
  if (!logos?.length) {
    return fallback;
  }
  return (
    safeText(logos.find((logo) => logo.rel?.includes("default"))?.href) ||
    safeText(logos[0]?.href) ||
    fallback
  );
}

function parseMadeAttempted(value: string): {
  made: number;
  attempted: number;
} {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) {
    return { made: 0, attempted: 0 };
  }
  return {
    made: Number.parseFloat(match[1]) || 0,
    attempted: Number.parseFloat(match[2]) || 0,
  };
}

function statMap(
  names: string[] | undefined,
  stats: string[] | undefined,
): Record<string, string> {
  const resolvedNames = names ?? [];
  const resolvedStats = stats ?? [];
  return resolvedNames.reduce<Record<string, string>>((map, name, index) => {
    map[name] = safeText(resolvedStats[index], "0");
    return map;
  }, {});
}

function formatNumeric(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function formatPercentValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(1)}%`;
}

function formatInteger(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${Math.round(value)}`;
}

function formatRecord(wins: number, losses: number): string {
  return `${wins}-${losses}`;
}

function average(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (filtered.length === 0) {
    return null;
  }
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function sampleStandardDeviation(values: number[]): number | null {
  if (values.length <= 1) {
    return null;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, values.length - 1);
  return Math.sqrt(variance);
}

function toPlayerBox(entry: PlayerProfileGameLogEntry): PlayerBox {
  const fg = parseMadeAttempted(entry.fg);
  const ft = parseMadeAttempted(entry.ft);
  return {
    playerId: entry.gameId,
    minutes: entry.minutes,
    points: entry.points,
    fga: fg.attempted,
    fgm: fg.made,
    fta: ft.attempted,
    ftm: ft.made,
    oreb: entry.offensiveRebounds,
    dreb: entry.defensiveRebounds,
    reb: entry.rebounds,
    ast: entry.assists,
    stl: entry.steals,
    blk: entry.blocks,
    tov: entry.turnovers,
    pf: entry.fouls,
  };
}

function buildFinalGameContext(
  mode: GameMode,
  location: PlayerProfileGameLogEntry["location"],
  teamScore: number | null,
  opponentScore: number | null,
): GameContext {
  const resolvedTeamScore = teamScore ?? 0;
  const resolvedOpponentScore = opponentScore ?? 0;
  const isHome = location !== "A";
  return {
    period: mode === "nba" ? 4 : 2,
    clockSec: 0,
    homeScore: isHome ? resolvedTeamScore : resolvedOpponentScore,
    awayScore: isHome ? resolvedOpponentScore : resolvedTeamScore,
    isCloseGame: Math.abs(resolvedTeamScore - resolvedOpponentScore) <= 8,
    isClutch: Math.abs(resolvedTeamScore - resolvedOpponentScore) <= 8,
    leadChangedOnPlay: false,
  };
}

function sortByValueDesc<T>(
  rows: T[],
  getValue: (row: T) => number | null | undefined,
): T[] {
  return [...rows].sort((left, right) => {
    const leftValue = getValue(left);
    const rightValue = getValue(right);
    if (leftValue === null || leftValue === undefined) {
      return 1;
    }
    if (rightValue === null || rightValue === undefined) {
      return -1;
    }
    return rightValue - leftValue;
  });
}

function findRank<T>(
  rows: T[],
  predicate: (row: T) => boolean,
  getValue: (row: T) => number | null | undefined,
): number | null {
  const sorted = sortByValueDesc(rows, getValue);
  const index = sorted.findIndex(predicate);
  return index >= 0 ? index + 1 : null;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString([], { month: "short", year: "numeric" });
}

function formatDateLabel(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeNameForMatch(value: string | undefined): string {
  return safeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeTimelinePoints(
  points: LiveGameRatingTimelinePoint[] | PlayerGameLogTimelinePoint[] | undefined,
): PlayerGameLogTimelinePoint[] {
  return (points ?? [])
    .filter(
      (point) =>
        Number.isFinite(point?.tSec) &&
        Number.isFinite(point?.rating),
    )
    .map((point) => ({
      tSec: Math.max(0, Math.round(point.tSec)),
      rating: Number(Math.max(0, Math.min(10, point.rating)).toFixed(1)),
    }))
    .sort((left, right) => left.tSec - right.tSec);
}

async function getHistoricalLiveGamePlayers(
  mode: GameMode,
  gameId: string,
  proLeague: ProBasketballLeague,
): Promise<Record<string, LiveGamePlayer[]> | null> {
  const leagueKey = mode === "nba" ? proLeague : mode;
  const cacheKey = `player-game-log-live:${leagueKey}:${gameId}`;
  const cached = await getCachedJson<Record<string, LiveGamePlayer[]>>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const data = await getHydratedHistoricalLiveGameData(mode, gameId, proLeague);
    if (!data?.playersByTeam) {
      return null;
    }
    await setCachedJson(cacheKey, data.playersByTeam, PLAYER_DETAIL_TTL_MS);
    return data.playersByTeam;
  } catch {
    return null;
  }
}

function findHistoricalPlayer(
  playersByTeam: Record<string, LiveGamePlayer[]>,
  playerId: string,
  playerName: string,
  teamId?: string,
): LiveGamePlayer | null {
  const groups = Object.entries(playersByTeam);
  const allPlayers = groups.flatMap(([, players]) => players ?? []);
  const exactId = allPlayers.find((player) => safeText(player.id) === playerId) ?? null;
  if (exactId) {
    return exactId;
  }

  const normalizedPlayerName = normalizeNameForMatch(playerName);
  if (!normalizedPlayerName) {
    return null;
  }

  const teamScoped = teamId
    ? groups
        .filter(([candidateTeamId]) => safeText(candidateTeamId) === safeText(teamId))
        .flatMap(([, players]) => players ?? [])
    : allPlayers;

  return (
    teamScoped.find((player) => {
      const fullName = normalizeNameForMatch(player.name);
      const shortName = normalizeNameForMatch(player.shortName);
      const lastName = normalizeNameForMatch(player.lastName);
      return (
        fullName === normalizedPlayerName ||
        shortName === normalizedPlayerName ||
        (lastName.length > 0 && normalizedPlayerName.endsWith(lastName))
      );
    }) ?? null
  );
}

async function enrichGameLogWithHistoricalGraphs(
  mode: GameMode,
  proLeague: ProBasketballLeague,
  playerId: string,
  playerName: string,
  gameLog: PlayerProfileGameLogEntry[],
): Promise<PlayerProfileGameLogEntry[]> {
  return Promise.all(
    gameLog.map(async (entry) => {
      const playersByTeam = await getHistoricalLiveGamePlayers(mode, entry.gameId, proLeague);
      if (!playersByTeam) {
        return entry;
      }

      const historicalPlayer = findHistoricalPlayer(
        playersByTeam,
        playerId,
        playerName,
        entry.team.id,
      );
      if (!historicalPlayer) {
        return entry;
      }

      const ratingTimelinePoints = normalizeTimelinePoints(
        historicalPlayer.ratingTimelinePoints,
      );
      const finalTimelineRating =
        ratingTimelinePoints.length > 0
          ? ratingTimelinePoints[ratingTimelinePoints.length - 1]?.rating ?? null
          : null;
      const finalSavedRating =
        typeof historicalPlayer.inGameRating10 === "number" &&
        Number.isFinite(historicalPlayer.inGameRating10)
          ? historicalPlayer.inGameRating10
          : finalTimelineRating ?? entry.dynamicRating;

      return {
        ...entry,
        dynamicRating:
          typeof finalSavedRating === "number"
            ? Number(finalSavedRating.toFixed(1))
            : entry.dynamicRating,
        ratingTimelinePoints,
      };
    }),
  );
}

function dedupeNews(rows: PlayerProfileNewsItem[]): PlayerProfileNewsItem[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) {
      return false;
    }
    seen.add(row.id);
    return true;
  });
}

function normalizeNews(
  rows: NewsResponseItem[] | { articles?: NewsResponseItem[] } | undefined,
): PlayerProfileNewsItem[] {
  const list = Array.isArray(rows) ? rows : Array.isArray(rows?.articles) ? rows.articles : [];
  return list
    .map((item) => {
      const id = safeText(item.id != null ? `${item.id}` : "");
      const headline = safeText(item.headline);
      if (!id || !headline) {
        return null;
      }
      return {
        id,
        headline,
        description: safeText(item.description, headline),
        published: safeText(item.published || item.categorized),
        section: safeText(item.section, "News"),
        href:
          safeText(item.links?.web?.href) ||
          safeText(item.links?.web?.self?.href),
        image: safeText(item.images?.[0]?.url),
      } satisfies PlayerProfileNewsItem;
    })
    .filter((item): item is PlayerProfileNewsItem => Boolean(item));
}

function pickLatestSeasonRow(category: PlayerStatsCategory | undefined) {
  const statistics = category?.statistics ?? [];
  return statistics[statistics.length - 1] ?? null;
}

function buildSeasonStatDatum(
  key: string,
  label: string,
  value: number | null,
  formatter: (value: number | null) => string = formatNumeric,
): PlayerProfileStatDatum {
  return {
    key,
    label,
    value,
    displayValue: formatter(value),
  };
}

function buildSeasonSummaryTables(
  averages: Record<string, string>,
  totals: Record<string, string>,
  misc: Record<string, string>,
  ratingAverage: number | null,
  recentAverage: number | null,
  teamPlayerStat: TeamPlayerStats | null,
): {
  averagesTable: PlayerProfileStatDatum[];
  totalsTable: PlayerProfileStatDatum[];
  shootingTable: PlayerProfileStatDatum[];
  advancedTable: PlayerProfileStatDatum[];
  miscTable: PlayerProfileStatDatum[];
} {
  const gamesPlayed = safeNumber(averages.gamesPlayed ?? totals.gamesPlayed);
  const gamesStarted = safeNumber(averages.gamesStarted ?? totals.gamesStarted);
  const minutesPerGame = safeNumber(averages.avgMinutes);
  const pointsPerGame = safeNumber(averages.avgPoints ?? totals.points);
  const reboundsPerGame = safeNumber(averages.avgRebounds ?? totals.rebounds);
  const assistsPerGame = safeNumber(averages.avgAssists ?? totals.assists);
  const stealsPerGame = safeNumber(averages.avgSteals ?? totals.steals);
  const blocksPerGame = safeNumber(averages.avgBlocks ?? totals.blocks);
  const turnoversPerGame = safeNumber(averages.avgTurnovers ?? totals.turnovers);
  const foulsPerGame = safeNumber(averages.avgFouls ?? totals.fouls);
  const fgPct = safePercent(averages.fieldGoalPct ?? totals.fieldGoalPct);
  const threePct = safePercent(
    averages.threePointPct ??
      averages.threePointFieldGoalPct ??
      totals.threePointPct ??
      totals.threePointFieldGoalPct,
  );
  const ftPct = safePercent(averages.freeThrowPct ?? totals.freeThrowPct);

  const totalMinutes = safeNumber(totals.minutes) ?? (gamesPlayed ?? 0) * (minutesPerGame ?? 0);
  const totalPoints = safeNumber(totals.points) ?? (gamesPlayed ?? 0) * (pointsPerGame ?? 0);
  const totalRebounds =
    safeNumber(totals.rebounds) ?? (gamesPlayed ?? 0) * (reboundsPerGame ?? 0);
  const totalAssists =
    safeNumber(totals.assists) ?? (gamesPlayed ?? 0) * (assistsPerGame ?? 0);
  const totalSteals =
    safeNumber(totals.steals) ?? (gamesPlayed ?? 0) * (stealsPerGame ?? 0);
  const totalBlocks =
    safeNumber(totals.blocks) ?? (gamesPlayed ?? 0) * (blocksPerGame ?? 0);
  const totalTurnovers =
    safeNumber(totals.turnovers) ?? (gamesPlayed ?? 0) * (turnoversPerGame ?? 0);
  const totalFouls =
    safeNumber(totals.fouls) ?? (gamesPlayed ?? 0) * (foulsPerGame ?? 0);

  const fgText =
    safeText(totals.fieldGoalsMade?.toString()) &&
    safeText(totals.fieldGoalsAttempted?.toString())
      ? `${formatInteger(safeNumber(totals.fieldGoalsMade))}-${formatInteger(
          safeNumber(totals.fieldGoalsAttempted),
        )}`
      : safeText(totals["fieldGoalsMade-fieldGoalsAttempted"], "-");
  const threeText =
    safeText(totals.threePointFieldGoalsMade?.toString()) &&
    safeText(totals.threePointFieldGoalsAttempted?.toString())
      ? `${formatInteger(safeNumber(totals.threePointFieldGoalsMade))}-${formatInteger(
          safeNumber(totals.threePointFieldGoalsAttempted),
        )}`
      : safeText(
          totals["threePointFieldGoalsMade-threePointFieldGoalsAttempted"],
          "-",
        );
  const ftText =
    safeText(totals.freeThrowsMade?.toString()) &&
    safeText(totals.freeThrowsAttempted?.toString())
      ? `${formatInteger(safeNumber(totals.freeThrowsMade))}-${formatInteger(
          safeNumber(totals.freeThrowsAttempted),
        )}`
      : safeText(totals["freeThrowsMade-freeThrowsAttempted"], "-");

  const fgSplit =
    fgText !== "-"
      ? parseMadeAttempted(fgText)
      : parseMadeAttempted(
          safeText(totals["fieldGoalsMade-fieldGoalsAttempted"], "0-0"),
        );
  const threeSplit =
    threeText !== "-"
      ? parseMadeAttempted(threeText)
      : parseMadeAttempted(
          safeText(
            totals["threePointFieldGoalsMade-threePointFieldGoalsAttempted"],
            "0-0",
          ),
        );
  const ftSplit =
    ftText !== "-"
      ? parseMadeAttempted(ftText)
      : parseMadeAttempted(
          safeText(totals["freeThrowsMade-freeThrowsAttempted"], "0-0"),
        );

  const efgPct =
    fgSplit.attempted > 0
      ? ((fgSplit.made + 0.5 * threeSplit.made) / fgSplit.attempted) * 100
      : null;
  const tsPct =
    fgSplit.attempted + 0.44 * ftSplit.attempted > 0
      ? (((totalPoints ?? 0) /
          (2 * (fgSplit.attempted + 0.44 * ftSplit.attempted))) *
          100)
      : null;
  const pointsPer40 =
    totalMinutes && totalMinutes > 0
      ? ((totalPoints ?? 0) / totalMinutes) * 40
      : null;
  const reboundsPer40 =
    totalMinutes && totalMinutes > 0
      ? ((totalRebounds ?? 0) / totalMinutes) * 40
      : null;
  const assistsPer40 =
    totalMinutes && totalMinutes > 0
      ? ((totalAssists ?? 0) / totalMinutes) * 40
      : null;
  const stocksPerGame =
    stealsPerGame !== null || blocksPerGame !== null
      ? (stealsPerGame ?? 0) + (blocksPerGame ?? 0)
      : null;
  const usageProxy =
    totalMinutes && totalMinutes > 0
      ? ((fgSplit.attempted + 0.44 * ftSplit.attempted + (totalTurnovers ?? 0)) /
          totalMinutes) *
        40
      : null;
  const astToTurnover =
    (totalTurnovers ?? 0) > 0
      ? (totalAssists ?? 0) / Math.max(1, totalTurnovers ?? 0)
      : totalAssists && totalAssists > 0
        ? totalAssists
        : null;

  return {
    averagesTable: [
      buildSeasonStatDatum("gamesPlayed", "Games", gamesPlayed, formatInteger),
      buildSeasonStatDatum("gamesStarted", "Starts", gamesStarted, formatInteger),
      buildSeasonStatDatum("minutesPerGame", "Minutes", minutesPerGame),
      buildSeasonStatDatum("pointsPerGame", "Points", pointsPerGame),
      buildSeasonStatDatum("reboundsPerGame", "Rebounds", reboundsPerGame),
      buildSeasonStatDatum("assistsPerGame", "Assists", assistsPerGame),
      buildSeasonStatDatum("stealsPerGame", "Steals", stealsPerGame),
      buildSeasonStatDatum("blocksPerGame", "Blocks", blocksPerGame),
      buildSeasonStatDatum("turnoversPerGame", "Turnovers", turnoversPerGame),
      buildSeasonStatDatum("foulsPerGame", "Fouls", foulsPerGame),
    ],
    totalsTable: [
      buildSeasonStatDatum("minutes", "Total Minutes", totalMinutes, formatInteger),
      buildSeasonStatDatum("points", "Total Points", totalPoints, formatInteger),
      buildSeasonStatDatum("rebounds", "Total Rebounds", totalRebounds, formatInteger),
      buildSeasonStatDatum("assists", "Total Assists", totalAssists, formatInteger),
      buildSeasonStatDatum("steals", "Total Steals", totalSteals, formatInteger),
      buildSeasonStatDatum("blocks", "Total Blocks", totalBlocks, formatInteger),
      buildSeasonStatDatum("turnovers", "Total Turnovers", totalTurnovers, formatInteger),
      buildSeasonStatDatum("fouls", "Total Fouls", totalFouls, formatInteger),
      { key: "fgText", label: "FG", value: null, displayValue: fgText || "-" },
      { key: "threeText", label: "3PT", value: null, displayValue: threeText || "-" },
      { key: "ftText", label: "FT", value: null, displayValue: ftText || "-" },
    ],
    shootingTable: [
      buildSeasonStatDatum("fgPct", "FG%", fgPct, formatPercentValue),
      buildSeasonStatDatum("threePct", "3PT%", threePct, formatPercentValue),
      buildSeasonStatDatum("ftPct", "FT%", ftPct, formatPercentValue),
      buildSeasonStatDatum("efgPct", "eFG%", efgPct, formatPercentValue),
      buildSeasonStatDatum("tsPct", "TS%", tsPct, formatPercentValue),
    ],
    advancedTable: [
      buildSeasonStatDatum("ratingAverage", "Dyn. Rating", ratingAverage),
      buildSeasonStatDatum("recentAverage", "Last 5 Rating", recentAverage),
      buildSeasonStatDatum("pointsPer40", "Points / 40", pointsPer40),
      buildSeasonStatDatum("reboundsPer40", "Rebounds / 40", reboundsPer40),
      buildSeasonStatDatum("assistsPer40", "Assists / 40", assistsPer40),
      buildSeasonStatDatum("stocksPerGame", "Stocks / Game", stocksPerGame),
      buildSeasonStatDatum("usageProxy", "Usage Proxy", usageProxy),
      buildSeasonStatDatum("astToTurnover", "AST / TO", astToTurnover),
      buildSeasonStatDatum(
        "teamUsage",
        "Team Usage",
        typeof teamPlayerStat?.usage === "number" ? teamPlayerStat.usage : null,
      ),
      buildSeasonStatDatum(
        "teamImpact",
        "Team Impact",
        typeof teamPlayerStat?.ratingImpact === "number"
          ? teamPlayerStat.ratingImpact
          : null,
      ),
    ],
    miscTable: Object.entries(misc)
      .slice(0, 8)
      .map(([key, value]) => ({
        key,
        label: key.replace(/([A-Z])/g, " $1").replace(/^./, (text) => text.toUpperCase()),
        value: safeNumber(value),
        displayValue: safeText(value, "-"),
      })),
  };
}

function buildStrengthsAndWeaknesses(
  season: PlayerProfileData["season"],
): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if ((season.pointsPerGame ?? 0) >= 16) {
    strengths.push("Primary scoring load");
  }
  if ((season.fgPct ?? 0) >= 48) {
    strengths.push("Efficient finishing");
  }
  if ((season.assistsPerGame ?? 0) >= 4) {
    strengths.push("Playmaking");
  }
  if ((season.reboundsPerGame ?? 0) >= 6) {
    strengths.push("Glass presence");
  }
  if (((season.stealsPerGame ?? 0) + (season.blocksPerGame ?? 0)) >= 2) {
    strengths.push("Defensive disruption");
  }

  if ((season.turnoversPerGame ?? 0) >= 2.8) {
    weaknesses.push("Turnover volume");
  }
  if ((season.foulsPerGame ?? 0) >= 2.8) {
    weaknesses.push("Foul pressure");
  }
  if ((season.threePct ?? 100) < 32) {
    weaknesses.push("Three-point efficiency");
  }
  if ((season.ftPct ?? 100) < 68) {
    weaknesses.push("Free-throw consistency");
  }

  return {
    strengths: strengths.slice(0, 3),
    weaknesses: weaknesses.slice(0, 3),
  };
}

function buildRatingSummary(
  gameLog: PlayerProfileGameLogEntry[],
): PlayerProfileData["rating"] {
  const ratedGames = gameLog.filter(
    (entry) =>
      typeof entry.dynamicRating === "number" && Number.isFinite(entry.dynamicRating),
  );
  const seasonAverage = average(ratedGames.map((entry) => entry.dynamicRating));
  const recentAverage = average(
    ratedGames.slice(-5).map((entry) => entry.dynamicRating),
  );
  const bestGame = sortByValueDesc(ratedGames, (entry) => entry.dynamicRating)[0] ?? null;
  const worstGame =
    [...ratedGames].sort(
      (left, right) => (left.dynamicRating ?? 99) - (right.dynamicRating ?? 99),
    )[0] ?? null;
  const volatility = sampleStandardDeviation(
    ratedGames
      .map((entry) => entry.dynamicRating)
      .filter((value): value is number => typeof value === "number"),
  );

  const buildStretch = (windowSize: number, pick: "best" | "worst") => {
    if (ratedGames.length < windowSize) {
      return null;
    }
    let bestWindow: PlayerProfileRatingStretch | null = null;
    for (let index = 0; index <= ratedGames.length - windowSize; index += 1) {
      const windowGames = ratedGames.slice(index, index + windowSize);
      const avg = average(windowGames.map((entry) => entry.dynamicRating));
      if (avg === null) {
        continue;
      }
      const label = `${formatDateLabel(windowGames[0].date)} - ${formatDateLabel(
        windowGames[windowGames.length - 1].date,
      )}`;
      const candidate: PlayerProfileRatingStretch = {
        label,
        average: avg,
        gameIds: windowGames.map((entry) => entry.gameId),
      };
      if (!bestWindow) {
        bestWindow = candidate;
        continue;
      }
      const better =
        pick === "best"
          ? candidate.average > bestWindow.average
          : candidate.average < bestWindow.average;
      if (better) {
        bestWindow = candidate;
      }
    }
    return bestWindow;
  };

  const monthlyMap = new Map<string, number[]>();
  ratedGames.forEach((entry) => {
    const parsed = new Date(entry.date);
    if (Number.isNaN(parsed.getTime()) || entry.dynamicRating === null) {
      return;
    }
    const key = monthLabel(parsed);
    const bucket = monthlyMap.get(key) ?? [];
    bucket.push(entry.dynamicRating);
    monthlyMap.set(key, bucket);
  });

  const consistencyLabel =
    volatility === null
      ? null
      : volatility < 0.45
        ? "Elite consistency"
        : volatility < 0.8
          ? "Stable"
          : volatility < 1.15
            ? "Swingy"
            : "High volatility";

  return {
    currentAvailable:
      ratedGames[ratedGames.length - 1]?.dynamicRating ?? seasonAverage ?? null,
    seasonAverage,
    recentAverage,
    bestGameId: bestGame?.gameId ?? null,
    worstGameId: worstGame?.gameId ?? null,
    bestStretch: buildStretch(3, "best"),
    worstStretch: buildStretch(3, "worst"),
    consistencyLabel,
    volatility,
    monthly: [...monthlyMap.entries()].map(([label, values]) => ({
      label,
      average: average(values) ?? 0,
      games: values.length,
    })),
  };
}

function buildDerivedSplitGroup(
  title: string,
  rows: Array<{ label: string; entries: PlayerProfileGameLogEntry[] }>,
): PlayerProfileSplitGroup | null {
  const normalizedRows = rows
    .map(({ label, entries }) => {
      if (entries.length === 0) {
        return null;
      }
      const avgMinutes = average(entries.map((entry) => entry.minutes));
      const avgPoints = average(entries.map((entry) => entry.points));
      const avgRebounds = average(entries.map((entry) => entry.rebounds));
      const avgAssists = average(entries.map((entry) => entry.assists));
      const avgSteals = average(entries.map((entry) => entry.steals));
      const avgBlocks = average(entries.map((entry) => entry.blocks));
      const avgTurnovers = average(entries.map((entry) => entry.turnovers));
      const avgRating = average(entries.map((entry) => entry.dynamicRating));
      const fgMade = entries.reduce(
        (sum, entry) => sum + parseMadeAttempted(entry.fg).made,
        0,
      );
      const fgAttempted = entries.reduce(
        (sum, entry) => sum + parseMadeAttempted(entry.fg).attempted,
        0,
      );
      const threeMade = entries.reduce(
        (sum, entry) => sum + parseMadeAttempted(entry.threePt).made,
        0,
      );
      const threeAttempted = entries.reduce(
        (sum, entry) => sum + parseMadeAttempted(entry.threePt).attempted,
        0,
      );
      const ftMade = entries.reduce(
        (sum, entry) => sum + parseMadeAttempted(entry.ft).made,
        0,
      );
      const ftAttempted = entries.reduce(
        (sum, entry) => sum + parseMadeAttempted(entry.ft).attempted,
        0,
      );
      return {
        key: `${title}-${label}`.toLowerCase().replace(/\s+/g, "-"),
        label,
        games: entries.length,
        minutes: formatNumeric(avgMinutes),
        points: formatNumeric(avgPoints),
        rebounds: formatNumeric(avgRebounds),
        assists: formatNumeric(avgAssists),
        steals: formatNumeric(avgSteals),
        blocks: formatNumeric(avgBlocks),
        turnovers: formatNumeric(avgTurnovers),
        fgPct:
          fgAttempted > 0 ? formatPercentValue((fgMade / fgAttempted) * 100) : "-",
        threePct:
          threeAttempted > 0
            ? formatPercentValue((threeMade / threeAttempted) * 100)
            : "-",
        ftPct:
          ftAttempted > 0 ? formatPercentValue((ftMade / ftAttempted) * 100) : "-",
        rating: formatNumeric(avgRating),
      } satisfies PlayerProfileSplitRow;
    })
    .filter((row): row is PlayerProfileSplitRow => Boolean(row));

  if (normalizedRows.length === 0) {
    return null;
  }

  return {
    key: title.toLowerCase().replace(/\s+/g, "-"),
    title,
    source: "derived",
    rows: normalizedRows,
  };
}

function normalizeEspnSplitGroups(response: SplitsResponse): PlayerProfileSplitGroup[] {
  const globalNames = response.names ?? [];
  return (response.splitCategories ?? []).reduce<PlayerProfileSplitGroup[]>(
    (groups, category, categoryIndex) => {
      const rows = (category.splits ?? [])
        .slice(0, 8)
        .map((split, splitIndex) => {
          const values = statMap(globalNames, split.stats);
          const games = safeInteger(values.gamesPlayed) ?? 0;
          if (games <= 0) {
            return null;
          }
          return {
            key: `${categoryIndex}-${splitIndex}-${safeText(split.abbreviation, safeText(split.displayName, `${splitIndex}`))}`,
            label: safeText(split.displayName, safeText(split.abbreviation, "Split")),
            games,
            minutes: safeText(values.avgMinutes, "-"),
            points: safeText(values.avgPoints, "-"),
            rebounds: safeText(values.avgRebounds, "-"),
            assists: safeText(values.avgAssists, "-"),
            steals: safeText(values.avgSteals, "-"),
            blocks: safeText(values.avgBlocks, "-"),
            turnovers: safeText(values.avgTurnovers, "-"),
            fgPct: values.fieldGoalPct ? `${values.fieldGoalPct}%` : "-",
            threePct:
              values.threePointPct || values.threePointFieldGoalPct
                ? `${values.threePointPct ?? values.threePointFieldGoalPct}%`
                : "-",
            ftPct: values.freeThrowPct ? `${values.freeThrowPct}%` : "-",
            rating: "-",
          } satisfies PlayerProfileSplitRow;
        })
        .filter((row): row is PlayerProfileSplitRow => Boolean(row));

      if (rows.length > 0) {
        groups.push({
          key: `${safeText(category.displayName, category.name || `split-${categoryIndex}`)}-${categoryIndex}`
            .toLowerCase()
            .replace(/\s+/g, "-"),
          title: safeText(category.displayName, safeText(category.name, "Splits")),
          source: "espn",
          rows,
        });
      }

      return groups;
    },
    [],
  );
}

function buildDerivedSplitGroups(
  gameLog: PlayerProfileGameLogEntry[],
): PlayerProfileSplitGroup[] {
  const groups: PlayerProfileSplitGroup[] = [];

  const homeAway = buildDerivedSplitGroup("Home vs Away", [
    { label: "Home", entries: gameLog.filter((entry) => entry.location === "H") },
    { label: "Away", entries: gameLog.filter((entry) => entry.location === "A") },
  ]);
  if (homeAway) {
    groups.push(homeAway);
  }

  const results = buildDerivedSplitGroup("Wins vs Losses", [
    { label: "Wins", entries: gameLog.filter((entry) => entry.result === "W") },
    { label: "Losses", entries: gameLog.filter((entry) => entry.result === "L") },
  ]);
  if (results) {
    groups.push(results);
  }

  const recentWindows = buildDerivedSplitGroup("Trend Windows", [
    { label: "Last 5", entries: gameLog.slice(-5) },
    { label: "Last 10", entries: gameLog.slice(-10) },
  ]);
  if (recentWindows) {
    groups.push(recentWindows);
  }

  return groups;
}

function normalizeRotowireNote(
  rotowire: OverviewResponse["rotowire"],
): PlayerProfileNote | null {
  if (!rotowire) {
    return null;
  }
  const headline = safeText(rotowire.headline);
  const description = safeText(rotowire.story || rotowire.description);
  if (!headline && !description) {
    return null;
  }
  return {
    headline: headline || "Rotowire note",
    description: description || headline,
    published: safeText(rotowire.published),
  };
}

function normalizeNextGame(nextGame: OverviewResponse["nextGame"]): PlayerProfileNextGame | null {
  const event = nextGame?.league?.events?.[0];
  const competition = event?.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const opponent =
    competitors.find((entry) => entry.homeAway === "away")?.team ??
    competitors.find((entry) => entry.homeAway === "home")?.team;
  const gameId = safeText(event?.id);
  if (!gameId || !opponent) {
    return null;
  }

  return {
    gameId,
    date: safeText(event?.date),
    statusText:
      safeText(event?.status?.type?.shortDetail) ||
      safeText(event?.status?.type?.description) ||
      "Upcoming",
    opponentName:
      safeText(opponent.displayName) ||
      safeText(opponent.shortDisplayName) ||
      "Opponent",
    opponentAbbreviation: safeText(opponent.abbreviation, "OPP"),
    opponentLogo: safeText(opponent.logos?.[0]?.href, FALLBACK_IMAGE_URI),
  };
}

// The /stats response's teams dict is keyed by team SLUG and only has full
// names for schools the player actually has a statistics row for — exactly
// what's needed to resolve a past (non-current) season's school name, since
// the gamelog endpoint's per-event `team` object never carries a name for
// college. Keyed here by teamId (which per-game events DO carry) instead of
// slug for O(1) lookup from normalizeGameLog.
function buildTeamNameByTeamId(statsResponse: PlayerStatsResponse): Map<string, string> {
  const map = new Map<string, string>();
  const rows = statsResponse.categories?.[0]?.statistics ?? [];
  rows.forEach((row) => {
    const teamId = safeText(row.teamId);
    const teamSlug = safeText(row.teamSlug);
    const displayName = teamSlug ? safeText(statsResponse.teams?.[teamSlug]?.displayName) : "";
    if (teamId && displayName) {
      map.set(teamId, displayName);
    }
  });
  return map;
}

// One row per season+school the player has a statistics entry for — this is
// what makes a full multi-school career possible: the gamelog endpoint only
// ever returns a single season by default, but this tells us every OTHER
// season value to explicitly request (see getPlayerProfile). Capped to a
// sane number of seasons so a very long pro career can't fan out into an
// unbounded number of extra requests.
const MAX_CAREER_SEASONS_TO_FETCH = 8;
function getCareerSeasonYears(statsResponse: PlayerStatsResponse): number[] {
  const rows = statsResponse.categories?.[0]?.statistics ?? [];
  const years = [...new Set(rows.map((row) => row.season?.year).filter((year): year is number => typeof year === "number"))];
  years.sort((a, b) => b - a);
  return years.slice(0, MAX_CAREER_SEASONS_TO_FETCH);
}

function normalizeGameLog(
  response: GameLogResponse,
  mode: GameMode,
  teamNameByTeamId?: Map<string, string>,
): PlayerProfileGameLogEntry[] {
  const statBlock = response.statistics?.[0];
  const names = statBlock?.names ?? response.names ?? [];
  // The live endpoint doesn't actually return response.statistics — the
  // real per-game box-score stats are nested under
  // seasonTypes[].categories[].events[], flattened across every category
  // (regular season + any postseason) so nothing gets silently dropped.
  // Without this, every game's stats lookup missed and points/rebounds/
  // assists/etc all fell back to 0 despite the raw response having real data.
  const seasonTypeEvents = (response.seasonTypes ?? []).flatMap(
    (seasonType) =>
      (seasonType.categories ?? []).flatMap((category) => category.events ?? []),
  );
  const statsByEventId = new Map<string, string[]>(
    [...(statBlock?.events ?? []), ...seasonTypeEvents]
      .map((event) => {
        const eventId = safeText(event.eventId);
        return eventId ? ([eventId, event.stats ?? []] as const) : null;
      })
      .filter((row): row is readonly [string, string[]] => Boolean(row)),
  );

  return Object.values(response.events ?? {})
    .map((event) => {
      const gameId = safeText(event.id);
      if (!gameId) {
        return null;
      }
      const stats = statMap(names, statsByEventId.get(gameId));
      const location =
        event.atVs === "@"
          ? "A"
          : event.atVs?.toLowerCase() === "vs"
            ? "H"
            : "";
      const teamId = safeText(event.team?.id);
      const isHome =
        teamId && safeText(event.homeTeamId)
          ? teamId === safeText(event.homeTeamId)
          : location !== "A";
      const teamScore = isHome
        ? safeInteger(event.homeTeamScore)
        : safeInteger(event.awayTeamScore);
      const opponentScore = isHome
        ? safeInteger(event.awayTeamScore)
        : safeInteger(event.homeTeamScore);

      const fg = safeText(stats["fieldGoalsMade-fieldGoalsAttempted"], "0-0");
      const threePt = safeText(
        stats["threePointFieldGoalsMade-threePointFieldGoalsAttempted"],
        "0-0",
      );
      const ft = safeText(stats["freeThrowsMade-freeThrowsAttempted"], "0-0");
      const fgSplit = parseMadeAttempted(fg);
      const threeSplit = parseMadeAttempted(threePt);
      const ftSplit = parseMadeAttempted(ft);

      const entry: PlayerProfileGameLogEntry = {
        gameId,
        date: safeText(event.gameDate),
        location,
        result:
          safeText(event.gameResult) === "W"
            ? "W"
            : safeText(event.gameResult) === "L"
              ? "L"
              : "",
        finalScore: safeText(event.score, "-"),
        teamScore,
        opponentScore,
        opponent: {
          id: safeText(event.opponent?.id) || undefined,
          name: safeText(event.opponent?.displayName, "Opponent"),
          abbreviation: safeText(event.opponent?.abbreviation, "OPP"),
          // College nests a single `logo` string here rather than the
          // `logos` array other endpoints use — check both shapes.
          logo:
            safeText(event.opponent?.logo) ||
            safeText(event.opponent?.logos?.[0]?.href, FALLBACK_IMAGE_URI),
        },
        team: {
          id: teamId || undefined,
          // College's per-event `team` has no displayName/shortDisplayName
          // at all (only id/abbreviation/logo) — fall back to the school
          // name resolved from the /stats response's teamId -> name map
          // (needed anyway to know which school a past, non-current season
          // was played at), then the abbreviation, before "Team".
          name:
            safeText(event.team?.displayName) ||
            safeText(event.team?.shortDisplayName) ||
            (teamId ? teamNameByTeamId?.get(teamId) : undefined) ||
            safeText(event.team?.abbreviation) ||
            "Team",
          abbreviation: safeText(event.team?.abbreviation, "TM"),
          logo:
            safeText(event.team?.logo) ||
            safeText(event.team?.logos?.[0]?.href, FALLBACK_IMAGE_URI),
        },
        minutes: safeNumber(stats.minutes) ?? 0,
        minutesDisplay: safeText(stats.minutes, "0"),
        points: safeInteger(stats.points) ?? 0,
        rebounds: safeInteger(stats.totalRebounds) ?? 0,
        offensiveRebounds: safeInteger(stats.offensiveRebounds) ?? 0,
        defensiveRebounds:
          safeInteger(stats.defensiveRebounds) ??
          Math.max(
            0,
            (safeInteger(stats.totalRebounds) ?? 0) -
              (safeInteger(stats.offensiveRebounds) ?? 0),
          ),
        assists: safeInteger(stats.assists) ?? 0,
        steals: safeInteger(stats.steals) ?? 0,
        blocks: safeInteger(stats.blocks) ?? 0,
        turnovers: safeInteger(stats.turnovers) ?? 0,
        fouls: safeInteger(stats.fouls) ?? 0,
        fg,
        threePt,
        ft,
        fgPct:
          safePercent(stats.fieldGoalPct) ??
          (fgSplit.attempted > 0 ? (fgSplit.made / fgSplit.attempted) * 100 : null),
        threePct:
          safePercent(stats.threePointPct ?? stats.threePointFieldGoalPct) ??
          (threeSplit.attempted > 0
            ? (threeSplit.made / threeSplit.attempted) * 100
            : null),
        ftPct:
          safePercent(stats.freeThrowPct) ??
          (ftSplit.attempted > 0 ? (ftSplit.made / ftSplit.attempted) * 100 : null),
        plusMinus: null,
        dynamicRating: null,
        ratingRawImpact: null,
        eventNote: safeText(event.eventNote) || null,
        ratingTimelinePoints: [],
      };

      const hasBoxActivity =
        entry.minutes > 0 ||
        entry.points > 0 ||
        entry.rebounds > 0 ||
        entry.assists > 0 ||
        entry.steals > 0 ||
        entry.blocks > 0 ||
        entry.turnovers > 0 ||
        entry.fouls > 0 ||
        fgSplit.attempted > 0 ||
        ftSplit.attempted > 0;

      if (hasBoxActivity) {
        const impact = computeImpactFromBox(
          toPlayerBox(entry),
          buildFinalGameContext(mode, entry.location, teamScore, opponentScore),
        );
        entry.dynamicRating = impact.rating;
        entry.ratingRawImpact = impact.rawImpact;
      }

      return entry;
    })
    .filter((entry): entry is PlayerProfileGameLogEntry => Boolean(entry))
    .sort((left, right) => {
      const leftTime = new Date(left.date).getTime();
      const rightTime = new Date(right.date).getTime();
      return leftTime - rightTime;
    });
}

export async function getPlayerProfile(
  mode: GameMode,
  playerId: string,
  seed: PlayerIdentitySeed = {},
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): Promise<PlayerProfileData> {
  const [base, overview, statsResponse, gameLogResponse, splitsResponse] =
    await Promise.all([
      fetchPlayerJson<PlayerApiResponse>(mode, proLeague, playerId, "", PLAYER_CORE_TTL_MS),
      fetchPlayerJson<OverviewResponse>(mode, proLeague, playerId, "overview", PLAYER_CORE_TTL_MS),
      fetchPlayerJson<PlayerStatsResponse>(mode, proLeague, playerId, "stats", PLAYER_DETAIL_TTL_MS),
      fetchPlayerJson<GameLogResponse>(mode, proLeague, playerId, "gamelog", PLAYER_DETAIL_TTL_MS),
      fetchPlayerJson<SplitsResponse>(mode, proLeague, playerId, "splits", PLAYER_DETAIL_TTL_MS),
    ]);

  const athlete = base.athlete;
  const playerTeamId = safeText(athlete?.team?.id, safeText(seed.teamId));
  const playerTeamName =
    safeText(athlete?.team?.displayName) ||
    safeText(seed.teamName) ||
    "Team";
  const playerTeamShortName =
    safeText(athlete?.team?.shortDisplayName) ||
    safeText(seed.teamName) ||
    playerTeamName;
  const playerTeamLogo =
    pickLogo(athlete?.team?.logos, safeText(seed.teamLogo, FALLBACK_IMAGE_URI));
  const playerTeamRecord = safeText(seed.teamRecord) || null;
  const conferenceName = safeText(seed.conferenceName) || null;

  let teamSummary: TeamSummary | null = null;
  let teamPlayerStat: TeamPlayerStats | null = null;
  let teammateRanks = {
    dynamicRating: null as number | null,
    scoring: null as number | null,
    minutes: null as number | null,
    usage: null as number | null,
  };

  if (playerTeamId) {
    const [teamSummaryResult, teamPlayerStatsResult] = await Promise.allSettled([
      getTeamSummary(mode, playerTeamId, DEFAULT_SEASON, proLeague),
      getTeamPlayerStats(mode, playerTeamId, DEFAULT_SEASON, proLeague),
    ]);

    if (teamSummaryResult.status === "fulfilled") {
      teamSummary = teamSummaryResult.value;
    }

    if (teamPlayerStatsResult.status === "fulfilled") {
      // The college path routes through our own backend (see
      // src/features/cbb/teamApi.ts) rather than ESPN directly, so a
      // fulfilled promise doesn't guarantee an array — an error payload or
      // empty-object response for a team the backend doesn't have indexed
      // would otherwise reach .find()/sort() below and crash. The WNBA/NBA
      // path never hits this because it synthesizes stats client-side from
      // the roster response, which is always an array.
      const teamPlayerStatsRows = Array.isArray(teamPlayerStatsResult.value)
        ? teamPlayerStatsResult.value
        : [];
      teamPlayerStat =
        teamPlayerStatsRows.find((row) => row.playerId === playerId) ?? null;
      teammateRanks = {
        dynamicRating: findRank(
          teamPlayerStatsRows,
          (row) => row.playerId === playerId,
          (row) => row.seasonRating10,
        ),
        scoring: findRank(
          teamPlayerStatsRows,
          (row) => row.playerId === playerId,
          (row) => row.perGame.points,
        ),
        minutes: findRank(
          teamPlayerStatsRows,
          (row) => row.playerId === playerId,
          (row) => row.perGame.minutes,
        ),
        usage: findRank(
          teamPlayerStatsRows,
          (row) => row.playerId === playerId,
          (row) => row.usage,
        ),
      };
    }
  }

  // Full-career, multi-school support: the gamelog endpoint only ever
  // returns ONE season (whichever the athlete's default/current season is)
  // — it does not, by itself, span a transfer history. The /stats response
  // does list every season+school the player has a statistics row for, so
  // fetch each OTHER season's gamelog explicitly and merge them all into one
  // chronological game log. A season a player didn't play (redshirt, injury)
  // simply won't appear in careerSeasonYears, so nothing to fetch for it.
  const teamNameByTeamId = buildTeamNameByTeamId(statsResponse);
  const currentGameLogSeasonYear = Number.parseInt(
    gameLogResponse.filters?.find((filter) => filter.name === "season")?.value ?? "",
    10,
  );
  const careerSeasonYears = getCareerSeasonYears(statsResponse);
  const otherSeasonYears = careerSeasonYears.filter(
    (year) => year !== currentGameLogSeasonYear,
  );
  const otherSeasonGameLogResponses = await Promise.all(
    otherSeasonYears.map((year) =>
      fetchPlayerJson<GameLogResponse>(
        mode,
        proLeague,
        playerId,
        "gamelog",
        PLAYER_DETAIL_TTL_MS,
        year,
      ).catch(() => null),
    ),
  );

  const averagesCategory =
    statsResponse.categories?.find((category) => category.name === "averages") ??
    statsResponse.categories?.[0];
  const totalsCategory =
    statsResponse.categories?.find((category) => category.name === "totals") ??
    statsResponse.categories?.[1];
  const miscCategory =
    statsResponse.categories?.find((category) => category.name === "miscellaneous") ??
    statsResponse.categories?.[2];
  const latestAveragesRow = pickLatestSeasonRow(averagesCategory);
  const latestTotalsRow = pickLatestSeasonRow(totalsCategory);
  const latestMiscRow = pickLatestSeasonRow(miscCategory);
  const averages = statMap(averagesCategory?.names, latestAveragesRow?.stats);
  const totals = statMap(totalsCategory?.names, latestTotalsRow?.stats);
  const misc = statMap(miscCategory?.names, latestMiscRow?.stats);
  const allSeasonGameLogEntries = [gameLogResponse, ...otherSeasonGameLogResponses]
    .filter((response): response is GameLogResponse => Boolean(response))
    .flatMap((response) => normalizeGameLog(response, mode, teamNameByTeamId));
  // Dedupe by gameId (in case a season boundary ever double-reports a game)
  // and re-sort chronologically now that entries from several separately-
  // fetched seasons have been merged together.
  const normalizedGameLog = [
    ...new Map(allSeasonGameLogEntries.map((entry) => [entry.gameId, entry])).values(),
  ].sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
  const playerDisplayName =
    safeText(athlete?.displayName) ||
    safeText(athlete?.fullName) ||
    safeText(seed.playerName);
  const gameLog = await enrichGameLogWithHistoricalGraphs(
    mode,
    proLeague,
    playerId,
    playerDisplayName,
    normalizedGameLog,
  );
  const wins = gameLog.filter((entry) => entry.result === "W").length;
  const losses = gameLog.filter((entry) => entry.result === "L").length;
  const rating = buildRatingSummary(gameLog);
  const seasonLabel =
    safeText(latestAveragesRow?.season?.displayName) ||
    safeText(latestTotalsRow?.season?.displayName) ||
    safeText(base.season?.displayName) ||
    `${DEFAULT_SEASON}`;
  const seasonTables = buildSeasonSummaryTables(
    averages,
    totals,
    misc,
    rating.seasonAverage,
    rating.recentAverage,
    teamPlayerStat,
  );

  const season: PlayerProfileData["season"] = {
    label: seasonLabel,
    gamesPlayed: safeInteger(averages.gamesPlayed ?? totals.gamesPlayed) ?? gameLog.length,
    gamesStarted: safeInteger(averages.gamesStarted ?? totals.gamesStarted),
    minutesPerGame: safeNumber(averages.avgMinutes),
    pointsPerGame: safeNumber(averages.avgPoints),
    reboundsPerGame: safeNumber(averages.avgRebounds),
    assistsPerGame: safeNumber(averages.avgAssists),
    stealsPerGame: safeNumber(averages.avgSteals),
    blocksPerGame: safeNumber(averages.avgBlocks),
    turnoversPerGame: safeNumber(averages.avgTurnovers),
    foulsPerGame: safeNumber(averages.avgFouls),
    fgPct: safePercent(averages.fieldGoalPct),
    threePct: safePercent(averages.threePointPct ?? averages.threePointFieldGoalPct),
    ftPct: safePercent(averages.freeThrowPct),
    teamRecordWhenPlayerAppeared:
      wins > 0 || losses > 0 ? formatRecord(wins, losses) : null,
    averages: seasonTables.averagesTable,
    totals: seasonTables.totalsTable,
    shooting: seasonTables.shootingTable,
    advanced: seasonTables.advancedTable,
    misc: seasonTables.miscTable,
  };

  const { strengths, weaknesses } = buildStrengthsAndWeaknesses(season);
  const notes: string[] = [];
  if (
    season.teamRecordWhenPlayerAppeared &&
    season.teamRecordWhenPlayerAppeared !== "0-0"
  ) {
    notes.push(`Team record in games played: ${season.teamRecordWhenPlayerAppeared}.`);
  }
  if (
    rating.recentAverage !== null &&
    rating.seasonAverage !== null &&
    rating.recentAverage - rating.seasonAverage >= 0.4
  ) {
    notes.push("Recent dynamic rating trend is running above season level.");
  }
  if (
    rating.recentAverage !== null &&
    rating.seasonAverage !== null &&
    rating.seasonAverage - rating.recentAverage >= 0.4
  ) {
    notes.push("Recent form has dipped below the season baseline.");
  }
  if (rating.bestStretch) {
    notes.push(
      `Best three-game stretch: ${rating.bestStretch.average.toFixed(1)} (${rating.bestStretch.label}).`,
    );
  }

  const splitGroups = [
    ...buildDerivedSplitGroups(gameLog),
    ...normalizeEspnSplitGroups(splitsResponse),
  ].slice(0, 8);
  const news = dedupeNews([
    ...normalizeNews(base.news),
    ...normalizeNews(overview.news),
  ]).slice(0, 10);

  return {
    player: {
      id: safeText(athlete?.id, playerId),
      firstName: safeText(athlete?.firstName),
      lastName: safeText(athlete?.lastName),
      fullName:
        safeText(athlete?.fullName) ||
        safeText(athlete?.displayName) ||
        safeText(seed.playerName, "Player"),
      headshot: safeText(athlete?.headshot?.href, safeText(seed.headshot, FALLBACK_IMAGE_URI)),
      jersey:
        safeText(athlete?.displayJersey) ||
        safeText(athlete?.jersey) ||
        safeText(seed.jersey, "-"),
      position:
        safeText(athlete?.position?.abbreviation) ||
        safeText(seed.position, "-"),
      active: Boolean(athlete?.active),
      status:
        safeText(athlete?.status?.name) ||
        safeText(athlete?.status?.abbreviation) ||
        null,
      statsSummary: safeText(athlete?.statsSummary) || null,
      displayHeight: safeText(athlete?.displayHeight) || null,
      displayWeight: safeText(athlete?.displayWeight) || null,
      displayDOB: safeText(athlete?.displayDOB) || null,
      age:
        athlete?.age != null && Number.isFinite(athlete.age)
          ? `${athlete.age}`
          : null,
      birthPlace: safeText(athlete?.displayBirthPlace) || null,
      experience: safeText(athlete?.displayExperience) || null,
      draft: safeText(athlete?.displayDraft) || null,
      debutYear:
        typeof athlete?.debutYear === "number" && Number.isFinite(athlete.debutYear)
          ? athlete.debutYear
          : null,
      college:
        safeText(athlete?.college?.name) ||
        safeText(athlete?.college?.shortName) ||
        null,
      flagHref: safeText(athlete?.flag?.href) || null,
      team: {
        id: playerTeamId || undefined,
        name: playerTeamName,
        shortName: playerTeamShortName,
        abbreviation: safeText(athlete?.team?.abbreviation, playerTeamShortName),
        logo: teamSummary?.logo || playerTeamLogo,
        record: teamSummary?.record || playerTeamRecord,
        conferenceName: teamSummary?.conference || conferenceName,
        color: safeText(athlete?.team?.color) || teamSummary?.color || null,
        alternateColor:
          safeText(athlete?.team?.alternateColor) ||
          teamSummary?.alternateColor ||
          null,
      },
    },
    season,
    rating,
    gameLog,
    splitGroups,
    strengths,
    weaknesses,
    notes,
    news,
    rotowireNote: normalizeRotowireNote(overview.rotowire),
    nextGame: normalizeNextGame(overview.nextGame),
    teamSummary,
    teamPlayerStat,
    teammateRanks,
  };
}

export async function getPlayerRecentAverageRating(
  mode: GameMode,
  playerId: string,
  sampleSize = 5,
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): Promise<number | null> {
  const safeSampleSize = Math.max(1, Math.min(10, Math.floor(sampleSize)));
  const gameLogResponse = await fetchPlayerJson<GameLogResponse>(
    mode,
    proLeague,
    playerId,
    "gamelog",
    PLAYER_DETAIL_TTL_MS,
  );
  const normalizedGameLog = normalizeGameLog(gameLogResponse, mode);
  const recentGames = [...normalizedGameLog]
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    .slice(0, safeSampleSize);
  const values = recentGames
    .map((entry) => entry.dynamicRating)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type PlayerSeasonRatingGame = {
  gameId: string;
  date: string;
  location: PlayerProfileGameLogEntry["location"];
  opponentAbbreviation: string;
  /** This game's Impact Rating (0-10). */
  rating: number;
  /** Season-average Impact Rating INCLUDING this game (the rolling trend). */
  rollingAverage: number;
};

export type PlayerSeasonRatingSeries = {
  playerId: string;
  /** Season-average Impact Rating across every rated game. */
  seasonAverage: number | null;
  /** Rolling season average as of the most recent game (=== seasonAverage). */
  currentTrendRating: number | null;
  /** The single most recent game's Impact Rating. */
  latestGameRating: number | null;
  games: PlayerSeasonRatingGame[];
};

/**
 * The player's season Impact Rating trend, oldest game first, with the rolling
 * season average after each game.
 *
 * This is deliberately a thin projection of the SAME pipeline the player
 * profile screen uses (`normalizeGameLog` -> `computeImpactFromBox`), not a
 * second rating model — callers that need a season-long rating series (e.g.
 * the Stock Market section's season pricing) read it from here so there is
 * exactly one Impact Rating definition in the app.
 */
export async function getPlayerSeasonRatingSeries(
  mode: GameMode,
  playerId: string,
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): Promise<PlayerSeasonRatingSeries> {
  const gameLogResponse = await fetchPlayerJson<GameLogResponse>(
    mode,
    proLeague,
    playerId,
    "gamelog",
    PLAYER_DETAIL_TTL_MS,
  );
  // normalizeGameLog already returns oldest-first.
  const ratedGames = normalizeGameLog(gameLogResponse, mode).filter(
    (entry): entry is PlayerProfileGameLogEntry & { dynamicRating: number } =>
      typeof entry.dynamicRating === "number" && Number.isFinite(entry.dynamicRating),
  );

  let runningTotal = 0;
  const games: PlayerSeasonRatingGame[] = ratedGames.map((entry, index) => {
    runningTotal += entry.dynamicRating;
    return {
      gameId: entry.gameId,
      date: entry.date,
      location: entry.location,
      opponentAbbreviation: entry.opponent.abbreviation,
      rating: entry.dynamicRating,
      rollingAverage: runningTotal / (index + 1),
    };
  });

  const seasonAverage = games.length > 0 ? runningTotal / games.length : null;

  return {
    playerId,
    seasonAverage,
    currentTrendRating: games[games.length - 1]?.rollingAverage ?? null,
    latestGameRating: games[games.length - 1]?.rating ?? null,
    games,
  };
}
