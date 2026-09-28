import express from 'express';
import cors from 'cors';
import os from 'os';

import { config } from './config.js';
import { db } from './db.js';
import {
  computeClv,
  computeEvRanked,
  computeTopMarketEv,
  createBet,
  createFliffLine,
  getEventOdds,
  getWatchlist,
  listBets,
  listFliffLines,
  listGamesForDate,
  listSports,
  setBetResult,
  setWatchlist,
} from './services/bettingService.js';
import { buildGameUrl, buildTodayScoreboardUrl, fetchEspnJson } from './services/cbbEspn.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const start = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[api] -> ${req.method} ${req.originalUrl}`);
  res.on('finish', () => {
    // eslint-disable-next-line no-console
    console.log(
      `[api] <- ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`,
    );
  });
  next();
});

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const liveGamesCache = new Map<string, CacheEntry<unknown>>();
const todayGamesCache = new Map<string, CacheEntry<unknown>>();
const liveGameByIdCache = new Map<string, CacheEntry<unknown>>();
const teamSearchCache = new Map<string, CacheEntry<unknown>>();
const teamDirectoryCache = new Map<string, CacheEntry<unknown>>();
const teamConferenceCache = new Map<string, CacheEntry<unknown>>();
const ESPN_SITE_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';

type TeamConference = {
  id?: string;
  name?: string;
  shortName?: string;
} | null;

function getTodayDateYYYYMMDD(now = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}${month}${day}`;
}

function normalizeDateYYYYMMDD(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }
  const cleaned = raw.trim();
  if (/^\d{8}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned.replace(/-/g, '');
  }
  return null;
}

async function withCache<T>(
  cache: Map<string, CacheEntry<unknown>>,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.value as T;
  }
  const value = await loader();
  cache.set(key, {
    expiresAt: now + ttlMs,
    value,
  });
  return value;
}

function normalizeSearchQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildTeamsDirectoryUrl(page: number, limit = 200): string {
  return `${ESPN_SITE_BASE}/teams?limit=${limit}&page=${page}`;
}

function teamSummaryUrl(teamId: string): string {
  return `${ESPN_SITE_BASE}/teams/${encodeURIComponent(teamId)}?enable=groups`;
}

type TeamSearchResult = {
  teamId: string;
  name: string;
  shortName: string;
  abbreviation: string;
  logo: string | null;
  conference: string | null;
};

type BettingTeamMatchInput = {
  displayName?: string;
  shortDisplayName?: string;
  abbreviation?: string;
};

type NormalizedBettingGame = {
  eventId: string;
  sportKey: string;
  homeTeam?: string;
  awayTeam?: string;
  commenceTime?: string;
};

type BettingMatchCandidate = {
  event: NormalizedBettingGame;
  score: number;
};

const TEAM_ALIAS_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bhawai i\b/g, 'hawaii'],
  [/\bhawai\b/g, 'hawaii'],
  [/\bole miss\b/g, 'mississippi'],
  [/\buconn\b/g, 'connecticut'],
  [/\bunc\b/g, 'north carolina'],
  [/\bumkc\b/g, 'kansas city'],
  [/\bse louisiana\b/g, 'southeastern louisiana'],
  [/\bucf\b/g, 'central florida'],
  [/\bunlv\b/g, 'nevada las vegas'],
  [/\bbyu\b/g, 'brigham young'],
  [/\blsu\b/g, 'louisiana state'],
  [/\bcal state\b/g, 'csu'],
  [/\bcsu\b/g, 'cal state'],
  [/\bcal baptist\b/g, 'california baptist'],
  [/\bst johns\b/g, 'saint johns'],
  [/\bst marys\b/g, 'saint marys'],
  [/\bst thomas\b/g, 'saint thomas'],
  [/\bstate\b/g, 'st'],
];

function teamSearchScore(team: TeamSearchResult, normalizedQuery: string): number {
  const fields = [team.name, team.shortName, team.abbreviation]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  if (fields.includes(normalizedQuery)) {
    return 100;
  }
  if (fields.some((value) => value.startsWith(normalizedQuery))) {
    return 75;
  }
  if (fields.some((value) => value.includes(normalizedQuery))) {
    return 50;
  }
  return 0;
}

async function getTeamDirectory(): Promise<TeamSearchResult[]> {
  return withCache(teamDirectoryCache, 'cbb-team-directory', 1000 * 60 * 60 * 6, async () => {
    const allTeams: TeamSearchResult[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const json = await fetchEspnJson<{ sports?: Array<{ leagues?: Array<{ teams?: Array<{ team?: any }> }> }> }>(
        buildTeamsDirectoryUrl(page),
      );
      const teams = json.sports?.[0]?.leagues?.[0]?.teams ?? [];
      teams.forEach((entry: { team?: Record<string, unknown> }) => {
        const team = entry?.team;
        const teamId = asString(team?.id);
        if (!teamId) {
          return;
        }
        allTeams.push({
          teamId,
          name: asString(team?.displayName, `${asString(team?.location)} ${asString(team?.name)}`.trim() || 'Team'),
          shortName: asString(team?.shortDisplayName, asString(team?.displayName, 'Team')),
          abbreviation: asString(team?.abbreviation),
          logo: asString(team?.logos?.[0]?.href) || null,
          conference: null,
        });
      });
      if (teams.length < 200) {
        break;
      }
    }
    return allTeams.sort((a, b) => a.name.localeCompare(b.name));
  });
}

async function searchTeamsDirectory(query: string, limit: number): Promise<TeamSearchResult[]> {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return [];
  }
  const cacheKey = `team-search:${normalized}:${limit}`;
  return withCache(teamSearchCache, cacheKey, 1000 * 60 * 10, async () => {
    const directory = await getTeamDirectory();
    return directory
      .map((team) => ({
        team,
        score: teamSearchScore(team, normalized),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.team.name.localeCompare(b.team.name))
      .slice(0, limit)
      .map((entry) => entry.team);
  });
}

function formatDateYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateCandidatesForBetting(startDateIso: string | undefined): string[] {
  if (!startDateIso) {
    return [formatDateYYYYMMDD(new Date())];
  }

  const parsed = new Date(startDateIso);
  if (Number.isNaN(parsed.getTime())) {
    return [formatDateYYYYMMDD(new Date())];
  }

  return [-1, 0, 1].map((offset) => {
    const candidate = new Date(parsed);
    candidate.setDate(candidate.getDate() + offset);
    return formatDateYYYYMMDD(candidate);
  });
}

function normalizeTeamNameForBetting(value: string | undefined): string {
  const initial = (value ?? '')
    .toLowerCase()
    .replace(/#[0-9]+/g, '')
    .replace(/[\u2019']/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(university|college)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!initial) {
    return '';
  }

  return TEAM_ALIAS_REPLACEMENTS.reduce((current, [pattern, replacement]) => {
    return current.replace(pattern, replacement).replace(/\s+/g, ' ').trim();
  }, initial);
}

function buildTeamNameVariants(team: BettingTeamMatchInput): string[] {
  const rawNames = [team.displayName, team.shortDisplayName, team.abbreviation].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  const variants = new Set<string>();

  rawNames.forEach((name) => {
    const normalized = normalizeTeamNameForBetting(name);
    if (!normalized) {
      return;
    }

    variants.add(normalized);

    const tokens = normalized.split(' ').filter(Boolean);
    if (tokens.length > 1) {
      variants.add(tokens.slice(0, -1).join(' '));
      variants.add(tokens[0]);
    }

    if (normalized.includes(' saint ')) {
      variants.add(normalized.replace(/\bsaint\b/g, 'st'));
    }
    if (normalized.includes(' st ')) {
      variants.add(normalized.replace(/\bst\b/g, 'saint'));
    }
    if (normalized.includes(' cal state ')) {
      variants.add(normalized.replace(/\bcal state\b/g, 'csu'));
    }
    if (normalized.includes(' csu ')) {
      variants.add(normalized.replace(/\bcsu\b/g, 'cal state'));
    }
  });

  return [...variants].filter((value) => value.length > 0);
}

function bestBettingNameScore(leftNames: string[], rightNames: string[]): number {
  let bestScore = 0;

  leftNames.forEach((left) => {
    rightNames.forEach((right) => {
      if (!left || !right) {
        return;
      }

      if (left === right) {
        bestScore = Math.max(bestScore, 100);
        return;
      }

      if (left.includes(right) || right.includes(left)) {
        bestScore = Math.max(bestScore, 78);
        return;
      }

      const leftTokens = new Set(left.split(' ').filter(Boolean));
      const rightTokens = new Set(right.split(' ').filter(Boolean));
      const overlap = [...leftTokens].filter((token) => rightTokens.has(token));

      if (overlap.length >= 2) {
        bestScore = Math.max(bestScore, 60 + overlap.length * 6);
        return;
      }

      if (
        overlap.length === 1 &&
        overlap[0] !== undefined &&
        overlap[0].length >= 5 &&
        (leftTokens.size <= 2 || rightTokens.size <= 2)
      ) {
        bestScore = Math.max(bestScore, 58);
      }
    });
  });

  return bestScore;
}

function bettingTimeScore(commenceTime: string | undefined, targetStartDateTime: string | undefined): number {
  if (!commenceTime || !targetStartDateTime) {
    return 0;
  }

  const commence = Date.parse(commenceTime);
  const target = Date.parse(targetStartDateTime);
  if (!Number.isFinite(commence) || !Number.isFinite(target)) {
    return 0;
  }

  const diffHours = Math.abs(commence - target) / (1000 * 60 * 60);
  if (diffHours <= 0.5) return 18;
  if (diffHours <= 2) return 14;
  if (diffHours <= 6) return 10;
  if (diffHours <= 12) return 6;
  if (diffHours <= 24) return 2;
  return 0;
}

function scoreBettingEventMatch(params: {
  event: NormalizedBettingGame;
  homeTeam: BettingTeamMatchInput;
  awayTeam: BettingTeamMatchInput;
  startDateTime?: string;
  reversed?: boolean;
}): number {
  const { event, homeTeam, awayTeam, startDateTime, reversed = false } = params;
  const homeInput = reversed ? awayTeam : homeTeam;
  const awayInput = reversed ? homeTeam : awayTeam;

  const eventHomeNames = buildTeamNameVariants({
    displayName: event.homeTeam,
    shortDisplayName: event.homeTeam,
  });
  const eventAwayNames = buildTeamNameVariants({
    displayName: event.awayTeam,
    shortDisplayName: event.awayTeam,
  });
  const appHomeNames = buildTeamNameVariants(homeInput);
  const appAwayNames = buildTeamNameVariants(awayInput);

  const homeScore = bestBettingNameScore(appHomeNames, eventHomeNames);
  const awayScore = bestBettingNameScore(appAwayNames, eventAwayNames);

  if (homeScore < 58 || awayScore < 58) {
    return 0;
  }

  return homeScore + awayScore + bettingTimeScore(event.commenceTime, startDateTime) - (reversed ? 4 : 0);
}

function findBettingEventMatch(
  games: NormalizedBettingGame[],
  input: {
    homeTeam: BettingTeamMatchInput;
    awayTeam: BettingTeamMatchInput;
    startDateTime?: string;
  },
): NormalizedBettingGame | null {
  const candidates: BettingMatchCandidate[] = [];

  games.forEach((event) => {
    const directScore = scoreBettingEventMatch({
      event,
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
      startDateTime: input.startDateTime,
    });
    if (directScore > 0) {
      candidates.push({ event, score: directScore });
    }

    const reversedScore = scoreBettingEventMatch({
      event,
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
      startDateTime: input.startDateTime,
      reversed: true,
    });
    if (reversedScore > 0) {
      candidates.push({ event, score: reversedScore });
    }
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.score >= 118 ? candidates[0].event : null;
}

function normalizeBettingGame(raw: Record<string, unknown>, sportKey: string): NormalizedBettingGame {
  return {
    eventId: asString(raw.eventId, asString(raw.id)),
    sportKey: asString(raw.sportKey, asString(raw.sport_key, sportKey)),
    homeTeam: asString(raw.homeTeam, asString(raw.home_team)),
    awayTeam: asString(raw.awayTeam, asString(raw.away_team)),
    commenceTime: asString(raw.commenceTime, asString(raw.commence_time)),
  };
}

function americanOddsToProbability(odds: number): number | null {
  if (!Number.isFinite(odds) || odds === 0) {
    return null;
  }
  if (odds > 0) {
    return 100 / (odds + 100);
  }
  const absoluteOdds = Math.abs(odds);
  return absoluteOdds / (absoluteOdds + 100);
}

function normalizeOddsName(value: unknown): string {
  return asString(value).trim().toLowerCase();
}

function buildMatchedOddsWinProbability(
  odds: Record<string, unknown> | null,
): { homeWinProb: number; awayWinProb: number } | null {
  if (!odds) {
    return null;
  }

  const homeTeam = normalizeOddsName(odds.home_team ?? odds.homeTeam);
  const awayTeam = normalizeOddsName(odds.away_team ?? odds.awayTeam);
  const bookmakers = Array.isArray(odds.bookmakers) ? odds.bookmakers : [];
  const pinnacleBook = bookmakers.find(
    (book) =>
      normalizeOddsName((book as { key?: unknown; title?: unknown }).key) === 'pinnacle' ||
      normalizeOddsName((book as { key?: unknown; title?: unknown }).title) === 'pinnacle',
  ) as { markets?: Array<{ key?: unknown; outcomes?: Array<{ name?: unknown; price?: unknown }> }> } | undefined;

  const h2hMarket = pinnacleBook?.markets?.find(
    (market) => normalizeOddsName(market.key) === 'h2h',
  );
  if (!h2hMarket?.outcomes?.length || !homeTeam || !awayTeam) {
    return null;
  }

  const homeOutcome = h2hMarket.outcomes.find(
    (outcome) => normalizeOddsName(outcome.name) === homeTeam,
  );
  const awayOutcome = h2hMarket.outcomes.find(
    (outcome) => normalizeOddsName(outcome.name) === awayTeam,
  );
  const homeRawProb = americanOddsToProbability(Number(homeOutcome?.price));
  const awayRawProb = americanOddsToProbability(Number(awayOutcome?.price));

  if (homeRawProb === null || awayRawProb === null) {
    return null;
  }

  const total = homeRawProb + awayRawProb;
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }

  return {
    homeWinProb: homeRawProb / total,
    awayWinProb: awayRawProb / total,
  };
}

function findCachedBettingEvent(
  sportKey: string,
  input: {
    homeTeam: BettingTeamMatchInput;
    awayTeam: BettingTeamMatchInput;
    startDateTime?: string;
  },
): NormalizedBettingGame | null {
  const dates = dateCandidatesForBetting(input.startDateTime);
  const placeholders = dates.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, sportKey, commenceTime, homeTeam, awayTeam
       FROM events
       WHERE sportKey = ?
         AND substr(commenceTime, 1, 10) IN (${placeholders})
       ORDER BY lastSeenAt DESC
       LIMIT 100`,
    )
    .all(sportKey, ...dates) as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    return null;
  }

  return findBettingEventMatch(
    rows.map((row) => normalizeBettingGame(row, sportKey)).filter((row) => row.eventId),
    input,
  );
}

type ScoreboardCompetitor = {
  homeAway?: 'home' | 'away';
  score?: string;
  team?: {
    id?: string;
    conferenceId?: string;
    displayName?: string;
    shortDisplayName?: string;
    logo?: string;
  };
};

type ScoreboardEvent = {
  id?: string;
  date?: string;
  competitions?: Array<{
    competitors?: ScoreboardCompetitor[];
    venue?: {
      fullName?: string;
    };
    groups?: {
      id?: string;
      name?: string;
      shortName?: string;
      isConference?: boolean;
    };
    status?: {
      displayClock?: string;
      period?: number;
      type?: {
        state?: string;
        description?: string;
        shortDetail?: string;
        detail?: string;
        completed?: boolean;
      };
    };
  }>;
  status?: {
    displayClock?: string;
    period?: number;
    type?: {
      state?: string;
      description?: string;
      shortDetail?: string;
      detail?: string;
      completed?: boolean;
    };
  };
};

type ScoreboardResponse = {
  events?: ScoreboardEvent[];
};

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function mapConference(group?: {
  id?: string;
  name?: string;
  shortName?: string;
} | null): TeamConference {
  const shortName = asString(group?.shortName, asString(group?.name));
  if (!shortName) {
    return null;
  }

  return {
    id: asString(group?.id) || undefined,
    name: asString(group?.name, shortName) || undefined,
    shortName,
  };
}

async function getTeamConference(teamId: string): Promise<TeamConference> {
  if (!teamId) {
    return null;
  }

  return withCache(teamConferenceCache, `team-conference:${teamId}`, 1000 * 60 * 60 * 6, async () => {
    try {
      const summary = await fetchEspnJson<{ team?: { groups?: { id?: string; name?: string; shortName?: string; parent?: { id?: string; name?: string; shortName?: string } } } }>(
        teamSummaryUrl(teamId),
      );
      const group = summary.team?.groups;
      return (
        mapConference(group) ??
        mapConference(group?.parent) ??
        null
      );
    } catch {
      return null;
    }
  });
}

async function resolveCompetitorConference(
  competitor: ScoreboardCompetitor | undefined,
  competitionGroup: {
    id?: string;
    name?: string;
    shortName?: string;
    isConference?: boolean;
  } | undefined,
): Promise<TeamConference> {
  const fallbackConference =
    competitionGroup?.isConference &&
    asString(competitionGroup.id) === asString(competitor?.team?.conferenceId)
      ? mapConference(competitionGroup)
      : null;

  const fetchedConference = await getTeamConference(asString(competitor?.team?.id));
  return fetchedConference ?? fallbackConference;
}

async function mapLiveGame(event: ScoreboardEvent) {
  const competition = event.competitions?.[0];
  const status = competition?.status ?? event.status;
  const statusType = status?.type;
  const competitors = competition?.competitors ?? [];
  const home = competitors.find((team) => team.homeAway === 'home') ?? competitors[1];
  const away = competitors.find((team) => team.homeAway === 'away') ?? competitors[0];
  const period = toNumber(status?.period, 0);
  const clock = asString(status?.displayClock, '');
  const statusText = asString(statusType?.shortDetail, asString(statusType?.detail, ''));
  const state = asString(statusType?.state, '').toLowerCase();
  const desc = asString(statusType?.description, '').toLowerCase();
  const detail = asString(statusType?.detail, '').toLowerCase();
  const shortDetail = asString(statusType?.shortDetail, '').toLowerCase();
  const looksFinal =
    desc.includes('final') || detail.includes('final') || shortDetail.includes('final');
  const explicitLive =
    state === 'in' ||
    state === 'live' ||
    desc.includes('in progress') ||
    detail.includes('in progress') ||
    shortDetail.includes('in progress');
  const clockHasTime = clock.length > 0 && clock !== '0:00' && clock !== '00:00';
  const periodInGame = period > 0;
  const isLive =
    !Boolean(statusType?.completed) && !looksFinal && (explicitLive || (periodInGame && clockHasTime));
  const conferenceGroup = competition?.groups;
  const [homeConference, awayConference] = await Promise.all([
    resolveCompetitorConference(home, conferenceGroup),
    resolveCompetitorConference(away, conferenceGroup),
  ]);
  const sharedConference =
    homeConference?.shortName &&
    awayConference?.shortName &&
    homeConference.shortName === awayConference.shortName
      ? homeConference
      : mapConference(conferenceGroup);

  return {
    gameId: asString(event.id),
    home: {
      id: asString(home?.team?.id),
      name: asString(home?.team?.displayName, 'Home'),
      score: asString(home?.score, '0'),
      logo: asString(home?.team?.logo, ''),
      conference: homeConference,
    },
    away: {
      id: asString(away?.team?.id),
      name: asString(away?.team?.displayName, 'Away'),
      score: asString(away?.score, '0'),
      logo: asString(away?.team?.logo, ''),
      conference: awayConference,
    },
    statusText: statusText || (isLive ? 'LIVE' : 'Scheduled'),
    period,
    clock,
    isLive,
    venue: asString(competition?.venue?.fullName),
    conference: sharedConference,
  };
}

const parseList = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

app.get('/health', (_req, res) => {
  res.json({ ok: true, port: config.port, pid: process.pid });
});

app.get('/cbb/live-games', async (_req, res) => {
  try {
    const date = getTodayDateYYYYMMDD();
    const cacheKey = `live-games:${date}`;
    const games = await withCache(liveGamesCache, cacheKey, 5000, async () => {
      const url = buildTodayScoreboardUrl(date);
      const json = await fetchEspnJson<ScoreboardResponse>(url);
      const events = json.events ?? [];
      const mapped = (await Promise.all(events.map(mapLiveGame))).filter((row) => row.gameId.length > 0);
      const liveOnly = mapped.filter((row) => row.isLive);
      const first = events[0];
      const firstStatus = first?.competitions?.[0]?.status ?? first?.status;
      // eslint-disable-next-line no-console
      console.log(`[cbb/live-games] events=${events.length} live=${liveOnly.length}`);
      // eslint-disable-next-line no-console
      console.log('[cbb/live-games] first-status-shape', {
        state: firstStatus?.type?.state,
        description: firstStatus?.type?.description,
        shortDetail: firstStatus?.type?.shortDetail,
        detail: firstStatus?.type?.detail,
        completed: firstStatus?.type?.completed,
        clock: firstStatus?.displayClock,
        period: firstStatus?.period,
      });
      return liveOnly
        .filter((row) => row.gameId.length > 0);
    });
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/cbb/games/today', async (_req, res) => {
  try {
    const date = getTodayDateYYYYMMDD();
    const cacheKey = `today-games:${date}`;
    const games = await withCache(todayGamesCache, cacheKey, 5000, async () => {
      const url = buildTodayScoreboardUrl(date);
      const json = await fetchEspnJson<ScoreboardResponse>(url);
      return (await Promise.all((json.events ?? []).map(mapLiveGame))).filter((row) => row.gameId.length > 0);
    });
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/cbb/games', async (req, res) => {
  try {
    const date =
      normalizeDateYYYYMMDD(
        typeof req.query.date === 'string' ? req.query.date : undefined,
      ) ?? getTodayDateYYYYMMDD();
    const cacheKey = `games:${date}`;
    const games = await withCache(todayGamesCache, cacheKey, 5000, async () => {
      const url = buildTodayScoreboardUrl(date);
      const json = await fetchEspnJson<ScoreboardResponse>(url);
      return (await Promise.all((json.events ?? []).map(mapLiveGame))).filter((row) => row.gameId.length > 0);
    });
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/cbb/game/:gameId/live', async (req, res) => {
  try {
    const gameId = asString(req.params.gameId);
    if (!gameId) {
      res.status(400).json({ error: 'gameId is required' });
      return;
    }

    const data = await withCache(liveGameByIdCache, `live-game:${gameId}`, 4000, async () => {
      const url = buildGameUrl(gameId);
      return fetchEspnJson<Record<string, unknown>>(url);
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/cbb/teams/search', async (req, res) => {
  try {
    const query = asString(req.query.q);
    const limitRaw = Number(req.query.limit ?? 20);
    const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 20));
    if (!query.trim()) {
      res.status(400).json({ error: 'q is required' });
      return;
    }

    const results = await searchTeamsDirectory(query, limit);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/betting/sports', async (_req, res) => {
  try {
    const sports = await listSports();
    res.json(sports);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/betting/games', async (req, res) => {
  try {
    const sportKey = String(req.query.sportKey ?? 'basketball_ncaab');
    const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
    const games = await listGamesForDate(sportKey, date);
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/betting/odds', async (req, res) => {
  try {
    const sportKey = String(req.query.sportKey ?? 'basketball_ncaab');
    const eventId = String(req.query.eventId ?? '');
    if (!eventId) {
      res.status(400).json({ error: 'eventId is required' });
      return;
    }
    const odds = await getEventOdds(sportKey, eventId);
    res.json(odds);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/betting/matched-odds', async (req, res) => {
  try {
    const sportKey = String(req.query.sportKey ?? 'basketball_ncaab');
    const homeTeam = String(req.query.homeTeam ?? '');
    const awayTeam = String(req.query.awayTeam ?? '');
    const startDateTime =
      typeof req.query.startDateTime === 'string' ? req.query.startDateTime : undefined;
    const forceRefresh = String(req.query.forceRefresh ?? 'false') === 'true';

    if (!homeTeam || !awayTeam) {
      res.status(400).json({ error: 'homeTeam and awayTeam are required' });
      return;
    }

    const matchInput = {
      homeTeam: {
        displayName: homeTeam,
        shortDisplayName:
          typeof req.query.homeShortTeam === 'string' ? req.query.homeShortTeam : undefined,
        abbreviation:
          typeof req.query.homeAbbreviation === 'string' ? req.query.homeAbbreviation : undefined,
      },
      awayTeam: {
        displayName: awayTeam,
        shortDisplayName:
          typeof req.query.awayShortTeam === 'string' ? req.query.awayShortTeam : undefined,
        abbreviation:
          typeof req.query.awayAbbreviation === 'string' ? req.query.awayAbbreviation : undefined,
      },
      startDateTime,
    };

    let event = findCachedBettingEvent(sportKey, matchInput);

    if (!event) {
      const dates = dateCandidatesForBetting(startDateTime);
      const lists = await Promise.all(dates.map((date) => listGamesForDate(sportKey, date)));
      const games = lists
        .flat()
        .map((row) => normalizeBettingGame(row as Record<string, unknown>, sportKey))
        .filter((row) => row.eventId);

      event = findBettingEventMatch(games, matchInput);
    }

    if (!event?.eventId) {
      res.json({ event: null, odds: null, winProbability: null });
      return;
    }

    // Debug-only raw odds inspection. This must never fail the request: the raw
    // provider can return non-JSON (which throws on response.json()), and this
    // block exists purely for logging, so swallow any error here.
    //
    // URL note: must be `${oddsApiIoBaseUrl}/odds` (string concatenation,
    // matching oddsClient.ts's buildOddsApiIoUrl), NOT
    // `new URL('/odds', oddsApiIoBaseUrl)` — a leading-slash path passed as
    // the WHATWG URL constructor's base-relative arg replaces the base's
    // own path instead of appending to it, so that form silently drops the
    // "/v3" already in oddsApiIoBaseUrl and 404s. That 404's plain-text
    // body ("404 page not found") is what previously produced "Unexpected
    // non-whitespace character after JSON at position 4" here — "404"
    // parses as a valid JSON number, then "p" of "page" (after the space)
    // is the unexpected character at position 4.
    try {
      const rawOddsApiUrl = new URL(`${config.oddsApiIoBaseUrl}/odds`);
      rawOddsApiUrl.searchParams.set('apiKey', config.oddsApiIoKey);
      rawOddsApiUrl.searchParams.set('eventId', String(event.eventId));
      rawOddsApiUrl.searchParams.set('bookmakers', config.oddsApiIoBookmakers.join(','));
      const rawOddsApiHttpResponse = await fetch(rawOddsApiUrl.toString());
      const rawOddsApiText = await rawOddsApiHttpResponse.text();
      if (!rawOddsApiHttpResponse.ok) {
        throw new Error(
          `odds-api.io debug fetch ${rawOddsApiHttpResponse.status}: ${rawOddsApiText.slice(0, 200)}`,
        );
      }
      const rawOddsApiResponse = JSON.parse(rawOddsApiText) as Record<string, unknown> | null;
      const rawBookmakers = Array.isArray(rawOddsApiResponse?.bookmakers)
        ? rawOddsApiResponse.bookmakers
        : rawOddsApiResponse && typeof rawOddsApiResponse.bookmakers === 'object'
          ? Object.entries(rawOddsApiResponse.bookmakers as Record<string, unknown>).map(
              ([key, markets]) => ({
                key,
                markets:
                  markets && typeof markets === 'object' ? Object.keys(markets as Record<string, unknown>) : [],
              }),
            )
          : [];
      const polymarketBook = rawBookmakers.find((book) => {
        const key = String((book as { key?: string; title?: string }).key ?? '').toLowerCase();
        const title = String((book as { key?: string; title?: string }).title ?? '').toLowerCase();
        return key.includes('polymarket') || title.includes('polymarket');
      }) as { key?: string; title?: string; markets?: unknown } | undefined;
      const polymarketMarkets =
        Array.isArray(polymarketBook?.markets)
          ? polymarketBook?.markets
          : polymarketBook?.markets && typeof polymarketBook.markets === 'object'
            ? Object.keys(polymarketBook.markets as Record<string, unknown>)
            : [];
      console.log(
        '[betting/matched-odds raw odds]',
        JSON.stringify(
          {
            sportKey,
            eventId: event.eventId,
            requestedBookmakers: config.oddsApiIoBookmakers,
            rawOddsApiResponse,
            bookmakerKeys: rawBookmakers.map((book) =>
              String((book as { key?: string; title?: string }).key ?? (book as { title?: string }).title ?? ''),
            ),
            polymarketPresent: Boolean(polymarketBook),
            polymarketMarkets,
            polymarketHasH2H: polymarketMarkets.includes('h2h'),
          },
          null,
          2,
        ),
      );
    } catch (debugError) {
      console.log(
        '[betting/matched-odds raw odds] debug inspection skipped:',
        (debugError as Error).message,
      );
    }
    const odds = await getEventOdds(sportKey, event.eventId, {
      bypassCache: forceRefresh,
    });
    const winProbability = buildMatchedOddsWinProbability(odds as Record<string, unknown> | null);
    res.json({ event, odds, winProbability });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/betting/watchlist', (req, res) => {
  try {
    const eventId = String(req.body?.eventId ?? '');
    const sportKey = String(req.body?.sportKey ?? 'basketball_ncaab');
    const watching = Boolean(req.body?.watching);
    if (!eventId) {
      res.status(400).json({ error: 'eventId is required' });
      return;
    }
    setWatchlist(eventId, sportKey, watching);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/betting/watchlist', (_req, res) => {
  try {
    res.json(getWatchlist());
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/betting/fliff-lines', async (req, res) => {
  try {
    const id = await createFliffLine({
      eventId: String(req.body?.eventId ?? ''),
      sportKey: String(req.body?.sportKey ?? 'basketball_ncaab'),
      marketType: req.body?.marketType,
      side: String(req.body?.side ?? ''),
      americanOdds: Number(req.body?.americanOdds ?? 0),
      linePoint: req.body?.linePoint ?? null,
      notes: req.body?.notes ?? null,
    });
    res.json({ id });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/betting/fliff-lines', (req, res) => {
  try {
    res.json(
      listFliffLines({
        date: req.query.date ? String(req.query.date) : undefined,
        eventId: req.query.eventId ? String(req.query.eventId) : undefined,
      }),
    );
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/betting/ev', async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : undefined;
    const minEV = Number(req.query.minEV ?? 2);
    const watchedOnly = String(req.query.watchedOnly ?? 'false') === 'true';
    const refBooks = parseList(req.query.referenceBooks as string | undefined);
    const referenceBooks = refBooks.length > 0 ? refBooks : config.referenceBooksDefault;
    const rows = await computeEvRanked({ date, minEV, watchedOnly, referenceBooks });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/betting/top-market-ev', async (req, res) => {
  try {
    const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
    const forceRefresh = String(req.query.forceRefresh ?? 'false') === 'true';
    const sortBy = String(req.query.sortBy ?? 'proEv') === 'fairProb' ? 'fairProb' : 'proEv';
    const limitRaw = Number(req.query.limit ?? 5);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.floor(limitRaw)) : 5;
    const rows = await computeTopMarketEv(date, { forceRefresh, sortBy, limit });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/betting/bets', (req, res) => {
  try {
    const id = createBet({
      fliffLineId: Number(req.body?.fliffLineId),
      stake: Number(req.body?.stake),
      americanOdds: Number(req.body?.americanOdds),
      linePoint: req.body?.linePoint ?? null,
      marketType: req.body?.marketType,
      side: String(req.body?.side ?? ''),
      notes: req.body?.notes ?? null,
    });
    res.json({ id });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/betting/bets', (_req, res) => {
  try {
    res.json(listBets());
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/betting/bets/:id/result', (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = req.body?.result as 'win' | 'loss' | 'push';
    if (!['win', 'loss', 'push'].includes(result)) {
      res.status(400).json({ error: 'result must be win/loss/push' });
      return;
    }
    setBetResult(id, result);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/betting/clv', async (req, res) => {
  try {
    const liveMinutes = Number(req.query.liveMinutes ?? config.clvLiveMinutesDefault);
    const rows = await computeClv(liveMinutes);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.listen(config.port, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const urls = [`http://localhost:${config.port}`];
  Object.values(nets).forEach((entries) => {
    (entries ?? []).forEach((entry) => {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${config.port}`);
      }
    });
  });
  // eslint-disable-next-line no-console
  console.log(`[betting-api] pid=${process.pid} listening on 0.0.0.0:${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`[betting-api] reachable URLs:\n- ${urls.join('\n- ')}`);
});
