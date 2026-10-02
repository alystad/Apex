import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { getCachedLiveGame, setCachedLiveGame } from '@/utils/cache';
import {
  computeLiveRating,
  computeSeasonPowerRating,
  type LiveGameStats,
  type TeamSeasonStats,
} from '@/utils/ratings';
import {
  computeSeasonRatings,
  type SeasonPlayerRatingInput,
  type SeasonPlayerRatingOutput,
} from '../src/lib/ratings/playerRatings';
import {
  inferOnCourtByMinuteDelta,
  type DebugInfo as OnCourtDebugInfo,
  type LineupSubstitutionInput,
} from '@/src/lib/lineups/inferOnCourtByMinuteDelta';
import {
  COLD_START_THRESHOLDS,
  computeClutchImpactDelta,
  computeImpactFromBox,
  computeInGameImpactRating,
  createEmptyPlayerBox,
  normalizePbpType,
  updatePlayerImpactFromEvent,
  type CanonicalPbpEventType,
  type GameContext,
  type PbpEvent,
  type PlayerBox,
  type PlayerImpact,
} from '../apps/mobile/src/ratings/impactRating';
import {
  ACTIVE_MOMENTUM_CONFIG,
  computePlayerMomentum,
  type MomentumInputEvent,
  type MomentumTimelinePoint,
} from '../apps/mobile/src/ratings/momentum';
import { API_SETUP_MESSAGE, getApiBaseUrl } from '@/src/config/api';
import type {
  BaseballBaseOccupancy,
  BaseballBattingLine,
  BaseballFieldingLine,
  BaseballGameSituation,
  BaseballPitchingLine,
  BaseballPlayerCardData,
} from '@/src/features/baseball/baseballTypes';
import {
  BASEBALL_DEFENSIVE_POSITIONS,
  mapEspnAthleteToOverlayPlayer,
  parseBaseballOnFieldState,
  type BaseballOnFieldState,
} from '@/src/features/baseball/liveFieldState';
import { fetchLiveGamePayload, type LiveGameListItem } from '@/src/features/basketball/api';
import { consumePendingGameSeed } from '@/src/loading/pendingGameSeed';
import { getNbaTeamGames, getNbaTeamStats } from '@/src/features/nba/teamApi';
import {
  DEFAULT_PRO_BASKETBALL_LEAGUE,
  getProBasketballLeagueConfig,
  type ProBasketballLeague,
} from '@/src/features/nba/proBasketballLeague';
import type { CollegeBaseballLivePayloadResult } from '@/src/features/cbaseball/api';
import { computeBaseballRating } from '@/src/lib/ratings/baseballRatingEngine';
import { computeBaseballGameImpacts } from '@/src/ratings/baseball/BaseballRankingEngine';
import type { BaseballComputedGameImpact } from '@/src/ratings/baseball/types';
import { useGameModeActions, useGameModeState } from '@/src/mode/GameModeContext';
import type { GameMode } from '@/src/mode/gameModeTypes';
import { useSettingsState } from '@/src/settings/SettingsContext';

const DEFAULT_GAME_ID_BY_NON_PRO_MODE: Record<Exclude<GameMode, 'nba'>, string> = {
  baseball: '401853300',
  college: '401827691',
};

function getDefaultGameId(
  mode: GameMode,
  proLeague: ProBasketballLeague,
): string {
  return mode === 'nba'
    ? getProBasketballLeagueConfig(proLeague).defaultGameId
    : DEFAULT_GAME_ID_BY_NON_PRO_MODE[mode];
}
const POLL_INTERVAL_MS = 5000;
// How long with no successfully-completed poll before the UI is told
// polling looks stale (see the watchdog effect in LiveGameProvider).
const STALE_POLL_THRESHOLD_MS = 30000;
const WATCHDOG_INTERVAL_MS = 10000;
// How many consecutive polls must read the game as finished before polling
// is actually disabled — guards against a single flaky/stale 'post' read
// permanently killing live updates (see consecutiveFinalReadsRef).
const FINAL_STATUS_CONFIRMATION_COUNT = 2;
const COLLEGE_BASEBALL_EMPTY_MESSAGE = 'No live college baseball games right now.';
const SYNC_CALIBRATION_PLAY_LIMIT = 8;

// Carries the impact/momentum/timeline replay state forward across calls to
// withPlayerRanks for the SAME game, so a poll (or a re-open of an
// already-fully-replayed game within this session) only has to fold in
// plays that weren't already processed last time, instead of replaying the
// entire play-by-play from an empty box every single call. See
// withPlayerRanks below for how `fingerprints` is used to validate reuse —
// this is deliberately conservative: any mismatch (a retracted/edited play,
// a different game, a fresh cold start) falls back to a full rebuild rather
// than risk silently stale ratings.
type ImpactReplayAccumulator = {
  // One fingerprint per already-processed play, in the SAME sorted order
  // withPlayerRanks processes them in — id + score + text, so a play whose
  // content changed (not just a newly appended one) is detected as a
  // mismatch rather than silently skipped.
  fingerprints: string[];
  previousMargin: number;
  impactByPlayerId: Map<string, PlayerImpact>;
  eventBoxesByPlayerId: Map<string, PlayerBox>;
  threePtByPlayerId: Map<string, { made: number; attempted: number }>;
  clutchBonusByPlayerId: Map<string, number>;
  momentumEventsByPlayerId: Map<string, MomentumInputEvent[]>;
  ratingTimelineByPlayerId: Map<string, LiveGameRatingTimelinePoint[]>;
  eventDisplayRatingsByEventId: Map<
    string,
    { displayRatingBefore: number | null; displayRatingAfter: number | null; displayDelta: number | null }
  >;
};

// Session-scoped (in-memory, cleared on app restart) — matches the existing
// resourceCache/liveGameCache pattern elsewhere in this codebase. Bounded so
// a long session browsing many games doesn't grow this unboundedly.
const IMPACT_REPLAY_ACCUMULATOR_CACHE_LIMIT = 20;
const impactReplayAccumulatorCache = new Map<string, ImpactReplayAccumulator>();

function rememberImpactReplayAccumulator(cacheKey: string, accumulator: ImpactReplayAccumulator): void {
  // Map preserves insertion order; re-inserting an existing key moves it to
  // the end, so this is a cheap LRU: delete-then-set bumps recency.
  impactReplayAccumulatorCache.delete(cacheKey);
  impactReplayAccumulatorCache.set(cacheKey, accumulator);
  while (impactReplayAccumulatorCache.size > IMPACT_REPLAY_ACCUMULATOR_CACHE_LIMIT) {
    const oldestKey = impactReplayAccumulatorCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    impactReplayAccumulatorCache.delete(oldestKey);
  }
}

type SummaryResponse = {
  header?: {
    competitions?: Array<{
      date?: string;
      attendance?: number;
      venue?: {
        fullName?: string;
      };
      type?: {
        shortDetail?: string;
      };
      notes?: Array<{
        headline?: string;
      }>;
      broadcasts?: Array<{
        names?: string[];
      }>;
      officials?: Array<{
        fullName?: string;
      }>;
      status?: {
        displayClock?: string;
        period?: number;
        type?: {
          state?: string;
          description?: string;
          detail?: string;
          shortDetail?: string;
        };
      };
      groups?: {
        id?: string;
        name?: string;
        shortName?: string;
        isConference?: boolean;
      };
      competitors?: Array<{
        homeAway?: 'home' | 'away';
        winner?: boolean;
        score?: string;
        hits?: number;
        errors?: number;
        linescores?: Array<{ value?: number; displayValue?: string }>;
        record?: Array<{
          type?: string;
          summary?: string;
          displayValue?: string;
        }>;
        team?: {
          id?: string;
          abbreviation?: string;
          displayName?: string;
          shortDisplayName?: string;
          conferenceId?: string;
          logo?: string;
          logos?: Array<{ href?: string }>;
          color?: string;
          alternateColor?: string;
        };
      }>;
      neutralSite?: boolean;
      situation?: unknown;
    }>;
  };
  boxscore?: {
    teams?: Array<{
      team?: {
        id?: string;
        displayName?: string;
        shortDisplayName?: string;
        logo?: string;
      };
      homeAway?: 'home' | 'away';
      statistics?: Array<{
        name?: string;
        label?: string;
        abbreviation?: string;
        displayValue?: string;
        type?: string;
        stats?: Array<{
          name?: string;
          displayValue?: string;
          value?: number;
        }>;
      }>;
    }>;
    players?: Array<{
      team?: {
        id?: string;
        displayName?: string;
        shortDisplayName?: string;
      };
      statistics?: Array<{
        name?: string;
        type?: string;
        keys?: string[];
        athletes?: Array<{
          starter?: boolean;
          active?: boolean;
          didNotPlay?: boolean;
          position?: { abbreviation?: string };
          athlete?: {
            id?: string;
            displayName?: string;
            shortName?: string;
            jersey?: string;
            position?: { abbreviation?: string };
            headshot?: { href?: string };
            displayHeight?: string;
            height?: number | string;
          };
          stats?: string[];
        }>;
      }>;
    }>;
  };
  plays?: Array<{
    id?: string;
    date?: string;
    text?: string;
    awayScore?: number;
    homeScore?: number;
    scoringPlay?: boolean;
    shortDescription?: string;
    period?: { number?: number; displayValue?: string; type?: string };
    clock?: { displayValue?: string };
    team?: { id?: string };
    outs?: number;
    pitchCount?: string;
    resultCount?: string;
    onFirst?: boolean;
    onSecond?: boolean;
    onThird?: boolean;
  }>;
};

type BaseballSummaryResponse = SummaryResponse;

type AthleteStatsResponse = {
  categories?: Array<{
    name?: string;
    names?: string[];
    totals?: string[];
  }>;
};

type TeamRosterResponse = {
  athletes?: Array<{
    id?: string;
    displayName?: string;
    shortName?: string;
    jersey?: string;
    position?: { abbreviation?: string };
    headshot?: { href?: string };
    displayHeight?: string;
    height?: number | string;
  }>;
};

type TeamInfoResponse = {
  team?: {
    logos?: Array<{
      href?: string;
      rel?: string[];
    }>;
  };
};

type BoxscorePlayerSection = NonNullable<NonNullable<SummaryResponse['boxscore']>['players']>[number];
type StatsEntry = NonNullable<BoxscorePlayerSection['statistics']>[number];
type AthleteEntry = NonNullable<StatsEntry['athletes']>[number];
type BoxscoreTeamSection = NonNullable<NonNullable<SummaryResponse['boxscore']>['teams']>[number];
type TeamStatEntry = NonNullable<BoxscoreTeamSection['statistics']>[number];

export type LiveGameTeamTotals = {
  fg: string;
  fgPct: string;
  threePt: string;
  threePtPct: string;
  ft: string;
  ftPct: string;
  rebounds: string;
  assists: string;
  turnovers: string;
  fouls: string;
  benchPoints: string;
  statsMap: Record<string, string>;
  baseball?: {
    runs: string;
    hits: string;
    errors: string;
    batting: Record<string, string>;
    pitching: Record<string, string>;
    fielding: Record<string, string>;
  };
};

export type LiveGamePlayer = {
  id: string;
  teamId: string;
  name: string;
  shortName: string;
  lastName: string;
  jersey: string;
  position: string;
  heightInches?: number | null;
  heightDisplay?: string;
  headshot: string;
  starter: boolean;
  active: boolean;
  didNotPlay: boolean;
  minutes: number;
  minutesDisplay: string;
  points: number;
  rebounds: number;
  assists: number;
  turnovers: number;
  steals: number;
  blocks: number;
  fouls: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  fg: string;
  threePt: string;
  ft: string;
  plusMinus: string;
  plusMinusValue: number;
  liveEffPerMin: number;
  seasonEffPerMin: number | null;
  seasonImpactRaw: number | null;
  inGameImpactRaw: number | null;
  liveRawBase: number | null;
  liveRaw: number | null;
  liveDisplay: '-' | number;
  seasonRating10: number | null;
  inGameRating10: number | null;
  lowSample: boolean;
  gameRating: number | null;
  seasonRating: number | null;
  gameRank: number | null;
  seasonRank: number | null;
  minutesIncreasing: boolean;
  onCourt: boolean;
  minuteDelta: number;
  lastMeaningfulImpact?: {
    eventId: string;
    description: string;
    period: number;
    clockSec: number;
    ratingBefore: number;
    ratingAfter: number;
    delta: number;
    displayRatingBefore?: number | null;
    displayRatingAfter?: number | null;
    displayDelta?: number | null;
  };
  ratingTimelinePoints?: LiveGameRatingTimelinePoint[];
  ratingTimelineDurationSec?: number;
  /**
   * MOMENTUM: signed -5..+5 "how hot/cold right now" value. Fully independent
   * of the 0-10 Impact Rating above (inGameRating10). null before any sample.
   */
  momentum?: number | null;
  momentumTimelinePoints?: MomentumTimelinePoint[];
  /**
   * Rolling box-score stats over the same trailing window Momentum itself
   * uses (~3 min of game clock) — "3 pts in the last 3 min" rather than the
   * full-game total, so the leaderboard's stat line matches the "right now"
   * framing of Momentum mode. See MOMENTUM_STATS_DISPLAY_MODE in
   * components/ui/TopPlayerRow.tsx for the easy full-game/recent toggle.
   */
  momentumRecentStats?: {
    points: number;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    windowSec: number;
  };
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  sport?: 'basketball' | 'baseball';
  baseball?: BaseballPlayerCardData | null;
};

export type LiveGameRatingTimelinePoint = {
  tSec: number;
  rating: number;
  reason?: string;
  eventId?: string;
  description?: string;
  period?: number;
  clockSec?: number;
  ratingBefore?: number;
  ratingAfter?: number;
  delta?: number;
  displayRatingBefore?: number | null;
  displayRatingAfter?: number | null;
  displayDelta?: number | null;
  stats?: {
    minutesDisplay: string;
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    tov: number;
    fls: number;
    fg: string;
    threePt: string;
    ft: string;
    plusMinus?: string;
    oreb?: number;
    dreb?: number;
  };
};

function getEspnLeaguePath(
  mode: GameMode,
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): string {
  if (mode === 'nba') {
    return getProBasketballLeagueConfig(proLeague).espnLeaguePath;
  }
  if (mode === 'baseball') {
    return 'baseball/college-baseball';
  }
  return 'basketball/mens-college-basketball';
}

function getAthleteStatsUrl(
  mode: GameMode,
  proLeague: ProBasketballLeague,
  athleteId: string,
): string {
  return `https://site.web.api.espn.com/apis/common/v3/sports/${getEspnLeaguePath(mode, proLeague)}/athletes/${athleteId}/stats`;
}

function getTeamRosterUrl(
  mode: GameMode,
  proLeague: ProBasketballLeague,
  teamId: string,
): string {
  return `https://site.api.espn.com/apis/site/v2/sports/${getEspnLeaguePath(mode, proLeague)}/teams/${teamId}/roster`;
}

function getTeamInfoUrl(
  mode: GameMode,
  proLeague: ProBasketballLeague,
  teamId: string,
): string {
  return `https://site.api.espn.com/apis/site/v2/sports/${getEspnLeaguePath(mode, proLeague)}/teams/${teamId}`;
}

type SummaryCompetitor = NonNullable<
  NonNullable<NonNullable<SummaryResponse['header']>['competitions']>[number]['competitors']
>[number];

export type LiveGameTeam = {
  id: string;
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
  record: string;
  homeAway: 'home' | 'away' | 'unknown';
  logo: string;
  color: string;
  alternateColor: string;
  conference:
    | {
        id?: string;
        name?: string;
        shortName?: string;
      }
    | null;
  score: string;
  linescores: string[];
  totals: LiveGameTeamTotals;
  ratings: {
    seasonPower: number | null;
    gameNetRtg: number | null;
    last5MinNetRtg: number | null;
    liveRating: number | null;
  };
  sport?: 'basketball' | 'baseball';
  baseball?: {
    lineScore: string[];
    runs: string;
    hits: string;
    errors: string;
    situation: BaseballGameSituation | null;
    probableStarter?: string | null;
  };
};

export type LiveGamePlay = {
  id: string;
  text: string;
  shortDescription: string;
  period: string;
  clock: string;
  awayScore: string;
  homeScore: string;
  scoringPlay: boolean;
  teamId: string | null;
  sport?: 'basketball' | 'baseball';
  baseball?: {
    inning: number | null;
    half: BaseballGameSituation['half'];
    outs: number | null;
    balls: number | null;
    strikes: number | null;
    bases: BaseballBaseOccupancy;
  };
};

export type LiveGameSyncCalibrationPlay = Pick<
  LiveGamePlay,
  "id" | "text" | "period" | "clock" | "awayScore" | "homeScore"
> & {
  firstSeenAtIso: string;
};

type LiveGameConference = LiveGameTeam['conference'];

export type LiveGameStatus = {
  state: string;
  description: string;
  detail: string;
  shortDetail: string;
  period: number;
  displayClock: string;
  periodLabel: string;
  baseball?: BaseballGameSituation | null;
};

export type LiveGameEventType = 'scoring' | 'foul' | 'turnover' | 'timeout' | 'substitution' | 'injury' | 'other';

export type LiveGameKeyEvent = {
  id: string;
  period: string;
  clock: string;
  eventType: LiveGameEventType;
  description: string;
  homeScore: string;
  awayScore: string;
};

export type LiveGameSubstitution = {
  id: string;
  period: string;
  clock: string;
  teamId: string | null;
  description: string;
};

export type LiveGameWinProbPoint = {
  time: number;
  homeWinProb: number;
  actualTimeIso?: string;
};

export type LiveGameScoreMarginPoint = {
  /** Elapsed game seconds (same time base as winProbability). */
  time: number;
  /** Running score margin from the home perspective (home - away). */
  margin: number;
  /** 1-based game period this play belongs to. */
  period: number;
  homeScore: number;
  awayScore: number;
  actualTimeIso?: string;
};

export type LiveGameMeta = {
  competition: string;
  round: string;
  venue: string;
  attendance: string;
  startDateTime: string;
  officials: string[];
  broadcasters: string[];
};

export type LiveGameData = {
  mode: GameMode;
  sport?: 'basketball' | 'baseball';
  eventId: string;
  summaryUrl: string;
  status: LiveGameStatus;
  meta: LiveGameMeta;
  possessionTeamId: string | null;
  teams: LiveGameTeam[];
  playersByTeam: Record<string, LiveGamePlayer[]>;
  plays: LiveGamePlay[];
  keyEvents: LiveGameKeyEvent[];
  substitutions: LiveGameSubstitution[];
  // Structured counterpart to `substitutions` above (which is free-text) —
  // resolved player IDs + elapsed-game-seconds timestamps, ready to replay
  // "who was on court at time X" without re-parsing descriptions. Populated
  // by withPlayerRanks (basketball only, since that's the only mode with a
  // rating-timeline-driven history worth scrubbing); absent/empty otherwise.
  lineupSubstitutions?: LineupSubstitutionInput[];
  winProbability: LiveGameWinProbPoint[];
  scoreMargin: LiveGameScoreMarginPoint[];
  seasonRankings: Array<{ teamId: string; value: number }>;
  liveRankings: Array<{ teamId: string; value: number }>;
  baseballOnField?: BaseballOnFieldState<LiveGamePlayer> | null;
};

type LiveGameDebug = {
  url: string;
  lastStatus: number | null;
  parsedCounts: Record<string, number>;
};

type SeasonPowerCacheEntry = {
  signature: string;
  value: number | null;
};

type PregameTeamSeasonStatsEntry = {
  pointsFor: number;
  pointsAgainst: number;
  possessions: number;
  turnovers: number | null;
};

type LiveGameContextValue = {
  loading: boolean;
  error: string | null;
  isOffline: boolean;
  isFromCache: boolean;
  isReconnecting: boolean;
  gameId: string;
  mode: GameMode;
  proLeague: ProBasketballLeague;
  data: LiveGameData | null;
  lastUpdated: string | null;
  syncCalibrationPlays: LiveGameSyncCalibrationPlay[];
  debug: LiveGameDebug;
  refresh: () => Promise<void>;
  setGameId: (gameId: string, mode?: GameMode) => void;
  setProLeague: (league: ProBasketballLeague) => void;
  setPollingEnabled: (enabled: boolean) => void;
};

const LiveGameContext = createContext<LiveGameContextValue | null>(null);

function safeString(value: unknown, fallback = '�'): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

const INVALID_TEXT_TOKENS = new Set(['ï¿½', '�', 'n/a', 'na', 'null', 'none', '--', '-']);

function sanitizeHeadshotUri(value: unknown): string {
  const raw = safeString(value, '').trim();
  if (!raw) {
    return '';
  }
  const lower = raw.toLowerCase();
  if (INVALID_TEXT_TOKENS.has(lower)) {
    return '';
  }
  return raw.startsWith('http://') ? `https://${raw.slice(7)}` : raw;
}

function sanitizeJersey(value: unknown, fallback = '-'): string {
  const raw = safeString(value, '').trim();
  if (!raw) {
    return fallback;
  }
  const lower = raw.toLowerCase();
  if (INVALID_TEXT_TOKENS.has(lower)) {
    return fallback;
  }
  return /^[0-9A-Za-z]{1,4}$/.test(raw) ? raw : fallback;
}

function normalizeLookupText(value: unknown): string {
  const raw = safeString(value, '').toLowerCase().trim();
  if (!raw) {
    return '';
  }
  return raw.replace(/[^a-z0-9]/g, '');
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

function parseSignedStat(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/\u2212/g, '-').replace(/[^0-9.+-]/g, '');
    const parsed = Number.parseFloat(cleaned);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function parseMadeAttempted(value: string | undefined): { made: number; attempted: number } {
  const raw = safeString(value, '0-0');
  const [madeRaw, attemptedRaw] = raw.split('-');
  return {
    made: toNumber(madeRaw, 0),
    attempted: toNumber(attemptedRaw, 0),
  };
}

function toStatMap(stats: BoxscoreTeamSection['statistics']): Record<string, string> {
  const map: Record<string, string> = {};
  (stats ?? []).forEach((entry: TeamStatEntry) => {
    const key = safeString(entry?.name, '');
    if (key) {
      map[key] = safeString(entry?.displayValue);
    }
  });
  return map;
}

function statNumberFromMap(statsMap: Record<string, string>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = statsMap[key];
    if (!raw) {
      continue;
    }
    const cleaned = raw.replace(/[^0-9.+-]/g, '');
    const parsed = Number.parseFloat(cleaned);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseAttemptedValue(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const [_, attempted] = raw.split('-');
  if (!attempted) {
    return null;
  }
  const parsed = Number.parseFloat(attempted.replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function isPregameState(value: unknown): boolean {
  const state = safeString(value, '').toLowerCase();
  return state === 'pre' || state === 'scheduled' || state === 'pregame';
}

function hasSeasonAverageStats(statistics: TeamStatEntry[] | undefined): boolean {
  const statsMap = toStatMap(statistics);
  return (
    statNumberFromMap(statsMap, ['avgPoints']) !== null &&
    statNumberFromMap(statsMap, ['avgPointsAgainst']) !== null
  );
}

function parseTeamStatRowValue(value: number | null, displayValue: string): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const cleaned = safeString(displayValue).replace(/[^0-9.+-]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchPregameNbaTeamSeasonStats(
  proLeague: ProBasketballLeague,
  teamId: string,
  cache: Map<string, PregameTeamSeasonStatsEntry | null>,
): Promise<PregameTeamSeasonStatsEntry | null> {
  const cacheKey = `${proLeague}:${teamId}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }

  try {
    const season = new Date().getFullYear();
    const [teamStats, gamesPage] = await Promise.all([
      getNbaTeamStats(proLeague, teamId, season),
      getNbaTeamGames(proLeague, teamId, season, 0, 100, 'regular'),
    ]);

    const statValue = (key: string) => {
      const row = teamStats.find((entry) => entry.key === key);
      return row ? parseTeamStatRowValue(row.value, row.displayValue) : null;
    };

    const completedGames = gamesPage.rows.filter(
      (game) => game.completed && game.opponentScore !== null,
    );
    const pointsAgainst =
      completedGames.length > 0
        ? completedGames.reduce((sum, game) => sum + (game.opponentScore ?? 0), 0) /
          completedGames.length
        : null;
    const pointsFor = statValue('avgPoints');
    const turnovers = statValue('avgTurnovers');

    if (pointsFor === null || pointsAgainst === null) {
      cache.set(cacheKey, null);
      return null;
    }

    const entry: PregameTeamSeasonStatsEntry = {
      pointsFor,
      pointsAgainst,
      possessions: 100,
      turnovers,
    };
    cache.set(cacheKey, entry);
    return entry;
  } catch {
    cache.set(teamId, null);
    return null;
  }
}

function upsertSummaryStat(
  statistics: TeamStatEntry[],
  name: string,
  value: number | null,
): TeamStatEntry[] {
  if (value === null || !Number.isFinite(value)) {
    return statistics;
  }

  const displayValue = Number.isInteger(value) ? `${value}` : value.toFixed(1);
  const nextEntry: TeamStatEntry = {
    name,
    label: name,
    abbreviation: name,
    displayValue,
  };
  const index = statistics.findIndex((entry) => safeString(entry?.name, '') === name);

  if (index >= 0) {
    const next = [...statistics];
    next[index] = {
      ...next[index],
      ...nextEntry,
    };
    return next;
  }

  return [...statistics, nextEntry];
}

async function applyPregameNbaSeasonStatsFallback(
  summary: SummaryResponse,
  proLeague: ProBasketballLeague,
  cache: Map<string, PregameTeamSeasonStatsEntry | null>,
): Promise<SummaryResponse> {
  const competition = summary.header?.competitions?.[0];
  if (!competition || !isPregameState(competition.status?.type?.state)) {
    return summary;
  }

  const competitors = competition.competitors ?? [];
  const boxTeams = summary.boxscore?.teams ?? [];
  const shouldEnrich = competitors.some((competitor) => {
    const teamId = safeString(competitor.team?.id, '');
    const boxTeam = boxTeams.find((candidate) => safeString(candidate.team?.id, '') === teamId);
    return !hasSeasonAverageStats(boxTeam?.statistics);
  });

  if (!shouldEnrich) {
    return summary;
  }

  const entries = await Promise.all(
    competitors.map(async (competitor) => {
      const teamId = safeString(competitor.team?.id, '');
      if (!teamId) {
        return null;
      }
      const seasonStats = await fetchPregameNbaTeamSeasonStats(proLeague, teamId, cache);
      return seasonStats ? { teamId, seasonStats } : null;
    }),
  );

  const seasonStatsByTeamId = new Map(
    entries
      .filter((entry): entry is { teamId: string; seasonStats: PregameTeamSeasonStatsEntry } => Boolean(entry))
      .map((entry) => [entry.teamId, entry.seasonStats]),
  );

  if (seasonStatsByTeamId.size === 0) {
    return summary;
  }

  const nextBoxTeams = [...boxTeams];
  competitors.forEach((competitor) => {
    const teamId = safeString(competitor.team?.id, '');
    const seasonStats = seasonStatsByTeamId.get(teamId);
    if (!teamId || !seasonStats) {
      return;
    }

    const currentIndex = nextBoxTeams.findIndex(
      (candidate) => safeString(candidate.team?.id, '') === teamId,
    );
    const currentTeam = currentIndex >= 0 ? nextBoxTeams[currentIndex] : undefined;
    let statistics = [...(currentTeam?.statistics ?? [])];

    statistics = upsertSummaryStat(statistics, 'avgPoints', seasonStats.pointsFor);
    statistics = upsertSummaryStat(statistics, 'avgPointsAgainst', seasonStats.pointsAgainst);
    statistics = upsertSummaryStat(statistics, 'avgPossessions', seasonStats.possessions);
    statistics = upsertSummaryStat(statistics, 'pace', seasonStats.possessions);
    statistics = upsertSummaryStat(statistics, 'avgTeamTurnovers', seasonStats.turnovers);

    const nextTeam = {
      ...currentTeam,
      team: {
        ...currentTeam?.team,
        id: teamId,
      },
      statistics,
    };

    if (currentIndex >= 0) {
      nextBoxTeams[currentIndex] = nextTeam;
    } else {
      nextBoxTeams.push(nextTeam);
    }
  });

  return {
    ...summary,
    boxscore: {
      ...(summary.boxscore ?? {}),
      teams: nextBoxTeams,
    },
  };
}

// How a league's game clock is structured: how many regulation periods it
// plays, how long each one is, and how long overtime periods are. Elapsed-
// time math (parsePeriodClockToElapsedSeconds / totalGameSecondsForPeriod)
// is derived entirely from these three numbers, so supporting another format
// (e.g. a league with 10-minute quarters) is just adding another constant
// below and a case in getPeriodTimingForMode — no formula changes needed.
export type PeriodTimingConfig = {
  regulationPeriods: number;
  regulationPeriodSeconds: number;
  overtimeSeconds: number;
};

// NCAA men's and women's basketball: 2 x 20-minute halves, then 5-minute OTs.
const NCAA_BASKETBALL_PERIOD_TIMING: PeriodTimingConfig = {
  regulationPeriods: 2,
  regulationPeriodSeconds: 20 * 60,
  overtimeSeconds: 5 * 60,
};

// NBA/WNBA: 4 x 12-minute quarters, then 5-minute OTs.
const NBA_PERIOD_TIMING: PeriodTimingConfig = {
  regulationPeriods: 4,
  regulationPeriodSeconds: 12 * 60,
  overtimeSeconds: 5 * 60,
};

export function getPeriodTimingForMode(mode: GameMode): PeriodTimingConfig {
  if (mode === 'nba') {
    return NBA_PERIOD_TIMING;
  }
  // 'college' uses this directly; 'baseball' has no minute-based period clock
  // at all (its play clock isn't MM:SS, so parsePeriodClockToElapsedSeconds
  // bails out before this config ever affects it) — NCAA timing is just an
  // inert default for that mode.
  return NCAA_BASKETBALL_PERIOD_TIMING;
}

function formatMinutesSecondsClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function parsePeriodClockToElapsedSeconds(
  periodLabelRaw: string,
  clockRaw: string,
  timing: PeriodTimingConfig = NCAA_BASKETBALL_PERIOD_TIMING,
): number | null {
  const periodMatch = periodLabelRaw.match(/(\d+)/);
  if (!periodMatch) {
    return null;
  }

  const period = Number.parseInt(periodMatch[1], 10);
  if (!Number.isFinite(period) || period <= 0) {
    return null;
  }

  // Under a minute remaining, ESPN (NBA/WNBA) switches the clock display from
  // "M:SS" to decimal seconds only (e.g. "58.3", "0.0") instead of "0:58".
  // Without handling that format, every last-minute-of-period play (a
  // disproportionately important stretch — crunch time) would fail to parse
  // and fall back to elapsed=0, i.e. get plotted at the START of that period
  // instead of near its end.
  let minutes: number;
  let seconds: number;
  if (clockRaw.includes(':')) {
    const [mRaw, sRaw] = clockRaw.split(':');
    minutes = Number.parseInt(mRaw ?? '', 10);
    seconds = Number.parseInt(sRaw ?? '', 10);
  } else {
    minutes = 0;
    seconds = Number.parseFloat(clockRaw);
  }
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }

  const { regulationPeriods, regulationPeriodSeconds, overtimeSeconds } = timing;
  const elapsedCurrent = Math.max(0, regulationPeriodSeconds - (minutes * 60 + seconds));

  if (period <= regulationPeriods) {
    return (period - 1) * regulationPeriodSeconds + elapsedCurrent;
  }

  return (
    regulationPeriods * regulationPeriodSeconds +
    (period - regulationPeriods - 1) * overtimeSeconds +
    Math.max(0, overtimeSeconds - (minutes * 60 + seconds))
  );
}

function parseHeightToInches(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // ESPN may provide total inches directly.
    if (value >= 48 && value <= 96) {
      return Math.round(value);
    }
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  const feetInches = raw.match(/^(\d)\s*['-]\s*(\d{1,2})\s*(?:\"|in)?$/i);
  if (feetInches) {
    const feet = Number.parseInt(feetInches[1], 10);
    const inches = Number.parseInt(feetInches[2], 10);
    if (Number.isFinite(feet) && Number.isFinite(inches) && inches >= 0 && inches < 12) {
      return feet * 12 + inches;
    }
  }
  const compactFeetInches = raw.match(/^(\d)\s*(\d{2})$/);
  if (compactFeetInches) {
    const feet = Number.parseInt(compactFeetInches[1], 10);
    const inches = Number.parseInt(compactFeetInches[2], 10);
    if (Number.isFinite(feet) && Number.isFinite(inches) && inches >= 0 && inches < 12) {
      return feet * 12 + inches;
    }
  }
  const numeric = Number.parseInt(raw.replace(/[^0-9]/g, ''), 10);
  if (Number.isFinite(numeric) && numeric >= 48 && numeric <= 96) {
    return numeric;
  }
  return null;
}

function resolveHeightMetadata(source: {
  displayHeight?: string;
  height?: number | string;
}): { heightInches: number | null; heightDisplay: string } {
  const heightInches = parseHeightToInches(source.displayHeight) ?? parseHeightToInches(source.height);
  const heightDisplay =
    safeString(source.displayHeight, '') ||
    (typeof source.height === 'string' && source.height.trim().length > 0
      ? source.height.trim()
      : heightInches
        ? `${Math.floor(heightInches / 12)}'${heightInches % 12}"`
        : '�');
  return {
    heightInches,
    heightDisplay,
  };
}

function parseClockDisplayToSeconds(clockDisplay: string): number {
  const [mRaw, sRaw] = clockDisplay.split(':');
  const minutes = Number.parseInt(mRaw ?? '', 10);
  const seconds = Number.parseInt(sRaw ?? '', 10);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return 0;
  }
  return Math.max(0, minutes * 60 + seconds);
}

function parsePeriodLabelToNumber(periodLabelRaw: string): number {
  const normalized = periodLabelRaw.toLowerCase();
  const directMatch = normalized.match(/(\d+)/);
  if (directMatch) {
    const value = Number.parseInt(directMatch[1], 10);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  if (normalized.includes('ot')) {
    return 3;
  }
  if (normalized.includes('2nd')) {
    return 2;
  }
  return 1;
}

function normalizeNameForLookup(value: string): string {
  return value
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type ImpactPlayerLookup = {
  playerId: string;
  teamId: string;
  variants: string[];
};

function buildImpactPlayerLookup(playersByTeam: Record<string, LiveGamePlayer[]>): ImpactPlayerLookup[] {
  const rows: ImpactPlayerLookup[] = [];
  Object.entries(playersByTeam).forEach(([teamId, players]) => {
    players.forEach((player) => {
      const variants = [
        normalizeNameForLookup(player.name),
        normalizeNameForLookup(player.shortName),
        normalizeNameForLookup(player.lastName),
      ]
        .filter((variant) => variant.length >= 3);
      rows.push({
        playerId: player.id,
        teamId,
        variants: [...new Set(variants)],
      });
    });
  });
  return rows;
}

function findPlayerIdsInDescription(
  description: string,
  teamId: string | null,
  lookup: ImpactPlayerLookup[],
): { primaryId?: string; secondaryId?: string } {
  const normalized = normalizeNameForLookup(description);
  if (!normalized) {
    return {};
  }

  const matches: Array<{ playerId: string; teamId: string; index: number; length: number }> = [];
  lookup.forEach((entry) => {
    entry.variants.forEach((variant) => {
      const index = normalized.indexOf(variant);
      if (index >= 0) {
        matches.push({
          playerId: entry.playerId,
          teamId: entry.teamId,
          index,
          length: variant.length,
        });
      }
    });
  });

  if (matches.length === 0) {
    return {};
  }

  const bestByPlayer = new Map<string, { teamId: string; index: number; length: number }>();
  matches.forEach((match) => {
    const existing = bestByPlayer.get(match.playerId);
    if (!existing || match.index < existing.index || (match.index === existing.index && match.length > existing.length)) {
      bestByPlayer.set(match.playerId, {
        teamId: match.teamId,
        index: match.index,
        length: match.length,
      });
    }
  });

  const deduped = [...bestByPlayer.entries()]
    .map(([playerId, row]) => ({ playerId, ...row }))
    .sort((a, b) => a.index - b.index || b.length - a.length);

  const primary = teamId
    ? deduped.find((row) => row.teamId === teamId)?.playerId ?? deduped[0]?.playerId
    : deduped[0]?.playerId;
  const secondary = deduped.find((row) => row.playerId !== primary)?.playerId;
  return {
    primaryId: primary,
    secondaryId: secondary,
  };
}

function inferShotType(description: string): "2PT" | "3PT" | "FT" | undefined {
  const text = description.toLowerCase();
  if (text.includes('free throw')) {
    return 'FT';
  }
  if (text.includes('3-pt') || text.includes('three')) {
    return '3PT';
  }
  if (text.includes('jumper') || text.includes('layup') || text.includes('dunk') || text.includes('hook shot') || text.includes('shot')) {
    return '2PT';
  }
  return undefined;
}

function inferMadeFlag(description: string): boolean | undefined {
  const text = description.toLowerCase();
  if (text.includes('makes') || text.includes('made')) {
    return true;
  }
  if (text.includes('misses') || text.includes('missed')) {
    return false;
  }
  return undefined;
}

type DerivedImpactEvent = {
  event: PbpEvent;
  elapsedSec: number;
  leadChangedOnPlay: boolean;
};

function buildImpactEventsFromPlay(
  play: LiveGamePlay,
  lookup: ImpactPlayerLookup[],
  leadChangedOnPlay: boolean,
): DerivedImpactEvent[] {
  const { primaryId, secondaryId } = findPlayerIdsInDescription(play.text, play.teamId, lookup);
  const shotType = inferShotType(play.text);
  const made = inferMadeFlag(play.text);
  const period = parsePeriodLabelToNumber(play.period);
  const clockSec = parseClockDisplayToSeconds(play.clock);
  const elapsedSec =
    parsePeriodClockToElapsedSeconds(play.period, play.clock) ?? 0;
  const homeScore = toNumber(play.homeScore, 0);
  const awayScore = toNumber(play.awayScore, 0);

  const baseType = normalizePbpType({
    id: play.id,
    type: '',
    teamId: play.teamId ?? undefined,
    playerId: primaryId,
    player2Id: secondaryId,
    made,
    shotType,
    clockSec,
    period,
    description: play.text,
    homeScore,
    awayScore,
  });

  const events: PbpEvent[] = [];
  const lower = play.text.toLowerCase();
  const pushEvent = (
    type: string,
    playerId: string | undefined,
    extra?: Partial<PbpEvent>,
  ) => {
    if (!playerId) {
      return;
    }
    events.push({
      id: `${play.id}:${type}:${playerId}`,
      type,
      teamId: play.teamId ?? undefined,
      playerId,
      player2Id: secondaryId,
      points: extra?.points,
      made: extra?.made ?? made,
      shotType: extra?.shotType ?? shotType,
      clockSec,
      period,
      description: play.text,
      homeScore,
      awayScore,
    });
  };

  switch (baseType) {
    case 'MADE_SHOT':
      pushEvent('MADE_SHOT', primaryId, {
        points: shotType === '3PT' ? 3 : 2,
      });
      break;
    case 'MISS_SHOT':
      pushEvent('MISS_SHOT', primaryId);
      break;
    case 'MADE_FT':
      pushEvent('MADE_FT', primaryId, { points: 1, shotType: 'FT', made: true });
      break;
    case 'MISS_FT':
      pushEvent('MISS_FT', primaryId, { points: 0, shotType: 'FT', made: false });
      break;
    case 'REB_OFF':
      pushEvent('REB_OFF', primaryId);
      break;
    case 'REB_DEF':
      pushEvent('REB_DEF', primaryId);
      break;
    case 'TURNOVER':
      pushEvent('TURNOVER', primaryId);
      break;
    case 'FOUL':
      pushEvent('FOUL', primaryId);
      break;
    case 'ASSIST':
      pushEvent('ASSIST', primaryId);
      break;
    case 'STEAL':
      pushEvent('STEAL', primaryId);
      break;
    case 'BLOCK':
      if (lower.includes('block by')) {
        pushEvent('BLOCK', secondaryId);
      } else {
        pushEvent('BLOCK', primaryId);
      }
      break;
    default:
      break;
  }

  if (lower.includes('assisted by') && baseType !== 'ASSIST') {
    pushEvent('ASSIST', secondaryId);
  }
  if (lower.includes('steal') && baseType !== 'STEAL') {
    pushEvent('STEAL', secondaryId);
  }
  if (lower.includes('block by') && baseType !== 'BLOCK') {
    pushEvent('BLOCK', secondaryId);
  }

  const unique = new Map<string, PbpEvent>();
  events.forEach((event) => {
    const key = `${event.type}:${event.playerId ?? ''}`;
    if (!unique.has(key)) {
      unique.set(key, event);
    }
  });

  return [...unique.values()].map((event) => ({
    event,
    elapsedSec,
    leadChangedOnPlay,
  }));
}

function buildSnapshotPlayerBox(player: LiveGamePlayer): PlayerBox {
  return {
    playerId: player.id,
    minutes: Math.max(0, player.minutes),
    points: Math.max(0, player.points),
    fga: Math.max(0, player.fga),
    fgm: Math.max(0, player.fgm),
    fta: Math.max(0, player.fta),
    ftm: Math.max(0, player.ftm),
    oreb: Math.max(0, player.offensiveRebounds),
    dreb: Math.max(0, player.defensiveRebounds),
    reb: Math.max(0, player.rebounds),
    ast: Math.max(0, player.assists),
    stl: Math.max(0, player.steals),
    blk: Math.max(0, player.blocks),
    tov: Math.max(0, player.turnovers),
    pf: Math.max(0, player.fouls),
  };
}

function getActivityEvents(box: PlayerBox): number {
  return (
    box.fga +
    0.5 * box.fta +
    box.tov +
    box.reb +
    box.ast +
    box.stl +
    box.blk +
    box.pf
  );
}

function hasMeaningfulInGameSample(box: PlayerBox): boolean {
  return box.minutes >= 6 || getActivityEvents(box) >= 4;
}

function isFiniteOrNull(value: number | null | undefined): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function formatTimelineMinutesDisplay(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return '0.0';
  }
  return Number(minutes.toFixed(1)).toString();
}

function formatMadeAttempted(made: number, attempted: number): string {
  const safeMade = Math.max(0, Math.round(Number.isFinite(made) ? made : 0));
  const safeAttempted = Math.max(safeMade, Math.round(Number.isFinite(attempted) ? attempted : 0));
  return `${safeMade}-${safeAttempted}`;
}

function timelineStatsFromSnapshot(
  box: PlayerBox,
  threePt: { made: number; attempted: number },
): NonNullable<LiveGameRatingTimelinePoint['stats']> {
  return {
    minutesDisplay: formatTimelineMinutesDisplay(box.minutes),
    pts: Math.max(0, Math.round(box.points)),
    reb: Math.max(0, Math.round(box.reb)),
    ast: Math.max(0, Math.round(box.ast)),
    stl: Math.max(0, Math.round(box.stl)),
    blk: Math.max(0, Math.round(box.blk)),
    tov: Math.max(0, Math.round(box.tov)),
    fls: Math.max(0, Math.round(box.pf)),
    fg: formatMadeAttempted(box.fgm, box.fga),
    threePt: formatMadeAttempted(threePt.made, threePt.attempted),
    ft: formatMadeAttempted(box.ftm, box.fta),
    plusMinus: '0',
    oreb: Math.max(0, Math.round(box.oreb)),
    dreb: Math.max(0, Math.round(box.dreb)),
  };
}

function createInitialRatingTimelinePoint(): LiveGameRatingTimelinePoint {
  return {
    tSec: 0,
    rating: Number(clamp(COLD_START_THRESHOLDS.defaultBaselineRating, 0, 10).toFixed(1)),
    stats: {
      minutesDisplay: '0.0',
      pts: 0,
      reb: 0,
      ast: 0,
      stl: 0,
      blk: 0,
      tov: 0,
      fls: 0,
      fg: '0-0',
      threePt: '0-0',
      ft: '0-0',
      plusMinus: '0',
      oreb: 0,
      dreb: 0,
    },
  };
}

function upsertTimelinePoint(
  points: LiveGameRatingTimelinePoint[],
  point: LiveGameRatingTimelinePoint,
): LiveGameRatingTimelinePoint[] {
  if (points.length === 0) {
    points.push(createInitialRatingTimelinePoint());
  }
  const normalizedPoint: LiveGameRatingTimelinePoint = {
    tSec: Math.max(0, Math.round(point.tSec)),
    rating: Number(clamp(point.rating, 0, 10).toFixed(1)),
    reason: point.reason,
    eventId: point.eventId,
    description: point.description,
    period: point.period,
    clockSec: point.clockSec,
    ratingBefore: point.ratingBefore,
    ratingAfter: point.ratingAfter,
    delta: point.delta,
    displayRatingBefore: point.displayRatingBefore,
    displayRatingAfter: point.displayRatingAfter,
    displayDelta: point.displayDelta,
    stats: point.stats,
  };
  const last = points[points.length - 1];
  if (last && last.tSec === normalizedPoint.tSec) {
    points[points.length - 1] = normalizedPoint;
    return points;
  }
  points.push(normalizedPoint);
  return points;
}

function sortRatingTimelinePointsChronologically(
  points: LiveGameRatingTimelinePoint[],
): LiveGameRatingTimelinePoint[] {
  const dedupedByKey = new Map<string, LiveGameRatingTimelinePoint>();
  const unkeyed: LiveGameRatingTimelinePoint[] = [];
  for (const point of points) {
    const hasPeriod = typeof point.period === 'number' && Number.isFinite(point.period);
    const hasClock = typeof point.clockSec === 'number' && Number.isFinite(point.clockSec);
    if (hasPeriod && hasClock) {
      dedupedByKey.set(`${point.period}|${point.clockSec}`, point);
    } else {
      unkeyed.push(point);
    }
  }
  const result = [...unkeyed, ...dedupedByKey.values()];
  result.sort((a, b) => {
    if (a.period !== b.period) return (a.period ?? 0) - (b.period ?? 0);
    return (b.clockSec ?? 0) - (a.clockSec ?? 0); // clock counts down so higher clock = earlier in period
  });
  return result;
}

function resolveTimelineDurationSec(params: {
  data: LiveGameData;
  playsWithElapsed: Array<{ elapsed: number }>;
  timelineByPlayerId: Map<string, LiveGameRatingTimelinePoint[]>;
}): number {
  const statusElapsed = parsePeriodClockToElapsedSeconds(
    `${Math.max(1, params.data.status.period)}`,
    params.data.status.displayClock,
  );
  const maxTimelineSec = [...params.timelineByPlayerId.values()]
    .flatMap((points) => points.map((point) => point.tSec))
    .reduce((max, current) => Math.max(max, current), 0);
  const maxPlayElapsed = params.playsWithElapsed
    .map((play) => Math.max(0, play.elapsed))
    .reduce((max, current) => Math.max(max, current), 0);
  return Math.max(
    1,
    Math.round(
      Math.max(
        0,
        maxTimelineSec,
        maxPlayElapsed,
        typeof statusElapsed === 'number' && Number.isFinite(statusElapsed) ? statusElapsed : 0,
      ),
    ),
  );
}

function isEligibleForInGameRank(params: {
  box: PlayerBox;
  onCourt: boolean;
  inGameImpactRaw: number | null;
}): boolean {
  return (
    params.onCourt &&
    hasMeaningfulInGameSample(params.box) &&
    typeof params.inGameImpactRaw === 'number' &&
    Number.isFinite(params.inGameImpactRaw)
  );
}

function estimateLast5Window(
  plays: LiveGamePlay[],
  team: LiveGameTeam,
  opponent: LiveGameTeam | undefined,
): { teamPoints: number; oppPoints: number; possessions: number } | null {
  if (plays.length === 0 || !opponent) {
    return null;
  }

  const withTime = plays
    .map((play) => ({
      ...play,
      elapsed: parsePeriodClockToElapsedSeconds(play.period, play.clock),
    }))
    .filter((play) => play.elapsed !== null)
    .sort((a, b) => (a.elapsed as number) - (b.elapsed as number));

  if (withTime.length === 0) {
    return null;
  }

  const latest = withTime[withTime.length - 1];
  const windowStart = (latest.elapsed as number) - 300;
  const windowPlays = withTime.filter((play) => (play.elapsed as number) >= windowStart);
  if (windowPlays.length === 0) {
    return null;
  }

  const first = windowPlays[0];
  const latestTeamScore = team.homeAway === 'home' ? toNumber(latest.homeScore, 0) : toNumber(latest.awayScore, 0);
  const latestOppScore = team.homeAway === 'home' ? toNumber(latest.awayScore, 0) : toNumber(latest.homeScore, 0);
  const firstTeamScore = team.homeAway === 'home' ? toNumber(first.homeScore, 0) : toNumber(first.awayScore, 0);
  const firstOppScore = team.homeAway === 'home' ? toNumber(first.awayScore, 0) : toNumber(first.homeScore, 0);

  const teamPoints = Math.max(0, latestTeamScore - firstTeamScore);
  const oppPoints = Math.max(0, latestOppScore - firstOppScore);

  const possessionEvents = windowPlays.filter((play) =>
    /(makes|misses|turnover|foul|free throw|jumper|layup|dunk|3-pt|three)/i.test(play.text),
  ).length;
  const possessions = Math.max(1, possessionEvents);

  return { teamPoints, oppPoints, possessions };
}

function periodLabel(period: number): string {
  if (period <= 0) {
    return 'Pregame';
  }
  if (period === 1) {
    return '1st Half';
  }
  if (period === 2) {
    return '2nd Half';
  }
  if (period === 3) {
    return 'OT';
  }
  return `${period - 2}OT`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function classifyEventType(playText: string): LiveGameEventType {
  const text = playText.toLowerCase();
  if (text.includes('timeout') || text.includes('time-out')) {
    return 'timeout';
  }
  if (text.includes('substitution') || text.includes('enters') || text.includes('checks in')) {
    return 'substitution';
  }
  if (text.includes('foul') || text.includes('technical') || text.includes('flagrant')) {
    return 'foul';
  }
  if (text.includes('turnover') || text.includes('bad pass') || text.includes('travel')) {
    return 'turnover';
  }
  if (text.includes('injury')) {
    return 'injury';
  }
  if (
    text.includes('makes') ||
    text.includes('misses') ||
    text.includes('dunk') ||
    text.includes('layup') ||
    text.includes('jumper') ||
    text.includes('3-pt')
  ) {
    return 'scoring';
  }
  return 'other';
}

function parseSubstitutionDescription(playText: string): { inPlayer: string; outPlayer: string } | null {
  const lower = playText.toLowerCase();
  if (!lower.includes('substitution') && !lower.includes('enters')) {
    return null;
  }

  const inOutMatch = playText.match(/(.+?)\s+in\s+for\s+(.+)/i);
  if (inOutMatch) {
    return {
      inPlayer: inOutMatch[1].trim(),
      outPlayer: inOutMatch[2].trim(),
    };
  }

  return {
    inPlayer: playText.trim(),
    outPlayer: '�',
  };
}

function parseNormalizedSubstitutionDescription(description: string): { inPlayer: string; outPlayer: string } | null {
  const bulletMatch = description.match(/^\s*(.+?)\s+IN\s+[��-]\s+(.+?)\s+OUT\s*$/i);
  if (bulletMatch) {
    return {
      inPlayer: bulletMatch[1].trim(),
      outPlayer: bulletMatch[2].trim(),
    };
  }
  const inForMatch = description.match(/(.+?)\s+in\s+for\s+(.+)/i);
  if (inForMatch) {
    return {
      inPlayer: inForMatch[1].trim(),
      outPlayer: inForMatch[2].trim(),
    };
  }
  return null;
}

function inferPossessionTeamId(plays: SummaryResponse['plays'], teams: LiveGameTeam[]): string | null {
  const lastPlayWithTeam = [...(plays ?? [])].reverse().find((play) => safeString(play.team?.id, '') !== '');
  const teamId = safeString(lastPlayWithTeam?.team?.id, '');
  return teams.some((team) => team.id === teamId) ? teamId : null;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function estimateTeamPossessions(team: LiveGameTeam | undefined): number | null {
  if (!team) {
    return null;
  }

  const direct = statNumberFromMap(team.totals.statsMap, ['possessions']);
  if (direct !== null && direct > 0) {
    return direct;
  }

  const fga = parseAttemptedValue(team.totals.fg);
  const orb = statNumberFromMap(team.totals.statsMap, ['offensiveRebounds']) ?? 0;
  const tov = toNumber(team.totals.turnovers, 0);
  const fta = parseAttemptedValue(team.totals.ft);
  if (fga === null || fta === null) {
    return null;
  }

  // Tempo-free estimate (paper): Poss = FGA - OR + TO + 0.475 * FTA
  return Math.max(1, fga - orb + tov + 0.475 * fta);
}

function totalGameSecondsForPeriod(
  periodNumber: number,
  timing: PeriodTimingConfig = NCAA_BASKETBALL_PERIOD_TIMING,
): number {
  const { regulationPeriods, regulationPeriodSeconds, overtimeSeconds } = timing;
  if (periodNumber <= regulationPeriods) {
    return regulationPeriods * regulationPeriodSeconds;
  }
  return regulationPeriods * regulationPeriodSeconds + (periodNumber - regulationPeriods) * overtimeSeconds;
}

function sanitizeIsoTimestamp(value: unknown): string | undefined {
  const iso = safeString(value, '');
  if (!iso) {
    return undefined;
  }
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

function buildWinProbability(
  teams: LiveGameTeam[],
  plays: SummaryResponse['plays'],
  currentPeriod: number,
): LiveGameWinProbPoint[] {
  const home = teams.find((team) => team.homeAway === 'home') ?? teams[1];
  const away = teams.find((team) => team.homeAway === 'away') ?? teams[0];
  const homePower = home?.ratings.seasonPower ?? 0;
  const awayPower = away?.ratings.seasonPower ?? 0;
  const strengthEdge = homePower - awayPower;
  const homeCourtPts = 2.8;
  const pregameExpectedMargin = 0.7 * strengthEdge + homeCourtPts;
  const pregameProb = clamp(sigmoid(pregameExpectedMargin / 9.5), 0.03, 0.97);

  if (!plays || plays.length === 0) {
    return [{ time: 0, homeWinProb: pregameProb }];
  }

  const homePoss = estimateTeamPossessions(home);
  const awayPoss = estimateTeamPossessions(away);
  const observedTeamPoss =
    homePoss !== null && awayPoss !== null ? (homePoss + awayPoss) / 2 : null;

  const points: LiveGameWinProbPoint[] = plays.map((play) => {
    const periodNumber = Math.max(toNumber(play.period?.number, currentPeriod || 1), 1);
    const clockValue = safeString(play.clock?.displayValue, periodNumber <= 2 ? '20:00' : '5:00');
    const elapsedRaw = parsePeriodClockToElapsedSeconds(`${periodNumber}`, clockValue);
    const totalGameSeconds = totalGameSecondsForPeriod(periodNumber);
    const elapsed = clamp(elapsedRaw ?? 0, 0, totalGameSeconds);
    const remainingSeconds = clamp(totalGameSeconds - elapsed, 0, totalGameSeconds);
    const progress = totalGameSeconds > 0 ? elapsed / totalGameSeconds : 0;

    const pacePossPerSecond =
      observedTeamPoss !== null && elapsed > 30
        ? observedTeamPoss / elapsed
        : 70 / (2 * 20 * 60);
    const remainingPossessions = clamp(remainingSeconds * pacePossPerSecond, 0, 80);
    const expectedStrengthSwing = (strengthEdge / 100) * remainingPossessions;

    const homeScore = toNumber(play.homeScore, toNumber(home?.score, 0));
    const awayScore = toNumber(play.awayScore, toNumber(away?.score, 0));
    const margin = homeScore - awayScore;
    const lastEventTeamId = safeString(play.team?.id, '');
    const possessionBonus =
      lastEventTeamId !== '' && lastEventTeamId === home?.id
        ? 0.8
        : lastEventTeamId !== '' && lastEventTeamId === away?.id
          ? -0.8
          : 0;

    const uncertaintyPts = Math.max(1.2, 1.8 + 0.9 * Math.sqrt(remainingPossessions));
    const lateGameMultiplier = 1 + 2.8 * progress * progress;
    const expectedFinalMargin =
      margin + expectedStrengthSwing + possessionBonus + homeCourtPts * (1 - progress) * 0.25;
    const modelProb = sigmoid((1.25 * expectedFinalMargin * lateGameMultiplier) / uncertaintyPts);
    const blendWeight = clamp(progress * 0.85, 0.2, 0.98);
    let homeWinProb = pregameProb * (1 - blendWeight) + modelProb * blendWeight;

    if (remainingSeconds <= 1) {
      if (margin > 0) {
        homeWinProb = 0.999;
      } else if (margin < 0) {
        homeWinProb = 0.001;
      } else {
        homeWinProb = 0.5;
      }
    }

    return {
      time: elapsed,
      homeWinProb: clamp(homeWinProb, 0.01, 0.99),
      actualTimeIso: sanitizeIsoTimestamp(play.date),
    };
  });

  const ordered = points.sort((a, b) => a.time - b.time);
  if (ordered[0]?.time !== 0) {
    ordered.unshift({ time: 0, homeWinProb: pregameProb });
  } else {
    ordered[0] = { ...ordered[0], homeWinProb: pregameProb };
  }

  return ordered;
}

// Real running score margin (home - away) over the course of the game, sampled
// at every play. Uses the SAME play -> elapsed-seconds parsing as
// buildWinProbability so the point-differential x-axis lines up exactly with the
// win-probability timeline and the real play-by-play timestamps.
function buildScoreMargin(
  plays: SummaryResponse['plays'],
  currentPeriod: number,
  mode: GameMode,
): LiveGameScoreMarginPoint[] {
  if (!plays || plays.length === 0) {
    return [];
  }

  const timing = getPeriodTimingForMode(mode);
  const points: LiveGameScoreMarginPoint[] = plays.map((play) => {
    const periodNumber = Math.max(toNumber(play.period?.number, currentPeriod || 1), 1);
    const clockValue = safeString(
      play.clock?.displayValue,
      periodNumber <= timing.regulationPeriods
        ? formatMinutesSecondsClock(timing.regulationPeriodSeconds)
        : formatMinutesSecondsClock(timing.overtimeSeconds),
    );
    const elapsedRaw = parsePeriodClockToElapsedSeconds(`${periodNumber}`, clockValue, timing);
    const totalGameSeconds = totalGameSecondsForPeriod(periodNumber, timing);
    const elapsed = clamp(elapsedRaw ?? 0, 0, totalGameSeconds);
    const homeScore = toNumber(play.homeScore, 0);
    const awayScore = toNumber(play.awayScore, 0);
    return {
      time: elapsed,
      margin: homeScore - awayScore,
      period: periodNumber,
      homeScore,
      awayScore,
      actualTimeIso: sanitizeIsoTimestamp(play.date),
    };
  });

  const ordered = points.sort((a, b) => a.time - b.time);
  // Anchor the line at 0-0 / tip-off so the zero baseline and early lead changes
  // render from the true start of the game.
  if (ordered[0]?.time !== 0) {
    ordered.unshift({ time: 0, margin: 0, period: 1, homeScore: 0, awayScore: 0 });
  }
  return ordered;
}

function lastNameFromDisplay(displayName: string, shortName: string): string {
  const source = displayName || shortName;
  const parts = source.split(' ').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '�';
}

function parsePlayersForTeam(section: BoxscorePlayerSection | undefined, teamId: string): LiveGamePlayer[] {
  if (!section) {
    return [];
  }

  const statTables = section.statistics ?? [];
  if (statTables.length === 0) {
    return [];
  }

  const playersById = new Map<string, LiveGamePlayer>();

  statTables.forEach((statTable, tableIndex) => {
    const keys = statTable.keys ?? [];
    const playerRows = statTable.athletes ?? [];

    const keyIndex = (name: string) => keys.indexOf(name);
    const keyIndexAny = (names: string[]): number => {
      for (const name of names) {
        const idx = keyIndex(name);
        if (idx >= 0) {
          return idx;
        }
      }
      return -1;
    };
    const idxMinutes = keyIndex('minutes');
    const idxPoints = keyIndex('points');
    const idxRebounds = keyIndexAny(['rebounds', 'totalRebounds']);
    const idxOffRebounds = keyIndexAny(['offensiveRebounds', 'offRebounds']);
    const idxDefRebounds = keyIndexAny(['defensiveRebounds', 'defRebounds']);
    const idxAssists = keyIndex('assists');
    const idxTurnovers = keyIndex('turnovers');
    const idxSteals = keyIndex('steals');
    const idxBlocks = keyIndex('blocks');
    const idxFouls = keyIndex('fouls');
    const idxFg = keyIndex('fieldGoalsMade-fieldGoalsAttempted');
    const idxThreePt = keyIndex('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
    const idxFt = keyIndex('freeThrowsMade-freeThrowsAttempted');
    const idxPlusMinus = keyIndex('plusMinus');

    playerRows.forEach((row: AthleteEntry, index: number) => {
      const stats = row.stats ?? [];
      const name = safeString(row.athlete?.displayName, safeString(row.athlete?.shortName));
      const shortName = safeString(row.athlete?.shortName, name);
      const minutesDisplay = idxMinutes >= 0 ? safeString(stats[idxMinutes]) : '�';

      const fgText = idxFg >= 0 ? safeString(stats[idxFg]) : '�';
      const ftText = idxFt >= 0 ? safeString(stats[idxFt]) : '�';
      const plusMinusText = idxPlusMinus >= 0 ? safeString(stats[idxPlusMinus]) : '�';
      const offensiveRebounds = idxOffRebounds >= 0 ? toNumber(stats[idxOffRebounds], 0) : 0;
      const defensiveRebounds = idxDefRebounds >= 0 ? toNumber(stats[idxDefRebounds], 0) : 0;
      const totalRebounds =
        idxRebounds >= 0
          ? toNumber(stats[idxRebounds], 0)
          : offensiveRebounds + defensiveRebounds;
      const fg = parseMadeAttempted(fgText);
      const ft = parseMadeAttempted(ftText);
      const playerId = safeString(row.athlete?.id, `${teamId}-${tableIndex}-${index}`);

      const nextPlayer: LiveGamePlayer = {
        id: playerId,
        teamId,
        name,
        shortName,
        lastName: lastNameFromDisplay(name, shortName),
        jersey: safeString(row.athlete?.jersey),
        position: safeString(row.athlete?.position?.abbreviation),
        ...resolveHeightMetadata({
          displayHeight: row.athlete?.displayHeight,
          height: row.athlete?.height,
        }),
        headshot: safeString(row.athlete?.headshot?.href, ''),
        starter: Boolean(row.starter),
        active: Boolean(row.active),
        didNotPlay: Boolean(row.didNotPlay),
        minutes: toNumber(minutesDisplay, 0),
        minutesDisplay,
        points: idxPoints >= 0 ? toNumber(stats[idxPoints], 0) : 0,
        rebounds: totalRebounds,
        assists: idxAssists >= 0 ? toNumber(stats[idxAssists], 0) : 0,
        turnovers: idxTurnovers >= 0 ? toNumber(stats[idxTurnovers], 0) : 0,
        steals: idxSteals >= 0 ? toNumber(stats[idxSteals], 0) : 0,
        blocks: idxBlocks >= 0 ? toNumber(stats[idxBlocks], 0) : 0,
        fouls: idxFouls >= 0 ? toNumber(stats[idxFouls], 0) : 0,
        offensiveRebounds,
        defensiveRebounds,
        fg: fgText,
        threePt: idxThreePt >= 0 ? safeString(stats[idxThreePt]) : '�',
        ft: ftText,
        plusMinus: plusMinusText,
        plusMinusValue: parseSignedStat(plusMinusText),
        liveEffPerMin: 0,
        seasonEffPerMin: null,
        seasonImpactRaw: null,
        inGameImpactRaw: null,
        liveRawBase: null,
        liveRaw: null,
        liveDisplay: '-' as const,
        seasonRating10: null,
        inGameRating10: null,
        lowSample: false,
        gameRating: null,
        seasonRating: null,
        gameRank: null,
        seasonRank: null,
        minutesIncreasing: false,
        onCourt: false,
        minuteDelta: 0,
        fgm: fg.made,
        fga: fg.attempted,
        ftm: ft.made,
        fta: ft.attempted,
      };

      const existing = playersById.get(playerId);
      if (!existing || nextPlayer.minutes >= existing.minutes) {
        playersById.set(playerId, nextPlayer);
      }
    });
  });

  return [...playersById.values()];
}

type BaseballPlayEntry = NonNullable<BaseballSummaryResponse['plays']>[number];

function parseBaseballHalf(
  prefix: string | undefined,
  state?: string,
  playType?: string,
): BaseballGameSituation['half'] {
  const normalized = safeString(playType || prefix, '').toLowerCase();
  if (normalized.startsWith('top')) return 'top';
  if (normalized.startsWith('bottom')) return 'bottom';
  if (normalized.startsWith('middle')) return 'middle';
  if (normalized.startsWith('end')) return 'end';
  const normalizedState = safeString(state, '').toLowerCase();
  if (normalizedState === 'pre') return 'pregame';
  if (normalizedState === 'post') return 'final';
  return 'unknown';
}

function parseBaseballCount(raw: string | undefined): { balls: number | null; strikes: number | null } {
  const text = safeString(raw, '');
  const match = text.match(/(\d+)\s*-\s*(\d+)/);
  if (!match) {
    return { balls: null, strikes: null };
  }
  const first = Number.parseInt(match[1], 10);
  const second = Number.parseInt(match[2], 10);
  return {
    balls: Number.isFinite(first) ? first : null,
    strikes: Number.isFinite(second) ? second : null,
  };
}

function buildBaseballBases(play?: BaseballPlayEntry): BaseballBaseOccupancy {
  return {
    first: Boolean(play?.onFirst),
    second: Boolean(play?.onSecond),
    third: Boolean(play?.onThird),
  };
}

function formatBaseballInningLabel(half: BaseballGameSituation['half'], inning: number | null): string {
  if (half === 'pregame') {
    return 'Pregame';
  }
  if (half === 'final') {
    return 'Final';
  }
  if (!inning) {
    return 'Scheduled';
  }
  if (half === 'top') {
    return `Top ${inning}`;
  }
  if (half === 'bottom') {
    return `Bot ${inning}`;
  }
  if (half === 'middle') {
    return `Mid ${inning}`;
  }
  if (half === 'end') {
    return `End ${inning}`;
  }
  return `Inning ${inning}`;
}

function extractBaseballSituation(
  competitionStatus:
    | {
        period?: number;
        periodPrefix?: string;
        type?: { state?: string; shortDetail?: string; detail?: string; description?: string };
      }
    | undefined,
  lastPlay?: BaseballPlayEntry,
): BaseballGameSituation | null {
  if (!competitionStatus && !lastPlay) {
    return null;
  }
  const inning = toNumber(lastPlay?.period?.number, toNumber(competitionStatus?.period, 0)) || null;
  const half = parseBaseballHalf(
    competitionStatus?.periodPrefix,
    competitionStatus?.type?.state,
    lastPlay?.period?.type,
  );
  const count = parseBaseballCount(lastPlay?.resultCount ?? lastPlay?.pitchCount);
  const label =
    safeString(competitionStatus?.type?.shortDetail, '') ||
    safeString(competitionStatus?.type?.detail, '') ||
    safeString(competitionStatus?.type?.description, '') ||
    formatBaseballInningLabel(half, inning);

  return {
    inning,
    half,
    label,
    outs: typeof lastPlay?.outs === 'number' ? lastPlay.outs : null,
    balls: count.balls,
    strikes: count.strikes,
    bases: buildBaseballBases(lastPlay),
  };
}

function toNamedStatMap(
  stats?: Array<{ name?: string; displayValue?: string; value?: number }>,
): Record<string, string> {
  return (stats ?? []).reduce<Record<string, string>>((map, stat) => {
    const key = safeString(stat.name, '');
    if (!key) {
      return map;
    }
    map[key] = safeString(stat.displayValue, stat.value !== undefined ? `${stat.value}` : '');
    return map;
  }, {});
}

function getBaseballStatValue(stats: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const hit = safeString(stats[key], '');
    if (hit) {
      return hit;
    }
  }
  return '';
}

function getBaseballNumber(stats: Record<string, string>, keys: string[]): number {
  return toNumber(getBaseballStatValue(stats, keys), 0);
}

function buildBaseballPlayerCard(params: {
  batting: BaseballBattingLine | null;
  pitching: BaseballPitchingLine | null;
  fielding: BaseballFieldingLine | null;
  impact?: BaseballComputedGameImpact | null;
}): BaseballPlayerCardData {
  const role =
    params.batting && params.pitching
      ? 'two-way'
      : params.pitching
        ? 'pitcher'
        : params.batting
          ? 'batter'
          : 'unknown';

  return {
    role,
    batting: params.batting,
    pitching: params.pitching,
    fielding: params.fielding,
    primaryLine:
      role === 'pitcher' || role === 'two-way'
        ? `IP ${toDisplayNumber(params.pitching?.inningsPitched, 1)} • K ${params.pitching?.strikeouts ?? 0} • ER ${params.pitching?.earnedRuns ?? 0}`
        : `${params.batting?.hits ?? 0}-${params.batting?.atBats ?? 0} • RBI ${params.batting?.runsBattedIn ?? 0} • HR ${params.batting?.homeRuns ?? 0}`,
    secondaryLine:
      role === 'pitcher' || role === 'two-way'
        ? `ERA ${toDisplayNumber(params.pitching?.era, 2)} • WHIP ${toDisplayNumber(params.pitching?.whip, 2)}`
        : `AVG ${toDisplayNumber(params.batting?.battingAverage, 3)} • OPS ${toDisplayNumber(params.batting?.ops, 3)}`,
  };
}

function toDisplayNumber(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  return value.toFixed(digits);
}

function parseBaseballPlayersForTeam(
  section: BoxscorePlayerSection | undefined,
  teamId: string,
  context: {
    gameId: string;
    date: string;
    opponent?: string;
    teamRuns?: number | null;
    opponentRuns?: number | null;
    isLateInning?: boolean;
  },
): LiveGamePlayer[] {
  if (!section) {
    return [];
  }

  const playersById = new Map<
    string,
    {
      meta: Pick<
        LiveGamePlayer,
        | 'id'
        | 'teamId'
        | 'name'
        | 'shortName'
        | 'lastName'
        | 'jersey'
        | 'position'
        | 'headshot'
        | 'starter'
        | 'active'
        | 'didNotPlay'
      >;
      batting: BaseballBattingLine | null;
      pitching: BaseballPitchingLine | null;
      fielding: BaseballFieldingLine | null;
    }
  >();

  const statTables = section.statistics ?? [];
  statTables.forEach((table, tableIndex) => {
    const tableType = safeString(table.type, safeString(table.name, '')).toLowerCase();
    const keys = table.keys ?? [];
    (table.athletes ?? []).forEach((row: AthleteEntry, athleteIndex) => {
      const playerId = safeString(row.athlete?.id, `${teamId}-${tableIndex}-${athleteIndex}`);
      const name = safeString(row.athlete?.displayName, safeString(row.athlete?.shortName, `Player ${athleteIndex + 1}`));
      const shortName = safeString(row.athlete?.shortName, name);
      const existing = playersById.get(playerId) ?? {
        meta: {
          id: playerId,
          teamId,
          name,
          shortName,
          lastName: lastNameFromDisplay(name, shortName),
          jersey: sanitizeJersey(row.athlete?.jersey),
          position: safeString(row.position?.abbreviation, safeString(row.athlete?.position?.abbreviation)),
          headshot: sanitizeHeadshotUri(row.athlete?.headshot?.href),
          starter: Boolean(row.starter),
          active: row.active !== false,
          didNotPlay: Boolean(row.didNotPlay),
        },
        batting: null as BaseballBattingLine | null,
        pitching: null as BaseballPitchingLine | null,
        fielding: null as BaseballFieldingLine | null,
      };

      const candidatePosition = safeString(
        row.position?.abbreviation,
        safeString(row.athlete?.position?.abbreviation, ''),
      );
      const candidateJersey = sanitizeJersey(row.athlete?.jersey, '');
      const candidateHeadshot = sanitizeHeadshotUri(row.athlete?.headshot?.href);
      if (candidatePosition && existing.meta.position === '�') {
        existing.meta.position = candidatePosition;
      }
      if (candidateJersey && existing.meta.jersey === '-') {
        existing.meta.jersey = candidateJersey;
      }
      if (candidateHeadshot && !existing.meta.headshot) {
        existing.meta.headshot = candidateHeadshot;
      }
      existing.meta.active = existing.meta.active || row.active !== false;
      existing.meta.starter = existing.meta.starter || Boolean(row.starter);
      existing.meta.didNotPlay = existing.meta.didNotPlay && Boolean(row.didNotPlay);

      const statsArray = row.stats ?? [];
      const stats = keys.reduce<Record<string, string>>((map, key, index) => {
        map[key] = safeString(statsArray[index], '');
        return map;
      }, {});

      if (tableType === 'batting') {
        const atBats = getBaseballNumber(stats, ['atBats', 'AB']);
        const hits = getBaseballNumber(stats, ['hits', 'H']);
        const walks = getBaseballNumber(stats, ['walks', 'BB']);
        existing.batting = {
          atBats,
          runs: getBaseballNumber(stats, ['runs', 'R']),
          hits,
          runsBattedIn: getBaseballNumber(stats, ['RBIs', 'rbi', 'RBI']),
          homeRuns: getBaseballNumber(stats, ['homeRuns', 'HR']),
          walks,
          strikeouts: getBaseballNumber(stats, ['strikeouts', 'SO', 'K']),
          doubles: getBaseballNumber(stats, ['doubles', '2B']),
          triples: getBaseballNumber(stats, ['triples', '3B']),
          stolenBases: getBaseballNumber(stats, ['stolenBases', 'SB']),
          battingAverage: toNumber(getBaseballStatValue(stats, ['avg', 'battingAverage']), hits > 0 || atBats > 0 ? hits / Math.max(1, atBats) : 0),
          onBasePct: toNumber(
            getBaseballStatValue(stats, ['onBasePct', 'OBP']),
            atBats + walks > 0 ? (hits + walks) / (atBats + walks) : 0,
          ),
          sluggingPct: toNumber(getBaseballStatValue(stats, ['slugAvg', 'SLG']), 0),
          ops: toNumber(getBaseballStatValue(stats, ['OPS', 'ops']), 0),
        };
        if (!existing.batting.sluggingPct && atBats > 0) {
          const totalBases =
            hits +
            existing.batting.doubles +
            existing.batting.triples * 2 +
            existing.batting.homeRuns * 3;
          existing.batting.sluggingPct = totalBases / atBats;
        }
        if (!existing.batting.ops) {
          const obp = existing.batting.onBasePct ?? 0;
          const slg = existing.batting.sluggingPct ?? 0;
          existing.batting.ops = obp + slg;
        }
      }

      if (tableType === 'pitching') {
        const inningsText = getBaseballStatValue(stats, ['fullInnings.partInnings', 'inningsPitched', 'IP']);
        const inningsPitched = toNumber(inningsText, Number.parseFloat(inningsText) || 0);
        const pitchesStrikes = getBaseballStatValue(stats, ['pitches-strikes']);
        const pitchParts = pitchesStrikes.split('-');
        existing.pitching = {
          inningsPitched,
          hitsAllowed: getBaseballNumber(stats, ['hits', 'H']),
          runsAllowed: getBaseballNumber(stats, ['runs', 'R']),
          earnedRuns: getBaseballNumber(stats, ['earnedRuns', 'ER']),
          walks: getBaseballNumber(stats, ['walks', 'BB']),
          strikeouts: getBaseballNumber(stats, ['strikeouts', 'SO', 'K']),
          homeRunsAllowed: getBaseballNumber(stats, ['homeRuns', 'HR']),
          pitches: getBaseballNumber(stats, ['pitches']),
          strikes: pitchParts.length === 2 ? toNumber(pitchParts[1], 0) : 0,
          era: toNumber(getBaseballStatValue(stats, ['ERA', 'era']), 0),
          whip: toNumber(getBaseballStatValue(stats, ['WHIP', 'whip']), 0),
        };
        if (!existing.pitching.era && inningsPitched > 0) {
          existing.pitching.era = (existing.pitching.earnedRuns * 9) / inningsPitched;
        }
        if (!existing.pitching.whip && inningsPitched > 0) {
          existing.pitching.whip =
            (existing.pitching.walks + existing.pitching.hitsAllowed) / inningsPitched;
        }
      }

      if (tableType === 'fielding') {
        const putouts = getBaseballNumber(stats, ['putouts', 'PO']);
        const assists = getBaseballNumber(stats, ['assists', 'A']);
        const errors = getBaseballNumber(stats, ['errors', 'E']);
        existing.fielding = {
          putouts,
          assists,
          errors,
          fieldingPct: toNumber(
            getBaseballStatValue(stats, ['fieldingPct', 'FPCT']),
            putouts + assists + errors > 0 ? (putouts + assists) / (putouts + assists + errors) : 0,
          ),
        };
      }

      playersById.set(playerId, existing);
    });
  });

  const liveImpacts = computeBaseballGameImpacts(
    [...playersById.values()].map(({ meta, batting, pitching, fielding }) => ({
      playerId: meta.id,
      playerName: meta.name,
      teamId,
      position: meta.position,
      batting,
      pitching,
      fielding,
      game: {
        gameId: context.gameId,
        date: context.date,
        opponent: context.opponent,
        teamRuns: context.teamRuns ?? null,
        opponentRuns: context.opponentRuns ?? null,
        finalMargin:
          typeof context.teamRuns === 'number' && typeof context.opponentRuns === 'number'
            ? context.teamRuns - context.opponentRuns
            : null,
        isCloseGame:
          typeof context.teamRuns === 'number' && typeof context.opponentRuns === 'number'
            ? Math.abs(context.teamRuns - context.opponentRuns) <= 2
            : null,
        leverageKnown:
          typeof context.teamRuns === 'number' && typeof context.opponentRuns === 'number',
        isLateInning: context.isLateInning ?? false,
        starterHint: meta.starter,
      },
    })),
  );
  const liveImpactByPlayerId = new Map(liveImpacts.map((impact) => [impact.playerId, impact] as const));

  return [...playersById.values()]
    .map(({ meta, batting, pitching, fielding }) => {
      const liveImpact = liveImpactByPlayerId.get(meta.id) ?? null;
      const ratingResult = liveImpact
        ? {
            rating: liveImpact.output.overallRating,
            breakdown: liveImpact.output.breakdown,
          }
        : computeBaseballRating({ batting, pitching, fielding });
      const cardData = {
        ...buildBaseballPlayerCard({ batting, pitching, fielding, impact: liveImpact }),
        impactRating: liveImpact?.output.overallRating ?? null,
        seasonAverageRating: liveImpact?.output.overallRating ?? null,
        impactShare: liveImpact?.output.impactShare ?? null,
        confidence: liveImpact?.output.confidence ?? null,
        impactRole: liveImpact?.output.role ?? null,
        trendDelta: null,
        breakdown: liveImpact?.output.breakdown ?? [],
      } satisfies BaseballPlayerCardData;
      const minutes = pitching?.inningsPitched ?? batting?.atBats ?? 0;
      const minutesDisplay =
        cardData.role === 'pitcher' || cardData.role === 'two-way'
          ? `IP ${toDisplayNumber(pitching?.inningsPitched, 1)}`
          : `AB ${batting?.atBats ?? 0}`;
      return {
        ...meta,
        heightInches: null,
        heightDisplay: '-',
        minutes,
        minutesDisplay,
        points: batting?.runsBattedIn ?? 0,
        rebounds: batting?.hits ?? 0,
        assists: batting?.runs ?? 0,
        turnovers: batting?.strikeouts ?? 0,
        steals: batting?.stolenBases ?? 0,
        blocks: pitching?.strikeouts ?? 0,
        fouls: fielding?.errors ?? 0,
        offensiveRebounds: batting?.walks ?? 0,
        defensiveRebounds: batting?.hits ?? 0,
        fg: `${batting?.hits ?? 0}-${batting?.atBats ?? 0}`,
        threePt: `${batting?.homeRuns ?? 0}-${batting?.atBats ?? 0}`,
        ft: `${pitching?.strikes ?? 0}-${pitching?.pitches ?? 0}`,
        plusMinus: safeString(
          cardData.role === 'pitcher' || cardData.role === 'two-way'
            ? `${pitching?.earnedRuns ?? 0} ER`
            : `${batting?.runsBattedIn ?? 0} RBI`,
          '0',
        ),
        plusMinusValue: 0,
        liveEffPerMin: ratingResult.rating,
        seasonEffPerMin: null,
        seasonImpactRaw: null,
        inGameImpactRaw: ratingResult.rating,
        liveRawBase: ratingResult.rating,
        liveRaw: ratingResult.rating,
        liveDisplay: ratingResult.rating,
        seasonRating10: null,
        inGameRating10: ratingResult.rating,
        lowSample: false,
        gameRating: ratingResult.rating,
        seasonRating: null,
        gameRank: null,
        seasonRank: null,
        minutesIncreasing: false,
        onCourt: false,
        minuteDelta: 0,
        ratingTimelinePoints: [{ tSec: 0, rating: ratingResult.rating }],
        ratingTimelineDurationSec: 0,
        fgm: batting?.hits ?? 0,
        fga: batting?.atBats ?? 0,
        ftm: pitching?.strikes ?? 0,
        fta: pitching?.pitches ?? 0,
        sport: 'baseball' as const,
        baseball: cardData,
      } satisfies LiveGamePlayer;
    })
    .sort(
      (a, b) =>
        (b.inGameRating10 ?? 0) - (a.inGameRating10 ?? 0) ||
        b.points - a.points ||
        b.rebounds - a.rebounds ||
        a.lastName.localeCompare(b.lastName),
    )
    .map((player, index) => ({
      ...player,
      gameRank: index + 1,
    }));
}

function parseBaseballData(
  summary: BaseballSummaryResponse,
  mode: GameMode,
  gameId: string,
  summaryUrl: string,
): { data: LiveGameData; parsedCounts: Record<string, number> } {
  const comp = summary.header?.competitions?.[0];
  const competitors = comp?.competitors ?? [];
  const awayCompetitor = competitors.find((competitor) => competitor.homeAway === 'away') ?? competitors[0];
  const homeCompetitor = competitors.find((competitor) => competitor.homeAway === 'home') ?? competitors[1];
  const boxTeams = summary.boxscore?.teams ?? [];
  const boxPlayers = summary.boxscore?.players ?? [];
  const lastPlay = [...(summary.plays ?? [])].reverse().find(Boolean);
  const baseballSituation = extractBaseballSituation(comp?.status, lastPlay);

  const mapConference = (
    group?: {
      id?: string;
      name?: string;
      shortName?: string;
    } | null,
  ): LiveGameConference => {
    const shortName = safeString(group?.shortName, safeString(group?.name));
    if (!shortName) {
      return null;
    }
    return {
      id: safeString(group?.id) || undefined,
      name: safeString(group?.name, shortName) || undefined,
      shortName,
    };
  };

  const teams: LiveGameTeam[] = [awayCompetitor, homeCompetitor]
    .filter((competitor): competitor is SummaryCompetitor => Boolean(competitor))
    .map((competitor, index) => {
      const teamId = safeString(competitor.team?.id, `team-${index}`);
      const boxTeam = boxTeams.find((candidate) => safeString(candidate.team?.id, '') === teamId);
      const sections = boxTeam?.statistics ?? [];
      const battingStats = toNamedStatMap(sections.find((row) => safeString(row.name, '').toLowerCase() === 'batting')?.stats);
      const pitchingStats = toNamedStatMap(sections.find((row) => safeString(row.name, '').toLowerCase() === 'pitching')?.stats);
      const fieldingStats = toNamedStatMap(sections.find((row) => safeString(row.name, '').toLowerCase() === 'fielding')?.stats);
      const runs = safeString(competitor.score, '0');
      const hits = `${toNumber(competitor.hits, 0)}`;
      const errors = `${toNumber(competitor.errors, 0)}`;
      const scoreDiff = toNumber(competitor.score, 0) - toNumber(
        competitors.find((candidate) => safeString(candidate.team?.id, '') !== teamId)?.score,
        0,
      );
      const liveRating = Number(clamp(5 + scoreDiff * 0.45 + toNumber(competitor.hits, 0) * 0.08 - toNumber(competitor.errors, 0) * 0.25, 0, 10).toFixed(1));
      const totalRecord =
        competitor.record?.find((entry) => safeString(entry.type) === 'total')?.displayValue ??
        competitor.record?.find((entry) => safeString(entry.type) === 'total')?.summary ??
        '';

      return {
        id: teamId,
        abbreviation: safeString(competitor.team?.abbreviation, ''),
        displayName: safeString(competitor.team?.displayName),
        shortDisplayName: safeString(competitor.team?.shortDisplayName, safeString(competitor.team?.displayName)),
        record: safeString(totalRecord),
        homeAway: competitor.homeAway ?? 'unknown',
        logo: safeString(competitor.team?.logo, safeString(competitor.team?.logos?.[0]?.href, '')),
        color: safeString(competitor.team?.color, ''),
        alternateColor: safeString(competitor.team?.alternateColor, ''),
        conference: mapConference(comp?.groups),
        score: runs,
        linescores: (competitor.linescores ?? []).map((line) => safeString(line.displayValue, `${toNumber(line.value, 0)}`)),
        totals: {
          fg: '-',
          fgPct: '-',
          threePt: '-',
          threePtPct: '-',
          ft: '-',
          ftPct: '-',
          rebounds: '-',
          assists: '-',
          turnovers: '-',
          fouls: '-',
          benchPoints: '-',
          statsMap: {},
          baseball: {
            runs,
            hits,
            errors,
            batting: battingStats,
            pitching: pitchingStats,
            fielding: fieldingStats,
          },
        },
        ratings: {
          seasonPower: null,
          gameNetRtg: scoreDiff,
          last5MinNetRtg: null,
          liveRating,
        },
        sport: 'baseball',
        baseball: {
          lineScore: (competitor.linescores ?? []).map((line) => safeString(line.displayValue, `${toNumber(line.value, 0)}`)),
          runs,
          hits,
          errors,
          situation: baseballSituation,
          probableStarter: null,
        },
      };
    });

  const playersByTeam: Record<string, LiveGamePlayer[]> = {};
  const parsedCounts: Record<string, number> = {};
  teams.forEach((team) => {
    const section = boxPlayers.find((candidate) => safeString(candidate.team?.id, '') === team.id);
    const opponent = teams.find((candidate) => candidate.id !== team.id);
    const parsedPlayers = parseBaseballPlayersForTeam(section, team.id, {
      gameId,
      date: safeString(summary.header?.competitions?.[0]?.date, new Date().toISOString()),
      opponent: opponent?.shortDisplayName,
      teamRuns: toNumber(team.score, 0),
      opponentRuns: opponent ? toNumber(opponent.score, 0) : null,
      isLateInning: (baseballSituation?.inning ?? 0) >= 7,
    });
    playersByTeam[team.id] = parsedPlayers;
    parsedCounts[team.shortDisplayName] = parsedPlayers.length;
  });

  const parsedOnFieldState = parseBaseballOnFieldState(summary);
  const overlayPlayerLookup = new Map<string, LiveGamePlayer>();
  const overlayPlayerLookupByTeamJersey = new Map<string, LiveGamePlayer>();
  const overlayPlayerLookupByTeamName = new Map<string, LiveGamePlayer>();
  const allOverlayPlayers = Object.values(playersByTeam).flat();

  allOverlayPlayers.forEach((player) => {
    if (player.id) {
      overlayPlayerLookup.set(player.id, player);
    }

    const normalizedJersey = sanitizeJersey(player.jersey, '');
    if (player.teamId && normalizedJersey) {
      overlayPlayerLookupByTeamJersey.set(`${player.teamId}:${normalizedJersey}`, player);
    }

    const normalizedName = normalizeLookupText(player.name || player.shortName || player.lastName);
    if (player.teamId && normalizedName) {
      overlayPlayerLookupByTeamName.set(`${player.teamId}:${normalizedName}`, player);
    }
    const normalizedLastName = normalizeLookupText(player.lastName);
    if (player.teamId && normalizedLastName) {
      overlayPlayerLookupByTeamName.set(`${player.teamId}:${normalizedLastName}`, player);
    }
  });

  const resolveOverlayPlayer = (
    player: NonNullable<typeof parsedOnFieldState.defense.P>,
  ): LiveGamePlayer | null => {
    const exactById = overlayPlayerLookup.get(player.id);
    if (exactById) {
      return exactById;
    }

    const normalizedJersey = sanitizeJersey(player.jersey, '');
    if (player.teamId && normalizedJersey) {
      const byTeamJersey = overlayPlayerLookupByTeamJersey.get(`${player.teamId}:${normalizedJersey}`);
      if (byTeamJersey) {
        return byTeamJersey;
      }
    }

    const normalizedName = normalizeLookupText(player.name || player.shortName || player.lastName);
    if (player.teamId && normalizedName) {
      const byTeamName = overlayPlayerLookupByTeamName.get(`${player.teamId}:${normalizedName}`);
      if (byTeamName) {
        return byTeamName;
      }
    }

    return null;
  };

  const mapOnFieldPlayer = (
    player: NonNullable<typeof parsedOnFieldState.defense.P> | null,
  ): LiveGamePlayer | null => {
    if (!player) {
      return null;
    }
    const existing = resolveOverlayPlayer(player);
    const mapped = mapEspnAthleteToOverlayPlayer(player, existing);
    return {
      ...mapped,
      headshot: sanitizeHeadshotUri(mapped.headshot || player.headshot),
      jersey: sanitizeJersey(mapped.jersey || player.jersey),
    };
  };

  const baseballOnField: BaseballOnFieldState<LiveGamePlayer> = {
    defense: BASEBALL_DEFENSIVE_POSITIONS.reduce((accumulator, position) => {
      accumulator[position] = mapOnFieldPlayer(parsedOnFieldState.defense[position]);
      return accumulator;
    }, {
      P: null,
      C: null,
      "1B": null,
      "2B": null,
      "3B": null,
      SS: null,
      LF: null,
      CF: null,
      RF: null,
    } as Record<(typeof BASEBALL_DEFENSIVE_POSITIONS)[number], LiveGamePlayer | null>),
    batter: mapOnFieldPlayer(parsedOnFieldState.batter),
    runners: {
      first: mapOnFieldPlayer(parsedOnFieldState.runners.first),
      second: mapOnFieldPlayer(parsedOnFieldState.runners.second),
      third: mapOnFieldPlayer(parsedOnFieldState.runners.third),
    },
    meta: parsedOnFieldState.meta,
  };

  const plays: LiveGamePlay[] = (summary.plays ?? []).map((play, index) => {
    const situation = extractBaseballSituation(comp?.status, play);
    return {
      id: safeString(play.id, `play-${index}`),
      text: safeString(play.text),
      shortDescription: safeString(play.shortDescription),
      period: formatBaseballInningLabel(situation?.half ?? 'unknown', situation?.inning ?? null),
      clock: safeString(play.clock?.displayValue, safeString(play.resultCount, '')),
      awayScore: `${toNumber(play.awayScore, 0)}`,
      homeScore: `${toNumber(play.homeScore, 0)}`,
      scoringPlay: Boolean(play.scoringPlay),
      teamId: safeString(play.team?.id, '') || null,
      sport: 'baseball',
      baseball: situation
        ? {
            inning: situation.inning,
            half: situation.half,
            outs: situation.outs,
            balls: situation.balls,
            strikes: situation.strikes,
            bases: situation.bases,
          }
        : undefined,
    };
  });

  const keyEvents: LiveGameKeyEvent[] = plays.map((play) => ({
    id: play.id,
    period: play.period,
    clock: play.clock,
    eventType: play.scoringPlay ? 'scoring' : 'other',
    description: play.text,
    homeScore: play.homeScore,
    awayScore: play.awayScore,
  }));

  const statusState = safeString(comp?.status?.type?.state);
  const data: LiveGameData = {
    mode,
    sport: 'baseball',
    eventId: gameId,
    summaryUrl,
    status: {
      state: statusState,
      description: safeString(comp?.status?.type?.description),
      detail: safeString(comp?.status?.type?.detail),
      shortDetail: safeString(comp?.status?.type?.shortDetail),
      period: toNumber(comp?.status?.period, 0),
      displayClock: safeString(comp?.status?.displayClock),
      periodLabel: baseballSituation?.label ?? safeString(comp?.status?.type?.shortDetail, 'Scheduled'),
      baseball: baseballSituation,
    },
    meta: {
      competition: safeString(comp?.notes?.[0]?.headline, 'NCAA Baseball'),
      round: safeString(comp?.type?.shortDetail, 'Regular Season'),
      venue: safeString(comp?.venue?.fullName),
      attendance: `${toNumber(comp?.attendance, 0)}`,
      startDateTime: safeString(comp?.date, ''),
      officials: (comp?.officials ?? [])
        .map((official) => safeString(official.fullName, ''))
        .filter((official) => official.length > 0),
      broadcasters: (comp?.broadcasts ?? [])
        .flatMap((broadcast) => broadcast.names ?? [])
        .map((name) => safeString(name, ''))
        .filter((name) => name.length > 0),
    },
    possessionTeamId: safeString(lastPlay?.team?.id, '') || null,
    teams,
    playersByTeam,
    plays,
    keyEvents,
    substitutions: [],
    winProbability: [],
    scoreMargin: buildScoreMargin(summary.plays, toNumber(comp?.status?.period, 0), mode),
    seasonRankings: [],
    liveRankings: teams
      .filter((team) => team.ratings.liveRating !== null)
      .map((team) => ({ teamId: team.id, value: team.ratings.liveRating as number }))
      .sort((a, b) => b.value - a.value),
    baseballOnField,
  };

  return { data, parsedCounts };
}

function parseData(
  summary: SummaryResponse,
  mode: GameMode,
  gameId: string,
  summaryUrl: string,
  seasonPowerCache?: Map<string, SeasonPowerCacheEntry>,
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): { data: LiveGameData; parsedCounts: Record<string, number> } {
  if (mode === 'baseball') {
    return parseBaseballData(summary as BaseballSummaryResponse, mode, gameId, summaryUrl);
  }

  const comp = summary.header?.competitions?.[0];
  const competitors = comp?.competitors ?? [];
  const boxTeams = summary.boxscore?.teams ?? [];
  const boxPlayers = summary.boxscore?.players ?? [];
  const competitionGroup = comp?.groups;

  const mapConference = (
    group?: {
      id?: string;
      name?: string;
      shortName?: string;
    } | null,
  ): LiveGameConference => {
    const shortName = safeString(group?.shortName, safeString(group?.name));
    if (!shortName) {
      return null;
    }
    return {
      id: safeString(group?.id) || undefined,
      name: safeString(group?.name, shortName) || undefined,
      shortName,
    };
  };

  const resolveCompetitorConference = (
    competitor: SummaryCompetitor | undefined,
  ): LiveGameConference => {
    const fallbackConference =
      competitionGroup?.isConference &&
      safeString(competitionGroup.id) === safeString(competitor?.team?.conferenceId)
        ? mapConference(competitionGroup)
        : null;

    return fallbackConference ?? mapConference(competitionGroup);
  };

  const teams: LiveGameTeam[] = competitors.map((competitor, index) => {
    const teamId = safeString(competitor.team?.id, `team-${index}`);
    const boxTeam = boxTeams.find((candidate) => safeString(candidate.team?.id, '') === teamId);

    const statsMap = toStatMap(boxTeam?.statistics);
    const playerSection = boxPlayers.find((candidate) => safeString(candidate.team?.id, '') === teamId);
    const parsedPlayers = parsePlayersForTeam(playerSection, teamId);
    const benchPoints = parsedPlayers
      .filter((player) => !player.starter)
      .reduce((sum, player) => sum + player.points, 0);
    const totalRecord =
      competitor.record?.find((entry) => safeString(entry.type) === 'total')
        ?.displayValue ??
      competitor.record?.find((entry) => safeString(entry.type) === 'total')
        ?.summary ??
      '';

    return {
      id: teamId,
      abbreviation: safeString(competitor.team?.abbreviation, ''),
      displayName: safeString(competitor.team?.displayName),
      shortDisplayName: safeString(competitor.team?.shortDisplayName, safeString(competitor.team?.displayName)),
      record: safeString(totalRecord),
      homeAway: competitor.homeAway ?? 'unknown',
      logo: safeString(competitor.team?.logo, ''),
      color: safeString(competitor.team?.color, ''),
      alternateColor: safeString(competitor.team?.alternateColor, ''),
      conference: resolveCompetitorConference(competitor),
      score: safeString(competitor.score),
      linescores: (competitor.linescores ?? []).map((line) =>
        safeString(line.displayValue, `${toNumber(line.value, 0)}`),
      ),
      totals: {
        fg: safeString(statsMap['fieldGoalsMade-fieldGoalsAttempted']),
        fgPct: safeString(statsMap['fieldGoalPct']),
        threePt: safeString(statsMap['threePointFieldGoalsMade-threePointFieldGoalsAttempted']),
        threePtPct: safeString(statsMap['threePointFieldGoalPct']),
        ft: safeString(statsMap['freeThrowsMade-freeThrowsAttempted']),
        ftPct: safeString(statsMap['freeThrowPct']),
        rebounds: safeString(statsMap['totalRebounds']),
        assists: safeString(statsMap['assists']),
        turnovers: safeString(statsMap['turnovers']),
        fouls: safeString(statsMap['fouls']),
        benchPoints: `${benchPoints}`,
        statsMap,
      },
      ratings: {
        seasonPower: null,
        gameNetRtg: null,
        last5MinNetRtg: null,
        liveRating: null,
      },
    };
  });

  const playersByTeam: Record<string, LiveGamePlayer[]> = {};
  const parsedCounts: Record<string, number> = {};
  teams.forEach((team) => {
    const section = boxPlayers.find((candidate) => safeString(candidate.team?.id, '') === team.id);
    const parsedPlayers = parsePlayersForTeam(section, team.id);
    const sorted = parsedPlayers.sort((a, b) => b.points - a.points || b.minutes - a.minutes);
    playersByTeam[team.id] = sorted;
    parsedCounts[team.shortDisplayName] = sorted.length;
  });

  const plays: LiveGamePlay[] = (summary.plays ?? []).map((play, index) => ({
    id: safeString(play.id, `play-${index}`),
    text: safeString(play.text),
    shortDescription: safeString(play.shortDescription),
    period: safeString(play.period?.displayValue, `P${toNumber(play.period?.number, 0)}`),
    clock: safeString(play.clock?.displayValue),
    awayScore: `${toNumber(play.awayScore, 0)}`,
    homeScore: `${toNumber(play.homeScore, 0)}`,
    scoringPlay: Boolean(play.scoringPlay),
    teamId: safeString(play.team?.id, '') || null,
  }));

  const keyEvents: LiveGameKeyEvent[] = plays.map((play) => ({
    id: play.id,
    period: play.period,
    clock: play.clock,
    eventType: classifyEventType(play.text),
    description: play.text,
    homeScore: play.homeScore,
    awayScore: play.awayScore,
  }));

  const substitutions: LiveGameSubstitution[] = (summary.plays ?? [])
    .map((play, index) => {
      const description = safeString(play.text, '');
      const parsed = parseSubstitutionDescription(description);
      if (!parsed) {
        return null;
      }
      return {
        id: safeString(play.id, `sub-${index}`),
        period: safeString(play.period?.displayValue, `P${toNumber(play.period?.number, 0)}`),
        clock: safeString(play.clock?.displayValue),
        teamId: safeString(play.team?.id, '') || null,
        description:
          parsed.outPlayer === '�' ? parsed.inPlayer : `${parsed.inPlayer} IN � ${parsed.outPlayer} OUT`,
      };
    })
    .filter((entry): entry is LiveGameSubstitution => Boolean(entry));

  const period = toNumber(comp?.status?.period, 0);
  const ratedTeams: LiveGameTeam[] = teams.map((team) => {
    const opponent = teams.find((candidate) => candidate.id !== team.id);
    const seasonStats: TeamSeasonStats = {
      pointsFor: statNumberFromMap(team.totals.statsMap, ['avgPoints']) ?? toNumber(team.score, 0),
      pointsAgainst: statNumberFromMap(team.totals.statsMap, ['avgPointsAgainst']) ?? toNumber(opponent?.score, 0),
      possessions: statNumberFromMap(team.totals.statsMap, ['possessions', 'avgPossessions', 'pace']),
      fga:
        statNumberFromMap(team.totals.statsMap, ['fieldGoalsAttempted', 'avgFieldGoalsAttempted']) ??
        parseAttemptedValue(team.totals.statsMap['fieldGoalsMade-fieldGoalsAttempted']),
      orb: statNumberFromMap(team.totals.statsMap, ['offensiveRebounds', 'avgOffensiveRebounds']),
      tov: statNumberFromMap(team.totals.statsMap, ['turnovers', 'avgTeamTurnovers', 'avgTotalTurnovers']),
      fta:
        statNumberFromMap(team.totals.statsMap, ['freeThrowsAttempted', 'avgFreeThrowsAttempted']) ??
        parseAttemptedValue(team.totals.statsMap['freeThrowsMade-freeThrowsAttempted']),
    };
    const seasonSignature = JSON.stringify({
      pf: seasonStats.pointsFor,
      pa: seasonStats.pointsAgainst,
      poss: seasonStats.possessions ?? null,
      fga: seasonStats.fga ?? null,
      orb: seasonStats.orb ?? null,
      tov: seasonStats.tov ?? null,
      fta: seasonStats.fta ?? null,
    });

    const cachedSeason = seasonPowerCache?.get(team.id);
    const seasonPower =
      cachedSeason && cachedSeason.signature === seasonSignature
        ? cachedSeason.value
        : computeSeasonPowerRating(seasonStats);
    if (seasonPowerCache && (!cachedSeason || cachedSeason.signature !== seasonSignature)) {
      seasonPowerCache.set(team.id, {
        signature: seasonSignature,
        value: seasonPower,
      });
    }

    const last5Window = estimateLast5Window(plays, team, opponent);
    const liveStats: LiveGameStats = {
      teamPoints: toNumber(team.score, 0),
      oppPoints: toNumber(opponent?.score, 0),
      teamPossessions: statNumberFromMap(team.totals.statsMap, ['possessions']),
      fga: parseAttemptedValue(team.totals.fg),
      orb: statNumberFromMap(team.totals.statsMap, ['offensiveRebounds']),
      tov: toNumber(team.totals.turnovers, 0),
      fta: parseAttemptedValue(team.totals.ft),
      last5TeamPoints: last5Window?.teamPoints ?? null,
      last5OppPoints: last5Window?.oppPoints ?? null,
      last5TeamPossessions: last5Window?.possessions ?? null,
    };
    const liveBreakdown = computeLiveRating(liveStats, seasonPower);

    return {
      ...team,
      ratings: {
        seasonPower,
        gameNetRtg: liveBreakdown.gameNetRtg,
        last5MinNetRtg: liveBreakdown.last5NetRtg,
        liveRating: liveBreakdown.liveRating,
      },
    };
  });

  const data: LiveGameData = {
    mode,
    eventId: gameId,
    summaryUrl,
    status: {
      state: safeString(comp?.status?.type?.state),
      description: safeString(comp?.status?.type?.description),
      detail: safeString(comp?.status?.type?.detail),
      shortDetail: safeString(comp?.status?.type?.shortDetail),
      period,
      displayClock: safeString(comp?.status?.displayClock),
      periodLabel: periodLabel(period),
    },
    meta: {
      competition: safeString(
        comp?.notes?.[0]?.headline,
        mode === 'nba'
          ? `${getProBasketballLeagueConfig(proLeague).label} Basketball`
          : 'NCAA Basketball',
      ),
      round: safeString(comp?.type?.shortDetail, 'Regular Season'),
      venue: safeString(comp?.venue?.fullName),
      attendance: `${toNumber(comp?.attendance, 0)}`,
      startDateTime: safeString(comp?.date, ''),
      officials: (comp?.officials ?? [])
        .map((official) => safeString(official.fullName, ''))
        .filter((official) => official.length > 0),
      broadcasters: (comp?.broadcasts ?? [])
        .flatMap((broadcast) => broadcast.names ?? [])
        .map((name) => safeString(name, ''))
        .filter((name) => name.length > 0),
    },
    possessionTeamId: inferPossessionTeamId(summary.plays, ratedTeams),
    teams: ratedTeams,
    playersByTeam,
    plays,
    keyEvents,
    substitutions,
    winProbability: buildWinProbability(ratedTeams, summary.plays, period),
    scoreMargin: buildScoreMargin(summary.plays, period, mode),
    seasonRankings: ratedTeams
      .filter((team) => team.ratings.seasonPower !== null)
      .map((team) => ({ teamId: team.id, value: team.ratings.seasonPower as number }))
      .sort((a, b) => b.value - a.value),
    liveRankings: ratedTeams
      .filter((team) => team.ratings.liveRating !== null)
      .map((team) => ({ teamId: team.id, value: team.ratings.liveRating as number }))
      .sort((a, b) => b.value - a.value),
  };

  return { data, parsedCounts };
}

function isCollegeBaseballLivePayloadResult(
  value: unknown,
): value is CollegeBaseballLivePayloadResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const status = (value as { status?: unknown }).status;
  return status === 'ok' || status === 'empty' || status === 'error';
}

type BuildLiveGameDataFromPayloadOptions = {
  apiBase: string;
  gameId: string;
  mode: GameMode;
  proLeague?: ProBasketballLeague;
  payload: unknown;
  previousData?: LiveGameData | null;
  prevMinutesByPlayerId?: Map<string, number>;
  rosterCache?: Map<string, LiveGamePlayer[]>;
  logoCache?: Map<string, string>;
  seasonInputCache?: Map<string, SeasonPlayerRatingInput>;
  seasonPowerCache?: Map<string, SeasonPowerCacheEntry>;
  pregameTeamSeasonStatsCache?: Map<string, PregameTeamSeasonStatsEntry | null>;
};

export type BuildLiveGameDataFromPayloadResult =
  | {
      status: 'ok';
      data: LiveGameData;
      parsedCounts: Record<string, number>;
      onCourtDebug: OnCourtDebugInfo | null;
    }
  | {
      status: 'empty' | 'error';
      message: string;
      code: number | null;
      isOffline: boolean;
    };

const EMPTY_TEAM_TOTALS: LiveGameTeamTotals = {
  fg: '-',
  fgPct: '-',
  threePt: '-',
  threePtPct: '-',
  ft: '-',
  ftPct: '-',
  rebounds: '-',
  assists: '-',
  turnovers: '-',
  fouls: '-',
  benchPoints: '-',
  statsMap: {},
};

function buildSeedTeam(
  team: LiveGameListItem['home'] | LiveGameListItem['away'],
  homeAway: 'home' | 'away',
  conference: LiveGameListItem['conference'],
  sport: LiveGameListItem['sport'],
): LiveGameTeam {
  return {
    id: team.id ?? `${homeAway}-seed`,
    abbreviation: team.abbreviation ?? team.shortDisplayName ?? team.name,
    displayName: team.name,
    shortDisplayName: team.shortDisplayName ?? team.name,
    record: team.record ?? '',
    homeAway,
    logo: team.logo ?? '',
    color: '',
    alternateColor: '',
    conference: team.conference ?? conference ?? null,
    score: team.score ?? '',
    linescores: [],
    totals: EMPTY_TEAM_TOTALS,
    ratings: {
      seasonPower: null,
      gameNetRtg: null,
      last5MinNetRtg: null,
      liveRating: null,
    },
    sport,
  };
}

/**
 * Builds a minimal, honest-about-what-it-doesn't-know LiveGameData from the
 * schedule list's already-known LiveGameListItem, so the game screen's shell
 * (StickyScoreHeader, tab bar) can paint real team names/logos/records/score
 * the instant it mounts — before the first network round trip even starts.
 *
 * Deliberately NOT stored in dataRef/signatureRef — see the call site in the
 * gameId/mode reset effect below. It exists ONLY as a transient value for
 * `data` (the React state) to render from; refresh()'s own cold-open
 * detection (`!dataRef.current`) and the ratings-enrichment phase's
 * `previousData` are untouched by it, so this can't change any of the
 * already-verified fetch/build behavior — it only affects what's on screen
 * for the brief moment before that pipeline's own first result lands.
 * Everything this seed can't know (plays, players, win probability, etc.)
 * is left as an empty array/null rather than guessed.
 */
function buildSeedLiveGameData(item: LiveGameListItem, mode: GameMode): LiveGameData {
  return {
    mode,
    sport: item.sport,
    eventId: item.gameId,
    summaryUrl: '',
    status: {
      state: item.isLive ? 'in' : 'pre',
      description: item.statusText,
      detail: item.statusDetail ?? item.statusText,
      shortDetail: item.statusText,
      period: item.period,
      displayClock: item.clock,
      periodLabel: '',
      baseball: item.baseballState ?? null,
    },
    meta: {
      competition: '',
      round: '',
      venue: item.venue ?? '',
      attendance: '',
      startDateTime: '',
      officials: [],
      broadcasters: [],
    },
    possessionTeamId: null,
    teams: [
      buildSeedTeam(item.away, 'away', item.conference, item.sport),
      buildSeedTeam(item.home, 'home', item.conference, item.sport),
    ],
    playersByTeam: {},
    plays: [],
    keyEvents: [],
    substitutions: [],
    winProbability: [],
    scoreMargin: [],
    seasonRankings: [],
    liveRankings: [],
    baseballOnField: null,
  };
}

// "Shell" result: everything EXCEPT the per-player season-rating fetch and
// the full-game impact/momentum replay (see enrichLiveGameShellWithPlayerRanks
// below) — i.e. parse + roster/logo fallback only. No per-player network
// calls happen here, so this resolves in roughly one round trip regardless of
// roster size, which is what lets refresh() paint the shell (score, team
// names, tab bar) immediately instead of waiting on the much slower
// ratings phase. `isFinal` is true for baseball, which has no separate
// ratings phase — the shell already IS the complete result for that sport.
type BuildLiveGameShellResult =
  | {
      status: 'ok';
      data: LiveGameData;
      parsedCounts: Record<string, number>;
      isFinal: boolean;
    }
  | {
      status: 'empty' | 'error';
      message: string;
      code: number | null;
      isOffline: boolean;
    };

async function buildLiveGameShellFromPayload({
  apiBase,
  gameId,
  mode,
  proLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
  payload,
  rosterCache = new Map<string, LiveGamePlayer[]>(),
  logoCache = new Map<string, string>(),
  seasonPowerCache = new Map<string, SeasonPowerCacheEntry>(),
  pregameTeamSeasonStatsCache = new Map<string, PregameTeamSeasonStatsEntry | null>(),
}: Pick<
  BuildLiveGameDataFromPayloadOptions,
  | 'apiBase'
  | 'gameId'
  | 'mode'
  | 'proLeague'
  | 'payload'
  | 'rosterCache'
  | 'logoCache'
  | 'seasonPowerCache'
  | 'pregameTeamSeasonStatsCache'
>): Promise<BuildLiveGameShellResult> {
  let summary: SummaryResponse;

  if (mode === 'baseball' && isCollegeBaseballLivePayloadResult(payload)) {
    if (payload.status === 'empty') {
      return {
        status: 'empty',
        message: COLLEGE_BASEBALL_EMPTY_MESSAGE,
        code: 404,
        isOffline: false,
      };
    }

    if (payload.status === 'error') {
      return {
        status: 'error',
        message:
          payload.error ??
          (payload.code === 'network_error'
            ? 'College Baseball network error (summary)'
            : `College Baseball HTTP ${payload.code} (summary)`),
        code: typeof payload.code === 'number' ? payload.code : null,
        isOffline: payload.code === 'network_error',
      };
    }

    summary = payload.data as SummaryResponse;
  } else {
    summary = payload as SummaryResponse;
  }

  if (mode === 'nba') {
    summary = await applyPregameNbaSeasonStatsFallback(
      summary,
      proLeague,
      pregameTeamSeasonStatsCache,
    );
  }

  const summaryUrl = `${apiBase}/${mode}/game/${gameId}/live`;
  const parsed = parseData(
    summary,
    mode,
    gameId,
    summaryUrl,
    seasonPowerCache,
    proLeague,
  );
  const [withRosterFallback, logoResult] = await Promise.all([
    applyRosterFallback(parsed.data, parsed.parsedCounts, rosterCache, proLeague),
    applyTeamLogoFallback(parsed.data, logoCache, proLeague),
  ]);
  const withLogos: LiveGameData = {
    ...parsed.data,
    teams: logoResult.teams,
    playersByTeam: withRosterFallback.data.playersByTeam,
    baseballOnField: withRosterFallback.data.baseballOnField,
  };

  return {
    status: 'ok',
    data: withLogos,
    parsedCounts: withRosterFallback.parsedCounts,
    // Baseball has no ratings-enrichment phase — this IS the final result.
    isFinal: mode === 'baseball',
  };
}

// The slow part: one HTTP call per player missing from seasonInputCache
// (typically the whole roster on a cold, never-before-seen game), then a
// synchronous full-game replay of every substitution/play to compute impact
// ratings, momentum, and on-court status. Deliberately kept separate from
// buildLiveGameShellFromPayload above so refresh() can paint the shell while
// this runs in the background.
async function enrichLiveGameShellWithPlayerRanks(
  withLogos: LiveGameData,
  {
    mode,
    proLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
    previousData = null,
    prevMinutesByPlayerId = new Map<string, number>(),
    seasonInputCache = new Map<string, SeasonPlayerRatingInput>(),
  }: Pick<
    BuildLiveGameDataFromPayloadOptions,
    'mode' | 'proLeague' | 'previousData' | 'prevMinutesByPlayerId' | 'seasonInputCache'
  >,
): Promise<{ data: LiveGameData; onCourtDebug: OnCourtDebugInfo }> {
  const athleteIds = Object.values(withLogos.playersByTeam)
    .flat()
    .map((player) => player.id)
    .filter((id) => id && id !== 'ï¿½');

  const missingIds = athleteIds.filter((athleteId) => !seasonInputCache.has(athleteId));
  if (missingIds.length > 0) {
    const seasonEntries = await Promise.all(
      missingIds.map(async (athleteId) => {
        const input = await fetchSeasonPlayerRatingInput(mode, proLeague, athleteId);
        return { athleteId, input };
      }),
    );

    seasonEntries.forEach(({ athleteId, input }) => {
      if (input) {
        seasonInputCache.set(athleteId, input);
      }
    });
  }

  const seasonRatingsByAthlete =
    seasonInputCache.size > 0
      ? new Map(
          computeSeasonRatings([...seasonInputCache.values()]).map((row) => [
            row.playerId,
            row,
          ]),
        )
      : new Map<string, SeasonPlayerRatingOutput>();

  return withPlayerRanks(withLogos, seasonRatingsByAthlete, prevMinutesByPlayerId, previousData);
}

// Combined shell + ratings build, preserved as its OWN export with its
// original one-call behavior/signature for callers that just want the fully
// built result (e.g. app/live-games.tsx's prefetch). refresh() in
// LiveGameProvider below calls the two phases separately instead, so it can
// render the shell before the ratings phase finishes.
export async function buildLiveGameDataFromPayload(
  options: BuildLiveGameDataFromPayloadOptions,
): Promise<BuildLiveGameDataFromPayloadResult> {
  const shell = await buildLiveGameShellFromPayload(options);
  if (shell.status !== 'ok') {
    return shell;
  }
  if (shell.isFinal) {
    return {
      status: 'ok',
      data: shell.data,
      parsedCounts: shell.parsedCounts,
      onCourtDebug: null,
    };
  }

  const ranked = await enrichLiveGameShellWithPlayerRanks(shell.data, options);
  return {
    status: 'ok',
    data: ranked.data,
    parsedCounts: shell.parsedCounts,
    onCourtDebug: ranked.onCourtDebug,
  };
}

function parseRosterPlayers(teamId: string, roster: TeamRosterResponse): LiveGamePlayer[] {
  return (roster.athletes ?? [])
    .map((athlete, index) => {
      const name = safeString(athlete.displayName, safeString(athlete.shortName, `Player ${index + 1}`));
      const shortName = safeString(athlete.shortName, name);

      return {
        id: safeString(athlete.id, `${teamId}-roster-${index}`),
        teamId,
        name,
        shortName,
        lastName: lastNameFromDisplay(name, shortName),
        jersey: sanitizeJersey(athlete.jersey),
        position: safeString(athlete.position?.abbreviation),
        ...resolveHeightMetadata({
          displayHeight: athlete.displayHeight,
          height: athlete.height,
        }),
        headshot: sanitizeHeadshotUri(athlete.headshot?.href),
        starter: false,
        active: true,
        didNotPlay: false,
        minutes: 0,
        minutesDisplay: '0',
        points: 0,
        rebounds: 0,
        assists: 0,
        turnovers: 0,
        steals: 0,
        blocks: 0,
        fouls: 0,
        offensiveRebounds: 0,
        defensiveRebounds: 0,
        fg: '0-0',
        threePt: '0-0',
        ft: '0-0',
        plusMinus: '�',
        plusMinusValue: 0,
        liveEffPerMin: 0,
        seasonEffPerMin: null,
        seasonImpactRaw: null,
        inGameImpactRaw: null,
        liveRawBase: null,
        liveRaw: null,
        liveDisplay: '-' as const,
        seasonRating10: null,
        inGameRating10: null,
        lowSample: false,
        gameRating: null,
        seasonRating: null,
        gameRank: null,
        seasonRank: null,
        minutesIncreasing: false,
        onCourt: false,
        minuteDelta: 0,
        fgm: 0,
        fga: 0,
        ftm: 0,
        fta: 0,
      };
    })
    .sort((a, b) => a.lastName.localeCompare(b.lastName));
}

function mergePlayerHeightMetadata(players: LiveGamePlayer[], rosterPlayers: LiveGamePlayer[]): LiveGamePlayer[] {
  if (players.length === 0 || rosterPlayers.length === 0) {
    return players;
  }
  const rosterHeightById = new Map(
    rosterPlayers.map((player) => [
      player.id,
      {
        heightInches: player.heightInches ?? null,
        heightDisplay: player.heightDisplay ?? '�',
      },
    ]),
  );
  return players.map((player) => {
    const rosterHeight = rosterHeightById.get(player.id);
    if (!rosterHeight) {
      return player;
    }
    const nextHeightInches = player.heightInches ?? rosterHeight.heightInches;
    const nextHeightDisplay =
      (typeof player.heightDisplay === 'string' && player.heightDisplay.trim().length > 0
        ? player.heightDisplay
        : rosterHeight.heightDisplay) || '�';
    if (player.heightInches === nextHeightInches && player.heightDisplay === nextHeightDisplay) {
      return player;
    }
    return {
      ...player,
      heightInches: nextHeightInches,
      heightDisplay: nextHeightDisplay,
    };
  });
}

function mergePlayerRosterMetadata(players: LiveGamePlayer[], rosterPlayers: LiveGamePlayer[]): LiveGamePlayer[] {
  if (players.length === 0 || rosterPlayers.length === 0) {
    return players;
  }

  const rosterById = new Map(
    rosterPlayers.map((player) => [
      player.id,
      {
        heightInches: player.heightInches ?? null,
        heightDisplay: player.heightDisplay ?? '-',
        jersey: sanitizeJersey(player.jersey),
        headshot: sanitizeHeadshotUri(player.headshot),
      },
    ]),
  );

  return players.map((player) => {
    const rosterMetadata = rosterById.get(player.id);
    if (!rosterMetadata) {
      return player;
    }

    const nextHeightInches = player.heightInches ?? rosterMetadata.heightInches;
    const nextHeightDisplay =
      (typeof player.heightDisplay === 'string' && player.heightDisplay.trim().length > 0
        ? player.heightDisplay
        : rosterMetadata.heightDisplay) || '-';
    const nextJersey =
      sanitizeJersey(player.jersey, '') || sanitizeJersey(rosterMetadata.jersey);
    const nextHeadshot =
      sanitizeHeadshotUri(player.headshot) || sanitizeHeadshotUri(rosterMetadata.headshot);

    if (
      player.heightInches === nextHeightInches &&
      player.heightDisplay === nextHeightDisplay &&
      player.jersey === nextJersey &&
      player.headshot === nextHeadshot
    ) {
      return player;
    }

    return {
      ...player,
      heightInches: nextHeightInches,
      heightDisplay: nextHeightDisplay,
      jersey: nextJersey,
      headshot: nextHeadshot,
    };
  });
}

function enrichBaseballOnFieldPlayers(
  baseballOnField: BaseballOnFieldState<LiveGamePlayer> | null | undefined,
  playersByTeam: Record<string, LiveGamePlayer[]>,
): BaseballOnFieldState<LiveGamePlayer> | null | undefined {
  if (!baseballOnField) {
    return baseballOnField;
  }

  const byId = new Map<string, LiveGamePlayer>();
  const byTeamJersey = new Map<string, LiveGamePlayer>();
  const byTeamName = new Map<string, LiveGamePlayer>();

  Object.values(playersByTeam)
    .flat()
    .forEach((player) => {
      if (player.id) {
        byId.set(player.id, player);
      }

      const jersey = sanitizeJersey(player.jersey, '');
      if (player.teamId && jersey) {
        byTeamJersey.set(`${player.teamId}:${jersey}`, player);
      }

      const nameKey = normalizeLookupText(player.name || player.shortName || player.lastName);
      if (player.teamId && nameKey) {
        byTeamName.set(`${player.teamId}:${nameKey}`, player);
      }

      const lastNameKey = normalizeLookupText(player.lastName);
      if (player.teamId && lastNameKey) {
        byTeamName.set(`${player.teamId}:${lastNameKey}`, player);
      }
    });

  const resolve = (player: LiveGamePlayer | null): LiveGamePlayer | null => {
    if (!player) {
      return null;
    }

    const direct = byId.get(player.id);
    const jersey = sanitizeJersey(player.jersey, '');
    const byJersey = player.teamId && jersey ? byTeamJersey.get(`${player.teamId}:${jersey}`) : null;
    const nameKey = normalizeLookupText(player.name || player.shortName || player.lastName);
    const byName = player.teamId && nameKey ? byTeamName.get(`${player.teamId}:${nameKey}`) : null;
    const matched = direct ?? byJersey ?? byName ?? null;

    return {
      ...player,
      jersey: sanitizeJersey(player.jersey || matched?.jersey),
      headshot: sanitizeHeadshotUri(player.headshot || matched?.headshot),
      shortName: player.shortName || matched?.shortName || player.name,
      lastName: player.lastName || matched?.lastName || player.name,
      position: player.position || matched?.position || 'UN',
    };
  };

  return {
    ...baseballOnField,
    defense: {
      P: resolve(baseballOnField.defense.P),
      C: resolve(baseballOnField.defense.C),
      "1B": resolve(baseballOnField.defense["1B"]),
      "2B": resolve(baseballOnField.defense["2B"]),
      "3B": resolve(baseballOnField.defense["3B"]),
      SS: resolve(baseballOnField.defense.SS),
      LF: resolve(baseballOnField.defense.LF),
      CF: resolve(baseballOnField.defense.CF),
      RF: resolve(baseballOnField.defense.RF),
    },
    batter: resolve(baseballOnField.batter),
    runners: {
      first: resolve(baseballOnField.runners.first),
      second: resolve(baseballOnField.runners.second),
      third: resolve(baseballOnField.runners.third),
    },
  };
}

async function fetchRosterPlayers(
  mode: GameMode,
  proLeague: ProBasketballLeague,
  teamId: string,
): Promise<LiveGamePlayer[]> {
  const url = getTeamRosterUrl(mode, proLeague, teamId);
  try {
    console.log(`[live hook] request -> ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }

    const roster = (await response.json()) as TeamRosterResponse;
    return parseRosterPlayers(teamId, roster);
  } catch (error) {
    const err = error as Error;
    console.log(`[live hook] request failed -> ${url}`);
    console.log(`[live hook] error: ${err.message}`);
    if (err.stack) {
      console.log(err.stack);
    }
    return [];
  }
}

async function applyRosterFallback(
  data: LiveGameData,
  parsedCounts: Record<string, number>,
  rosterByTeam: Map<string, LiveGamePlayer[]>,
  proLeague: ProBasketballLeague,
): Promise<{ data: LiveGameData; parsedCounts: Record<string, number> }> {
  const nextPlayersByTeam: Record<string, LiveGamePlayer[]> = { ...data.playersByTeam };
  const nextCounts: Record<string, number> = { ...parsedCounts };

  await Promise.all(
    data.teams.map(async (team) => {
      const existing = nextPlayersByTeam[team.id] ?? [];
      let rosterPlayers = rosterByTeam.get(team.id) ?? [];
      if (rosterPlayers.length === 0) {
        rosterPlayers = await fetchRosterPlayers(data.mode, proLeague, team.id);
        if (rosterPlayers.length > 0) {
          rosterByTeam.set(team.id, rosterPlayers);
        }
      }

      if (rosterPlayers.length === 0) {
        return;
      }

      if (existing.length > 0) {
        nextPlayersByTeam[team.id] = mergePlayerRosterMetadata(existing, rosterPlayers);
        return;
      }

      nextPlayersByTeam[team.id] = rosterPlayers;
      nextCounts[team.shortDisplayName] = rosterPlayers.length;
    }),
  );

  return {
    data: {
      ...data,
      playersByTeam: nextPlayersByTeam,
      baseballOnField: enrichBaseballOnFieldPlayers(data.baseballOnField, nextPlayersByTeam),
    },
    parsedCounts: nextCounts,
  };
}

function hasValidLogo(logo: string): boolean {
  return logo.trim().length > 0 && logo !== '�';
}

function pickTeamLogo(info: TeamInfoResponse): string {
  const logos = info.team?.logos ?? [];
  if (logos.length === 0) {
    return '';
  }

  const preferred =
    logos.find((logo) => (logo.rel ?? []).includes('default')) ??
    logos.find((logo) => (logo.rel ?? []).includes('full')) ??
    logos[0];

  return safeString(preferred?.href, '');
}

async function fetchTeamLogo(
  mode: GameMode,
  proLeague: ProBasketballLeague,
  teamId: string,
): Promise<string> {
  const url = getTeamInfoUrl(mode, proLeague, teamId);
  try {
    console.log(`[live hook] request -> ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      return '';
    }

    const info = (await response.json()) as TeamInfoResponse;
    return pickTeamLogo(info);
  } catch (error) {
    const err = error as Error;
    console.log(`[live hook] request failed -> ${url}`);
    console.log(`[live hook] error: ${err.message}`);
    if (err.stack) {
      console.log(err.stack);
    }
    return '';
  }
}

async function applyTeamLogoFallback(
  data: LiveGameData,
  logoByTeam: Map<string, string>,
  proLeague: ProBasketballLeague,
): Promise<LiveGameData> {
  const nextTeams = await Promise.all(
    data.teams.map(async (team) => {
      if (hasValidLogo(team.logo)) {
        return team;
      }

      let logo = logoByTeam.get(team.id) ?? '';
      if (!hasValidLogo(logo)) {
        logo = await fetchTeamLogo(data.mode, proLeague, team.id);
        if (hasValidLogo(logo)) {
          logoByTeam.set(team.id, logo);
        }
      }

      return {
        ...team,
        logo: hasValidLogo(logo) ? logo : team.logo,
      };
    }),
  );

  return {
    ...data,
    teams: nextTeams,
  };
}

function buildImportantSignature(data: LiveGameData): string {
  const away = data.teams.find((team) => team.homeAway === 'away') ?? data.teams[0];
  const home = data.teams.find((team) => team.homeAway === 'home') ?? data.teams[1];

  const teamScores = `${away?.id ?? 'away'}:${away?.score ?? '�'}|${home?.id ?? 'home'}:${home?.score ?? '�'}`;
  const status = `${data.status.period}|${data.status.displayClock}`;
  const teamLogos = data.teams
    .map((team) => `${team.id}:${team.logo}`)
    .sort((a, b) => a.localeCompare(b))
    .join('|');

  const playerStats = Object.entries(data.playersByTeam)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([teamId, players]) => {
      const rows = [...players]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(
          (player) =>
            `${player.id}:${player.points}:${player.liveDisplay}:${player.rebounds}:${player.assists}:${player.fouls}`,
        )
        .join(',');
      return `${teamId}[${rows}]`;
    })
    .join('|');

  const teamRatings = data.teams
    .map(
      (team) =>
        `${team.id}:${team.ratings.seasonPower ?? 'n'}:${team.ratings.liveRating ?? 'n'}:${team.ratings.last5MinNetRtg ?? 'n'}`,
    )
    .sort((a, b) => a.localeCompare(b))
    .join('|');
  const playSignature =
    data.plays.length > 0
      ? `${data.plays.length}:${data.plays.map((play) => play.id).join(',')}`
      : 'none';
  const baseballState =
    data.sport === 'baseball'
      ? `${data.status.baseball?.label ?? 'none'}:${data.status.baseball?.outs ?? 'n'}:${data.status.baseball?.balls ?? 'n'}:${data.status.baseball?.strikes ?? 'n'}:${Number(Boolean(data.status.baseball?.bases.first))}${Number(Boolean(data.status.baseball?.bases.second))}${Number(Boolean(data.status.baseball?.bases.third))}`
      : '';

  return `${teamScores}|${status}|${teamLogos}|${playerStats}|${teamRatings}|${playSignature}|${baseballState}`;
}

function toAthleteStatMap(response: AthleteStatsResponse, categoryName: string): Record<string, string> {
  const category = (response.categories ?? []).find((row) => row.name === categoryName);
  if (!category) {
    return {};
  }
  const names = category.names ?? [];
  const totals = category.totals ?? [];
  return names.reduce<Record<string, string>>((map, name, index) => {
    map[name] = safeString(totals[index], '0');
    return map;
  }, {});
}

function statAverageFromMaps(
  averages: Record<string, string>,
  totals: Record<string, string>,
  keys: string[],
  gamesPlayed: number,
): number {
  for (const key of keys) {
    if (averages[key] !== undefined) {
      return toNumber(averages[key], 0);
    }
    if (totals[key] !== undefined) {
      const total = toNumber(totals[key], 0);
      return gamesPlayed > 0 ? total / gamesPlayed : total;
    }
  }
  return 0;
}

async function fetchSeasonPlayerRatingInput(
  mode: GameMode,
  proLeague: ProBasketballLeague,
  athleteId: string,
): Promise<SeasonPlayerRatingInput | null> {
  if (mode === 'baseball') {
    return null;
  }
  const url = getAthleteStatsUrl(mode, proLeague, athleteId);
  try {
    console.log(`[live hook] request -> ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as AthleteStatsResponse;
    const averages = toAthleteStatMap(json, 'averages');
    const totals = toAthleteStatMap(json, 'totals');
    const gamesPlayed = toNumber(averages.gamesPlayed, 0);
    const minutesPerGame = toNumber(averages.avgMinutes, 0);
    const seasonMIN = minutesPerGame * gamesPlayed;

    // ESPN categories vary by athlete feed; use totals when present, else estimate from averages*games.
    const ptsAvg = statAverageFromMaps(averages, totals, ['avgPoints', 'points'], gamesPlayed);
    const rebAvg = statAverageFromMaps(averages, totals, ['avgRebounds', 'rebounds'], gamesPlayed);
    const astAvg = statAverageFromMaps(averages, totals, ['avgAssists', 'assists'], gamesPlayed);
    const stlAvg = statAverageFromMaps(averages, totals, ['avgSteals', 'steals'], gamesPlayed);
    const blkAvg = statAverageFromMaps(averages, totals, ['avgBlocks', 'blocks'], gamesPlayed);
    const tovAvg = statAverageFromMaps(averages, totals, ['avgTurnovers', 'turnovers'], gamesPlayed);
    const pfAvg = statAverageFromMaps(averages, totals, ['avgFouls', 'fouls'], gamesPlayed);
    const fgmAvg = statAverageFromMaps(averages, totals, ['avgFieldGoalsMade', 'fieldGoalsMade'], gamesPlayed);
    const fgaAvg = statAverageFromMaps(averages, totals, ['avgFieldGoalsAttempted', 'fieldGoalsAttempted'], gamesPlayed);
    const ftmAvg = statAverageFromMaps(averages, totals, ['avgFreeThrowsMade', 'freeThrowsMade'], gamesPlayed);
    const ftaAvg = statAverageFromMaps(averages, totals, ['avgFreeThrowsAttempted', 'freeThrowsAttempted'], gamesPlayed);

    return {
      playerId: athleteId,
      seasonMIN,
      box: {
        PTS: ptsAvg * Math.max(gamesPlayed, 1),
        FGM: fgmAvg * Math.max(gamesPlayed, 1),
        FGA: fgaAvg * Math.max(gamesPlayed, 1),
        FTM: ftmAvg * Math.max(gamesPlayed, 1),
        FTA: ftaAvg * Math.max(gamesPlayed, 1),
        REB: rebAvg * Math.max(gamesPlayed, 1),
        AST: astAvg * Math.max(gamesPlayed, 1),
        STL: stlAvg * Math.max(gamesPlayed, 1),
        BLK: blkAvg * Math.max(gamesPlayed, 1),
        TOV: tovAvg * Math.max(gamesPlayed, 1),
        PF: pfAvg * Math.max(gamesPlayed, 1),
        MIN: seasonMIN,
      },
    };
  } catch (error) {
    const err = error as Error;
    console.log(`[live hook] request failed -> ${url}`);
    console.log(`[live hook] error: ${err.message}`);
    if (err.stack) {
      console.log(err.stack);
    }
    return null;
  }
}

export async function getHydratedHistoricalLiveGameData(
  mode: GameMode,
  gameId: string,
  proLeague: ProBasketballLeague = DEFAULT_PRO_BASKETBALL_LEAGUE,
): Promise<LiveGameData | null> {
  const cached = await getCachedLiveGame<LiveGameData>(gameId, mode);
  if (cached?.data) {
    return cached.data.mode ? cached.data : { ...cached.data, mode };
  }

  try {
    // getApiBaseUrl() is the single source of truth for the API base URL
    // (it already handles the local/tunnel EXPO_PUBLIC_API_MODE toggle plus
    // emulator/simulator fallbacks) — a hardcoded LAN-IP fallback here used
    // to silently override that in tunnel mode whenever getApiBaseUrl()
    // returned a falsy value, which is exactly what let this specific
    // call diverge from the rest of the app instead of respecting the
    // tunnel/local switch.
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      throw new Error(API_SETUP_MESSAGE);
    }
    const payload = await fetchLiveGamePayload(mode, gameId, proLeague);
    const built = await buildLiveGameDataFromPayload({
      apiBase,
      gameId,
      mode,
      proLeague,
      payload,
      pregameTeamSeasonStatsCache: new Map<string, PregameTeamSeasonStatsEntry | null>(),
    });
    if (built.status !== 'ok') {
      return null;
    }

    await setCachedLiveGame(gameId, built.data, mode);
    return built.data;
  } catch {
    return null;
  }
}

function sortForGameRank(a: LiveGamePlayer, b: LiveGamePlayer): number {
  // Guardrail: ranking must always be impact-first. Tie-breakers are only consulted
  // when in-game raw impact is equal.
  const aImpactRaw = Number.isFinite(a.inGameImpactRaw) ? (a.inGameImpactRaw as number) : Number.NEGATIVE_INFINITY;
  const bImpactRaw = Number.isFinite(b.inGameImpactRaw) ? (b.inGameImpactRaw as number) : Number.NEGATIVE_INFINITY;
  const impactDiff = bImpactRaw - aImpactRaw;
  if (impactDiff !== 0) {
    return impactDiff;
  }

  const minutesDiff = b.minutes - a.minutes;
  if (minutesDiff !== 0) {
    return minutesDiff;
  }

  const pointsDiff = b.points - a.points;
  if (pointsDiff !== 0) {
    return pointsDiff;
  }

  const assistsDiff = b.assists - a.assists;
  if (assistsDiff !== 0) {
    return assistsDiff;
  }

  const reboundsDiff = b.rebounds - a.rebounds;
  if (reboundsDiff !== 0) {
    return reboundsDiff;
  }

  return a.lastName.localeCompare(b.lastName);
}

function sortForInGameList(a: LiveGamePlayer, b: LiveGamePlayer): number {
  const aGameRank = a.gameRank ?? Number.MAX_SAFE_INTEGER;
  const bGameRank = b.gameRank ?? Number.MAX_SAFE_INTEGER;
  if (aGameRank !== bGameRank) {
    return aGameRank - bGameRank;
  }

  const aImpactRaw = Number.isFinite(a.inGameImpactRaw) ? (a.inGameImpactRaw as number) : Number.NEGATIVE_INFINITY;
  const bImpactRaw = Number.isFinite(b.inGameImpactRaw) ? (b.inGameImpactRaw as number) : Number.NEGATIVE_INFINITY;
  const impactDiff = bImpactRaw - aImpactRaw;
  if (impactDiff !== 0) {
    return impactDiff;
  }

  const minutesDiff = b.minutes - a.minutes;
  if (minutesDiff !== 0) {
    return minutesDiff;
  }

  return a.lastName.localeCompare(b.lastName);
}

function getTeammatePointsFromEventBoxes(params: {
  teamId: string | null;
  playerId: string;
  teamPlayerIdsByTeamId: Map<string, string[]>;
  eventBoxesByPlayerId: Map<string, PlayerBox>;
}): number[] {
  if (!params.teamId) {
    return [];
  }
  const teamPlayerIds = params.teamPlayerIdsByTeamId.get(params.teamId) ?? [];
  return teamPlayerIds
    .filter((candidateId) => candidateId !== params.playerId)
    .map((candidateId) => Math.max(0, params.eventBoxesByPlayerId.get(candidateId)?.points ?? 0));
}

// Rolling box-score stats over the SAME trailing window Momentum itself uses,
// computed from the identical event stream (momentumEventsByPlayerId) so the
// two are always in sync. Independent of the cumulative snapshot box — this
// is "what happened recently", not "what happened all game". Covers every
// category the leaderboard's "top 3 stats" line might want to surface (see
// buildRecentStatEntries in components/ui/TopPlayerRow.tsx) — not just
// reb/ast, so a player whose recent activity was steals/blocks/turnovers
// isn't flattened into "0 reb · 0 ast".
function computeRecentStatsFromMomentumEvents(
  events: MomentumInputEvent[],
  nowTSec: number,
  windowSec: number,
): {
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  windowSec: number;
} {
  const start = nowTSec - windowSec;
  let points = 0;
  let rebounds = 0;
  let assists = 0;
  let steals = 0;
  let blocks = 0;
  let turnovers = 0;
  for (const event of events) {
    if (event.tSec <= start || event.tSec > nowTSec) {
      continue;
    }
    switch (event.canonicalType) {
      case 'MADE_SHOT':
        points += event.shotPoints === 3 ? 3 : 2;
        break;
      case 'MADE_FT':
        points += 1;
        break;
      case 'REB_OFF':
      case 'REB_DEF':
        rebounds += 1;
        break;
      case 'ASSIST':
        assists += 1;
        break;
      case 'STEAL':
        steals += 1;
        break;
      case 'BLOCK':
        blocks += 1;
        break;
      case 'TURNOVER':
        turnovers += 1;
        break;
      default:
        break;
    }
  }
  return { points, rebounds, assists, steals, blocks, turnovers, windowSec };
}

let rankComparatorAsserted = false;
function assertGameRankComparator(): void {
  if (rankComparatorAsserted || !__DEV__) {
    return;
  }
  rankComparatorAsserted = true;
  const mk = (
    id: string,
    inGameImpactRaw: number,
    minutes: number,
    points: number,
    assists: number,
    rebounds: number,
  ): LiveGamePlayer =>
    ({
      id,
      teamId: "t",
      name: id,
      shortName: id,
      lastName: id,
      jersey: "0",
      position: "G",
      headshot: "",
      starter: false,
      active: true,
      didNotPlay: false,
      minutes,
      minutesDisplay: String(minutes),
      points,
      rebounds,
      assists,
      turnovers: 0,
      steals: 0,
      blocks: 0,
      fouls: 0,
      offensiveRebounds: 0,
      defensiveRebounds: rebounds,
      fg: "0-0",
      threePt: "0-0",
      ft: "0-0",
      plusMinus: "0",
      plusMinusValue: 0,
      liveEffPerMin: 0,
      seasonEffPerMin: null,
      seasonImpactRaw: null,
      inGameImpactRaw,
      liveRawBase: inGameImpactRaw,
      liveRaw: inGameImpactRaw,
      liveDisplay: 5,
      seasonRating10: null,
      inGameRating10: 5,
      lowSample: false,
      gameRating: 5,
      seasonRating: null,
      gameRank: null,
      seasonRank: null,
      minutesIncreasing: false,
      onCourt: true,
      minuteDelta: 0,
      fgm: 0,
      fga: 0,
      ftm: 0,
      fta: 0,
    }) as LiveGamePlayer;

  const highImpactLowMinutes = mk("highImpactLowMinutes", 12, 8, 1, 1, 1);
  const lowImpactHighMinutes = mk("lowImpactHighMinutes", 6, 30, 30, 10, 10);
  if (!(sortForGameRank(highImpactLowMinutes, lowImpactHighMinutes) < 0)) {
    console.warn("[ranking] Guardrail failed: tie-breakers should not outrank higher raw impact.");
  }

  const meaningfulLowerSeason = {
    ...mk("meaningfulLowerSeason", 8, 15, 8, 2, 3),
    gameRank: 1,
    seasonRank: 40,
    seasonRating: 3.5,
  } as LiveGamePlayer;
  const nonMeaningfulHigherSeason = {
    ...mk("nonMeaningfulHigherSeason", 9, 1, 5, 1, 2),
    gameRank: null,
    seasonRank: 1,
    seasonRating: 9.9,
  } as LiveGamePlayer;
  if (!(sortForInGameList(meaningfulLowerSeason, nonMeaningfulHigherSeason) < 0)) {
    console.warn("[ranking] Guardrail failed: in-game list ordering should ignore season fallback.");
  }
}

function sortForSeasonRank(a: LiveGamePlayer, b: LiveGamePlayer): number {
  const ratingDiff = (b.seasonRating ?? 0) - (a.seasonRating ?? 0);
  if (ratingDiff !== 0) {
    return ratingDiff;
  }

  const effDiff = (b.seasonEffPerMin ?? 0) - (a.seasonEffPerMin ?? 0);
  if (effDiff !== 0) {
    return effDiff;
  }

  return a.lastName.localeCompare(b.lastName);
}

function buildMinutesMap(playersByTeam: Record<string, LiveGamePlayer[]>): Map<string, number> {
  const minutesByPlayerId = new Map<string, number>();
  Object.values(playersByTeam).forEach((players) => {
    players.forEach((player) => {
      const minutes = Number.isFinite(player.minutes) ? player.minutes : 0;
      minutesByPlayerId.set(player.id, minutes);
    });
  });
  return minutesByPlayerId;
}

function buildSyncCalibrationPlays(
  plays: LiveGamePlay[],
  firstSeenByPlayId: Map<string, string>,
): LiveGameSyncCalibrationPlay[] {
  return plays
    .map((play, index) => ({ play, index }))
    .filter(({ play }) => firstSeenByPlayId.has(play.id))
    .sort((left, right) => {
      const leftId = Number(left.play.id);
      const rightId = Number(right.play.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
        return leftId - rightId;
      }
      return left.index - right.index;
    })
    .slice(-SYNC_CALIBRATION_PLAY_LIMIT)
    .reverse()
    .map(({ play }) => ({
      id: play.id,
      text: play.text,
      period: play.period,
      clock: play.clock,
      awayScore: play.awayScore,
      homeScore: play.homeScore,
      firstSeenAtIso: firstSeenByPlayId.get(play.id) ?? new Date().toISOString(),
    }));
}

function withPlayerRanks(
  data: LiveGameData,
  seasonRatingsByAthlete: Map<string, SeasonPlayerRatingOutput>,
  prevMinutesByPlayerId: Map<string, number>,
  previousData: LiveGameData | null,
): { data: LiveGameData; onCourtDebug: OnCourtDebugInfo } {
  assertGameRankComparator();
  const nextPlayersByTeam: Record<string, LiveGamePlayer[]> = {};
  const homeTeam = data.teams.find((team) => team.homeAway === 'home') ?? data.teams[1] ?? null;
  const awayTeam = data.teams.find((team) => team.homeAway === 'away') ?? data.teams[0] ?? null;
  const allPlayers = Object.entries(data.playersByTeam).flatMap(([teamId, players]) =>
    players.map((player) => ({ teamId, player })),
  );
  const lookup = buildImpactPlayerLookup(data.playersByTeam);

  const currentPlayers = allPlayers
    .map(({ teamId, player }) => ({
      playerId: player.id,
      teamId,
      MIN: player.minutes,
      name: player.name,
      starter: player.starter,
      active: player.active && !player.didNotPlay,
    }))
    .filter((player) => player.playerId && player.teamId);
  const previousOnCourtByTeamId = new Map<string, string[]>(
    Object.entries(previousData?.playersByTeam ?? {}).map(([teamId, players]) => [
      teamId,
      players.filter((player) => player.onCourt).map((player) => player.id),
    ]),
  );
  const substitutionSignals: LineupSubstitutionInput[] = data.substitutions
    .map((substitution, index) => {
      const teamId = substitution.teamId;
      if (!teamId) {
        return null;
      }
      const parsed = parseNormalizedSubstitutionDescription(substitution.description);
      if (!parsed) {
        return null;
      }
      const resolved = findPlayerIdsInDescription(
        `${parsed.inPlayer} in for ${parsed.outPlayer}`,
        teamId,
        lookup,
      );
      if (!resolved.primaryId || !resolved.secondaryId || resolved.primaryId === resolved.secondaryId) {
        return null;
      }
      const elapsedSec = parsePeriodClockToElapsedSeconds(substitution.period, substitution.clock) ?? index;
      return {
        id: substitution.id,
        teamId,
        elapsedSec,
        inPlayerId: resolved.primaryId,
        outPlayerId: resolved.secondaryId,
      };
    })
    .filter((row): row is LineupSubstitutionInput => Boolean(row));

  const inferred = inferOnCourtByMinuteDelta({
    currentPlayers,
    prevMinutesByPlayerId,
    homeTeamId: homeTeam?.id ?? '',
    awayTeamId: awayTeam?.id ?? '',
    previousOnCourtByTeamId,
    substitutions: substitutionSignals,
  });
  const onCourtSet = new Set([...inferred.homeOnCourtIds, ...inferred.awayOnCourtIds]);
  if (__DEV__) {
    const countForTeam = (teamId: string | undefined | null): number =>
      currentPlayers.filter((row) => row.teamId === teamId && onCourtSet.has(row.playerId)).length;
    const homeCount = countForTeam(homeTeam?.id);
    const awayCount = countForTeam(awayTeam?.id);
    if (homeTeam?.id && homeCount < 5) {
      console.warn(`[on-court] Home inference below 5 (${homeCount}) for team ${homeTeam.shortDisplayName ?? homeTeam.id}.`);
    }
    if (awayTeam?.id && awayCount < 5) {
      console.warn(`[on-court] Away inference below 5 (${awayCount}) for team ${awayTeam.shortDisplayName ?? awayTeam.id}.`);
    }
  }
  const teamIdByPlayerId = new Map<string, string>(
    allPlayers.map(({ teamId, player }) => [player.id, teamId]),
  );
  const teamPlayerIdsByTeamId = new Map<string, string[]>(
    Object.entries(data.playersByTeam).map(([teamId, players]) => [teamId, players.map((player) => player.id)]),
  );
  const snapshotBoxesById = new Map<string, PlayerBox>(
    allPlayers.map(({ player }) => [player.id, buildSnapshotPlayerBox(player)]),
  );
  const playsWithElapsed = data.plays
    .map((play, index) => ({
      play,
      index,
      elapsed:
        parsePeriodClockToElapsedSeconds(play.period, play.clock) ?? index,
      homeScore: toNumber(play.homeScore, 0),
      awayScore: toNumber(play.awayScore, 0),
    }))
    .sort((a, b) => a.elapsed - b.elapsed || a.index - b.index);
  const totalElapsed = Math.max(1, playsWithElapsed.at(-1)?.elapsed ?? 1);

  // Incremental replay: reuse the accumulated state from the last call for
  // this exact game if its processed plays are an exact-content PREFIX of
  // the current sorted play list — i.e. nothing already-processed changed,
  // only (maybe) new plays were appended. Any mismatch at all (a different
  // game, a retracted/edited play, first-ever call) falls back to a full
  // rebuild from empty, so this can only ever save work, never produce
  // different output than a full replay would. Once a game is final and
  // fully caught up, this also makes re-opening it later in the same
  // session — or the poll that fires right as it goes final — effectively
  // free, since there are never any new plays left to fold in.
  const playFingerprints = playsWithElapsed.map(
    ({ play }) => `${play.id}:${play.homeScore}:${play.awayScore}:${play.text}`,
  );
  const impactReplayCacheKey = `${data.mode}:${data.eventId}`;
  const cachedAccumulator = impactReplayAccumulatorCache.get(impactReplayCacheKey);
  const canReuseAccumulator =
    !!cachedAccumulator &&
    cachedAccumulator.fingerprints.length <= playFingerprints.length &&
    cachedAccumulator.fingerprints.every((fp, i) => fp === playFingerprints[i]);

  if (__DEV__) {
    const newPlayCount = canReuseAccumulator
      ? playFingerprints.length - (cachedAccumulator?.fingerprints.length ?? 0)
      : playFingerprints.length;
    console.log(
      `[impact-replay] ${impactReplayCacheKey}: ${
        canReuseAccumulator ? `reused accumulator, ${newPlayCount} new play(s) to fold in` : `full rebuild (${newPlayCount} plays)`
      }`,
    );
  }

  const impactByPlayerId = canReuseAccumulator
    ? cachedAccumulator.impactByPlayerId
    : new Map<string, PlayerImpact>();
  const ratingTimelineByPlayerId = canReuseAccumulator
    ? cachedAccumulator.ratingTimelineByPlayerId
    : new Map<string, LiveGameRatingTimelinePoint[]>();
  // Any player not already seeded (a fresh accumulator, or a player who
  // wasn't present on a prior partial replay) gets the same starting point
  // a full rebuild would have given them.
  allPlayers.forEach(({ player }) => {
    if (!ratingTimelineByPlayerId.has(player.id)) {
      ratingTimelineByPlayerId.set(player.id, [createInitialRatingTimelinePoint()]);
    }
  });
  const eventDisplayRatingsByEventId = canReuseAccumulator
    ? cachedAccumulator.eventDisplayRatingsByEventId
    : new Map<
        string,
        { displayRatingBefore: number | null; displayRatingAfter: number | null; displayDelta: number | null }
      >();
  const eventBoxesByPlayerId = canReuseAccumulator
    ? cachedAccumulator.eventBoxesByPlayerId
    : new Map<string, PlayerBox>();
  const threePtByPlayerId = canReuseAccumulator
    ? cachedAccumulator.threePtByPlayerId
    : new Map<string, { made: number; attempted: number }>();
  // IMPACT: running event-derived clutch bonus per player (raw-impact units).
  const clutchBonusByPlayerId = canReuseAccumulator
    ? cachedAccumulator.clutchBonusByPlayerId
    : new Map<string, number>();
  // MOMENTUM: independent per-player event stream (never touches Impact).
  const momentumEventsByPlayerId = canReuseAccumulator
    ? cachedAccumulator.momentumEventsByPlayerId
    : new Map<string, MomentumInputEvent[]>();
  const timing = getPeriodTimingForMode(data.mode);
  const regulationPeriods = timing.regulationPeriods;

  const newPlaysStartIndex = canReuseAccumulator ? cachedAccumulator.fingerprints.length : 0;
  let previousMargin = canReuseAccumulator ? cachedAccumulator.previousMargin : 0;
  playsWithElapsed.slice(newPlaysStartIndex).forEach(({ play, elapsed, homeScore, awayScore }) => {
    const margin = homeScore - awayScore;
    const leadChangedOnPlay =
      previousMargin !== 0 &&
      margin !== 0 &&
      Math.sign(previousMargin) !== Math.sign(margin);
    const derivedEvents = buildImpactEventsFromPlay(play, lookup, leadChangedOnPlay);
    derivedEvents.forEach(({ event, elapsedSec }) => {
      const playerId = event.playerId;
      if (!playerId) {
        return;
      }
      const snapshotBox =
        snapshotBoxesById.get(playerId) ?? createEmptyPlayerBox(playerId);
      const existingEventBox =
        eventBoxesByPlayerId.get(playerId) ?? {
          ...createEmptyPlayerBox(playerId),
          minutes: 0,
        };
      const estimatedMinutes =
        snapshotBox.minutes *
        clamp(elapsed / Math.max(1, totalElapsed), 0, 1);
      const boxBefore: PlayerBox = {
        ...existingEventBox,
        minutes: Math.max(existingEventBox.minutes, estimatedMinutes),
      };

      const context: GameContext = {
        period: event.period,
        clockSec: event.clockSec,
        homeScore: event.homeScore,
        awayScore: event.awayScore,
        leadChangedOnPlay,
        regulationPeriods,
      };
      const baselineImpact = computeImpactFromBox(boxBefore, context);
      const currentImpact: PlayerImpact = impactByPlayerId.get(playerId) ?? {
        playerId,
        rating: baselineImpact.rating,
        rawImpact: baselineImpact.rawImpact,
      };
      const eventTeamId = teamIdByPlayerId.get(playerId) ?? event.teamId ?? null;
      const teammatePointsBefore = getTeammatePointsFromEventBoxes({
        teamId: eventTeamId,
        playerId,
        teamPlayerIdsByTeamId,
        eventBoxesByPlayerId,
      });
      // Event-derived clutch accrued from this player's earlier plays (Impact only).
      const clutchBonusBefore = clutchBonusByPlayerId.get(playerId) ?? 0;
      // CONSOLIDATED Impact: production x leadership + clutch -> blended display,
      // in one call (replaces the old core -> leadership -> display-blend stack).
      const before = computeInGameImpactRating({
        box: boxBefore,
        ctx: context,
        teammatePoints: teammatePointsBefore,
        clutchImpactBonus: clutchBonusBefore,
      });
      const beforeModelRating = before.modelRating;
      const displayRatingBefore = before.visible ? before.displayRating : null;

      const { nextImpact, nextBox } = updatePlayerImpactFromEvent(
        currentImpact,
        boxBefore,
        event,
        context,
      );
      const isMadeScoringEvent = event.type === 'MADE_SHOT' || event.type === 'MADE_FT';
      const threeBefore = threePtByPlayerId.get(playerId) ?? { made: 0, attempted: 0 };
      let threeAfter = threeBefore;
      if (event.shotType === '3PT' && (event.type === 'MADE_SHOT' || event.type === 'MISS_SHOT')) {
        threeAfter = {
          made: threeBefore.made + (event.type === 'MADE_SHOT' ? 1 : 0),
          attempted: threeBefore.attempted + 1,
        };
      }
      threePtByPlayerId.set(playerId, threeAfter);
      eventBoxesByPlayerId.set(playerId, nextBox);
      impactByPlayerId.set(playerId, nextImpact);

      // IMPACT: accrue this play's clutch weight (signed, so a clutch turnover
      // hurts more) so the authoritative rating counts clutch exactly once.
      const clutchDelta = computeClutchImpactDelta({
        boxBefore,
        boxAfter: nextBox,
        ctx: context,
      });
      const clutchBonusAfter = Number((clutchBonusBefore + clutchDelta).toFixed(3));
      clutchBonusByPlayerId.set(playerId, clutchBonusAfter);

      // MOMENTUM: record this play in the player's independent event stream. This
      // never reads or writes any Impact value — the two metrics stay separate.
      const momentumEvents = momentumEventsByPlayerId.get(playerId) ?? [];
      momentumEvents.push({
        eventId: event.id,
        canonicalType: event.type as CanonicalPbpEventType,
        shotPoints: event.points,
        tSec: elapsedSec,
        period: event.period,
        clockSec: event.clockSec,
        scoreMargin: Math.abs(event.homeScore - event.awayScore),
        regulationPeriods,
      });
      momentumEventsByPlayerId.set(playerId, momentumEvents);

      const teammatePointsAfter = getTeammatePointsFromEventBoxes({
        teamId: eventTeamId,
        playerId,
        teamPlayerIdsByTeamId,
        eventBoxesByPlayerId,
      });
      const after = computeInGameImpactRating({
        box: nextBox,
        ctx: context,
        teammatePoints: teammatePointsAfter,
        clutchImpactBonus: clutchBonusAfter,
      });
      if (__DEV__ && isMadeScoringEvent && after.rawImpact < before.rawImpact) {
        console.warn(
          `[impact-guard] made scoring event reduced impact: event=${event.id} player=${playerId} before=${before.rawImpact.toFixed(3)} after=${after.rawImpact.toFixed(3)}`,
        );
      }
      const afterModelRating = after.modelRating;
      const afterDisplayCandidate = after.displayRating;
      const displayRatingAfter = after.visible ? after.displayRating : null;
      const displayDelta =
        displayRatingBefore === null || displayRatingAfter === null
          ? null
          : Number((displayRatingAfter - displayRatingBefore).toFixed(1));
      eventDisplayRatingsByEventId.set(event.id, {
        displayRatingBefore,
        displayRatingAfter,
        displayDelta,
      });
      const timelinePoints = ratingTimelineByPlayerId.get(playerId) ?? [createInitialRatingTimelinePoint()];
      const timelineReason =
        nextImpact.lastMeaningfulImpact?.eventId === event.id
          ? nextImpact.lastMeaningfulImpact.description
          : event.description;
      const eventDisplayRatings = eventDisplayRatingsByEventId.get(event.id);
      const timelineImpact =
        nextImpact.lastMeaningfulImpact?.eventId === event.id
          ? nextImpact.lastMeaningfulImpact
          : null;
      upsertTimelinePoint(timelinePoints, {
        tSec: elapsedSec,
        rating: afterDisplayCandidate,
        reason: timelineReason,
        eventId: event.id,
        description: timelineReason,
        period: event.period,
        clockSec: event.clockSec,
        ratingBefore: timelineImpact?.ratingBefore ?? beforeModelRating ?? baselineImpact.rating,
        ratingAfter: timelineImpact?.ratingAfter ?? afterModelRating ?? nextImpact.rating,
        delta:
          timelineImpact?.delta ??
          Number(((afterModelRating ?? nextImpact.rating) - (beforeModelRating ?? baselineImpact.rating)).toFixed(3)),
        displayRatingBefore: eventDisplayRatings?.displayRatingBefore ?? displayRatingBefore,
        displayRatingAfter: eventDisplayRatings?.displayRatingAfter ?? displayRatingAfter,
        displayDelta: eventDisplayRatings?.displayDelta ?? displayDelta,
        stats: timelineStatsFromSnapshot(nextBox, threeAfter),
      });
      ratingTimelineByPlayerId.set(playerId, timelinePoints);
    });

    previousMargin = margin;
  });

  // Persist the now-fully-caught-up accumulator for the next call — either
  // a later poll of a live game (which will only need to fold in whatever's
  // new next time) or a re-open of this same game later in the session
  // (which will find zero new plays and skip the loop above entirely).
  rememberImpactReplayAccumulator(impactReplayCacheKey, {
    fingerprints: playFingerprints,
    previousMargin,
    impactByPlayerId,
    eventBoxesByPlayerId,
    threePtByPlayerId,
    clutchBonusByPlayerId,
    momentumEventsByPlayerId,
    ratingTimelineByPlayerId,
    eventDisplayRatingsByEventId,
  });

  const currentHomeScore = toNumber(homeTeam?.score, 0);
  const currentAwayScore = toNumber(awayTeam?.score, 0);
  const currentClockSec = parseClockDisplayToSeconds(data.status.displayClock);
  const currentContext: GameContext = {
    period: Math.max(1, data.status.period),
    clockSec: currentClockSec,
    homeScore: currentHomeScore,
    awayScore: currentAwayScore,
    possessionTeamId: data.possessionTeamId ?? undefined,
    regulationPeriods,
  };
  const ratingTimelineDurationSec = resolveTimelineDurationSec({
    data,
    playsWithElapsed,
    timelineByPlayerId: ratingTimelineByPlayerId,
  });

  snapshotBoxesById.forEach((snapshotBox, playerId) => {
    const snapshotImpact = computeImpactFromBox(snapshotBox, currentContext);
    const existing = impactByPlayerId.get(playerId);
    impactByPlayerId.set(playerId, {
      playerId,
      rating: snapshotImpact.rating,
      rawImpact: snapshotImpact.rawImpact,
      lastMeaningfulImpact: existing?.lastMeaningfulImpact,
    });
  });

  const enrichedByTeamId: Record<string, LiveGamePlayer[]> = {};
  const snapshotBoxByPlayerIdGlobal = new Map<string, PlayerBox>();

  Object.entries(data.playersByTeam).forEach(([teamId, players]) => {
    const previousTeamPlayers = previousData?.playersByTeam[teamId] ?? [];
    const previousMinutesByPlayer = new Map(previousTeamPlayers.map((player) => [player.id, player.minutes]));
    const snapshotBoxByPlayerId = new Map<string, PlayerBox>();

    const enriched = players.map((player) => {
      const season = seasonRatingsByAthlete.get(player.id);
      const live = impactByPlayerId.get(player.id);
      const snapshotBox = snapshotBoxesById.get(player.id) ?? buildSnapshotPlayerBox(player);
      const currentThreePt = parseMadeAttempted(player.threePt);
      const fallbackStats = timelineStatsFromSnapshot(snapshotBox, {
        made: currentThreePt.made,
        attempted: currentThreePt.attempted,
      });
      const rawTimelinePoints = ratingTimelineByPlayerId.get(player.id) ?? [createInitialRatingTimelinePoint()];
      let lastKnownStats: LiveGameRatingTimelinePoint['stats'] = fallbackStats;
      const ratingTimelinePoints = rawTimelinePoints.map((point) => {
        const stats = point.stats ?? lastKnownStats ?? fallbackStats;
        lastKnownStats = stats;
        return {
          ...point,
          stats,
        };
      });
      snapshotBoxByPlayerId.set(player.id, snapshotBox);
      const meaningfulSample = hasMeaningfulInGameSample(snapshotBox);
      const previousMinutes = previousMinutesByPlayer.get(player.id);
      const minutesIncreasing =
        previousMinutes !== undefined ? player.minutes > previousMinutes : player.minutes > 0;
      const missedFG = Math.max(0, snapshotBox.fga - snapshotBox.fgm);
      const missedFT = Math.max(0, snapshotBox.fta - snapshotBox.ftm);
      const gameEff =
        snapshotBox.points +
        snapshotBox.reb +
        snapshotBox.ast +
        snapshotBox.stl +
        snapshotBox.blk -
        (missedFG + missedFT + snapshotBox.tov);
      const gameEffPer40 = snapshotBox.minutes > 0 ? (gameEff / snapshotBox.minutes) * 40 : 0;
      const liveRawBase = live?.rawImpact ?? null;
      // CONSOLIDATED authoritative rating: the single Impact formula, evaluated
      // at the current game context with this player's accrued clutch bonus.
      const teammatePointsFinal = players
        .filter((candidate) => candidate.id !== player.id)
        .map((candidate) => Math.max(0, candidate.points));
      const clutchBonusFinal = clutchBonusByPlayerId.get(player.id) ?? 0;
      const consolidated = computeInGameImpactRating({
        box: snapshotBox,
        ctx: currentContext,
        teammatePoints: teammatePointsFinal,
        clutchImpactBonus: clutchBonusFinal,
      });
      const liveRaw = consolidated.rawImpact;
      const computedLiveRating = consolidated.displayRating;
      const ratingVisible = consolidated.visible;
      const liveRating = ratingVisible ? computedLiveRating : null;

      // MOMENTUM (independent metric): replay this player's event stream.
      const playerMomentumEvents = momentumEventsByPlayerId.get(player.id) ?? [];
      const momentumResult = computePlayerMomentum(
        playerMomentumEvents,
        ratingTimelineDurationSec,
      );
      const momentum = momentumResult.current;
      const momentumTimelinePoints: MomentumTimelinePoint[] = momentumResult.timeline;
      const momentumRecentStats = computeRecentStatsFromMomentumEvents(
        playerMomentumEvents,
        ratingTimelineDurationSec,
        ACTIVE_MOMENTUM_CONFIG.windowSec,
      );

      // Append a final "current" point so the sparkline endpoint matches the pill.
      // The replay loop computes timeline ratings at each event's context, but the
      // pill uses currentContext + current leadership. This syncs the two.
      if (liveRating !== null) {
        const lastTimelinePoint = ratingTimelinePoints[ratingTimelinePoints.length - 1];
        const currentTSec = ratingTimelineDurationSec;
        const roundedCurrentTSec = Math.max(0, Math.round(currentTSec));
        // Guard against a real, already-displayed peak silently vanishing
        // from the chart: multiple polls can land on the SAME rounded tSec
        // during dead-ball time (free throws, a timeout, a replay review —
        // anything where the game clock itself hasn't ticked between polls),
        // and upsertTimelinePoint treats "same tSec" as "same point, safe to
        // overwrite." The rating computed for that instant can still drift
        // poll-to-poll (e.g. a teammate's concurrent stat change feeding into
        // this player's relative-impact terms), so a later, lower
        // recomputation would otherwise silently replace a higher value the
        // user already saw live. The timeline is a historical record, not a
        // live-only readout — once shown, a peak should stay on the chart.
        const existingAtSameTSec =
          lastTimelinePoint && lastTimelinePoint.tSec === roundedCurrentTSec
            ? lastTimelinePoint
            : null;
        const anchoredRating =
          existingAtSameTSec && (existingAtSameTSec.rating ?? 0) > computedLiveRating
            ? existingAtSameTSec.rating
            : computedLiveRating;
        if (
          !lastTimelinePoint ||
          lastTimelinePoint.tSec < currentTSec ||
          Math.abs((lastTimelinePoint.rating ?? 0) - anchoredRating) >= 0.05
        ) {
          upsertTimelinePoint(ratingTimelinePoints, {
            tSec: currentTSec,
            rating: anchoredRating,
            stats: fallbackStats,
          });
        }
      }

      const baseLastImpact = live?.lastMeaningfulImpact;
      const displayLastImpact = baseLastImpact
        ? eventDisplayRatingsByEventId.get(baseLastImpact.eventId)
        : undefined;
      const lastMeaningfulImpact = baseLastImpact
        ? (() => {
            const merged = {
              ...baseLastImpact,
              ...(displayLastImpact
                ? {
                    displayRatingBefore: displayLastImpact.displayRatingBefore,
                    displayRatingAfter: displayLastImpact.displayRatingAfter,
                    displayDelta: displayLastImpact.displayDelta,
                  }
                : {}),
            };
            // Single source of truth: the Latest Play card must show the same
            // current rating as the photo badge. The badge is `liveRating`
            // (computed from the authoritative box snapshot); the reconstructed
            // event "after" can drift from it. Pin the displayed "after" to the
            // badge and derive "before" from the play's own (reconstructed)
            // delta so the arrow/delta still reads correctly.
            if (typeof liveRating === 'number' && Number.isFinite(liveRating)) {
              const pinnedAfter = Number(liveRating.toFixed(1));
              const rawDelta =
                merged.displayDelta ?? merged.delta ?? null;
              const delta =
                typeof rawDelta === 'number' && Number.isFinite(rawDelta)
                  ? Number(rawDelta.toFixed(1))
                  : null;
              const pinnedBefore =
                delta !== null ? Number((pinnedAfter - delta).toFixed(1)) : pinnedAfter;
              return {
                ...merged,
                displayRatingBefore: pinnedBefore,
                displayRatingAfter: pinnedAfter,
                displayDelta: delta ?? merged.displayDelta,
              };
            }
            return merged;
          })()
        : undefined;
      const chronologicalRatingTimelinePoints =
        sortRatingTimelinePointsChronologically(ratingTimelinePoints);

      return {
        ...player,
        seasonEffPerMin: season?.seasonEFF40 ?? null,
        liveEffPerMin: Number(gameEffPer40.toFixed(3)),
        seasonImpactRaw: season?.seasonRaw ?? null,
        inGameImpactRaw: liveRaw,
        liveRawBase: liveRawBase,
        liveRaw,
        liveDisplay: (liveRating === null ? '-' : liveRating) as '-' | number,
        seasonRating10: season?.seasonRating10 ?? null,
        inGameRating10: liveRating,
        gameRating: liveRating,
        seasonRating: season?.seasonRating10 ?? null,
        lowSample: Boolean(!meaningfulSample && snapshotBox.minutes < COLD_START_THRESHOLDS.minMinutesForLive),
        gameRank: null,
        seasonRank: null,
        minutesIncreasing,
        onCourt: onCourtSet.has(player.id),
        minuteDelta: Math.max(0, player.minutes - (previousMinutesByPlayer.get(player.id) ?? 0)),
        lastMeaningfulImpact,
        ratingTimelinePoints: chronologicalRatingTimelinePoints,
        ratingTimelineDurationSec,
        momentum,
        momentumTimelinePoints,
        momentumRecentStats,
      };
    });

    if (__DEV__) {
      for (const player of enriched) {
        const box = snapshotBoxByPlayerId.get(player.id) ?? buildSnapshotPlayerBox(player);
        const recomputed = computeInGameImpactRating({
          box,
          ctx: currentContext,
          teammatePoints: [],
          clutchImpactBonus: clutchBonusByPlayerId.get(player.id) ?? 0,
        });
        const ratingVisible = recomputed.visible;
        if (!ratingVisible && (player.inGameRating10 !== null || player.gameRating !== null || player.liveDisplay !== '-')) {
          console.warn(`[rating] Guardrail failed: hidden in-game rating should remain null/"-".`);
        }
        if (ratingVisible && (player.inGameRating10 === null || player.gameRating === null || player.liveDisplay === '-')) {
          console.warn(`[rating] Guardrail failed: visible in-game rating should be populated.`);
        }
        const impact = player.lastMeaningfulImpact;
        if (impact?.eventId) {
          const snapshot = eventDisplayRatingsByEventId.get(impact.eventId);
          if (snapshot) {
            if (
              impact.displayRatingBefore === undefined ||
              impact.displayRatingAfter === undefined ||
              impact.displayDelta === undefined
            ) {
              console.warn(`[impact] Guardrail failed: display-aligned last impact fields missing for event ${impact.eventId}.`);
            }
            if (
              !isFiniteOrNull(impact.displayRatingBefore) ||
              !isFiniteOrNull(impact.displayRatingAfter) ||
              !isFiniteOrNull(impact.displayDelta)
            ) {
              console.warn(`[impact] Guardrail failed: display-aligned last impact fields must be finite numbers or null.`);
            }
          }
        }
        const missingStatsPoint = player.ratingTimelinePoints?.find((point) => !point.stats);
        if (missingStatsPoint) {
          console.warn(`[timeline] Guardrail failed: timeline stats missing for player ${player.id} at ${missingStatsPoint.tSec}s.`);
        }
      }
    }
    enrichedByTeamId[teamId] = enriched;
    snapshotBoxByPlayerId.forEach((snapshotBox, playerId) => {
      snapshotBoxByPlayerIdGlobal.set(playerId, snapshotBox);
    });
  });

  const globalGameRankMap = new Map<string, number>();
  Object.values(enrichedByTeamId)
    .flat()
    .filter((player) => {
      const box = snapshotBoxByPlayerIdGlobal.get(player.id) ?? buildSnapshotPlayerBox(player);
      return isEligibleForInGameRank({
        box,
        onCourt: player.onCourt,
        inGameImpactRaw: player.inGameImpactRaw,
      });
    })
    .sort(sortForGameRank)
    .forEach((player, index) => {
      globalGameRankMap.set(player.id, index + 1);
    });

  if (__DEV__) {
    const rankedPlayers = Object.values(enrichedByTeamId)
      .flat()
      .filter((player) => globalGameRankMap.has(player.id));
    const topRankCount = rankedPlayers.filter((player) => globalGameRankMap.get(player.id) === 1).length;
    if (topRankCount > 1) {
      console.warn('[ranking] Guardrail failed: more than one player has global gameRank #1.');
    }
    const assignedRanks = rankedPlayers
      .map((player) => globalGameRankMap.get(player.id))
      .filter((rank): rank is number => typeof rank === 'number');
    if (new Set(assignedRanks).size !== assignedRanks.length) {
      console.warn('[ranking] Guardrail failed: duplicate global gameRank values detected.');
    }
    for (const player of Object.values(enrichedByTeamId).flat()) {
      const box = snapshotBoxByPlayerIdGlobal.get(player.id) ?? buildSnapshotPlayerBox(player);
      const eligible = isEligibleForInGameRank({
        box,
        onCourt: player.onCourt,
        inGameImpactRaw: player.inGameImpactRaw,
      });
      if (!eligible && globalGameRankMap.has(player.id)) {
        console.warn(`[ranking] Guardrail failed: ineligible player ${player.id} received global gameRank.`);
      }
    }
  }

  Object.entries(enrichedByTeamId).forEach(([teamId, enriched]) => {
    const seasonRankMap = new Map<string, number>();
    [...enriched]
      .filter((player) => player.seasonRating !== null)
      .sort(sortForSeasonRank)
      .forEach((player, index) => {
        seasonRankMap.set(player.id, index + 1);
      });

    nextPlayersByTeam[teamId] = enriched
      .map((player) => ({
        ...player,
        gameRank: globalGameRankMap.get(player.id) ?? null,
        seasonRank: seasonRankMap.get(player.id) ?? null,
      }))
      .sort(sortForInGameList);
  });

  return {
    data: {
      ...data,
      playersByTeam: nextPlayersByTeam,
      // Structured, elapsedSec-timestamped, player-ID-resolved substitution
      // events — the same `substitutionSignals` already computed above for
      // the live on-court inference, just also attached to the public data
      // so OTHER consumers (the Court tab's history scrubber) can replay
      // "who was on court at time X" for themselves without re-parsing
      // `data.substitutions`' free-text descriptions.
      lineupSubstitutions: substitutionSignals,
    },
    onCourtDebug: inferred.debug,
  };
}

export function LiveGameProvider({ children }: { children: React.ReactNode }) {
  const { mode } = useGameModeState();
  const { setMode } = useGameModeActions();
  const { state: settingsState } = useSettingsState();
  const liveDataDelaySeconds = settingsState.inGame.liveDataDelaySeconds;
  // getApiBaseUrl() is the single source of truth for the API base URL
  // (local/tunnel EXPO_PUBLIC_API_MODE toggle + emulator/simulator
  // fallbacks) — this used to override a falsy result with a hardcoded LAN
  // IP, which silently ignored tunnel mode whenever getApiBaseUrl() came
  // back null instead of surfacing the same "API not configured" state the
  // rest of the app already knows how to show.
  const getApiBase = useCallback(() => getApiBaseUrl(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [isFromCache, setIsFromCache] = useState(false);
  const [gameId, setGameIdState] = useState(DEFAULT_GAME_ID_BY_MODE.college);
  const [data, setData] = useState<LiveGameData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [syncCalibrationPlays, setSyncCalibrationPlays] = useState<
    LiveGameSyncCalibrationPlay[]
  >([]);
  const [pollingEnabled, setPollingEnabled] = useState(true);
  // Surfaced to the UI when polling is supposedly active but no poll has
  // actually landed in a while (see the watchdog effect below) — a subtle
  // "reconnecting" signal rather than silently going stale with no feedback.
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [debug, setDebug] = useState<LiveGameDebug>({
    url: `${mode}:${DEFAULT_GAME_ID_BY_MODE[mode]}`,
    lastStatus: null,
    parsedCounts: {},
  });

  const signatureRef = useRef('');
  const seasonInputRef = useRef<Map<string, SeasonPlayerRatingInput>>(new Map());
  const rosterRef = useRef<Map<string, LiveGamePlayer[]>>(new Map());
  const logoRef = useRef<Map<string, string>>(new Map());
  const seasonPowerCacheRef = useRef<Map<string, SeasonPowerCacheEntry>>(new Map());
  const pregameTeamSeasonStatsCacheRef = useRef<Map<string, PregameTeamSeasonStatsEntry | null>>(new Map());
  const prevMinutesByPlayerIdRef = useRef<Map<string, number>>(new Map());
  const dataRef = useRef<LiveGameData | null>(null);
  const displayedSignatureRef = useRef('');
  const delayTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const firstSeenByPlayIdRef = useRef<Map<string, string>>(new Map());
  const errorRef = useRef<string | null>(null);
  // Counts consecutive polls that read the game as finished. A single 'post'
  // reading is disabled here on purpose — ESPN's summary endpoint is known
  // to occasionally report a stale/incorrect status for one poll cycle
  // (backend caching lag around period breaks especially), and trusting
  // that single read to permanently disable polling (see the old
  // `if (withRatings.status.state === 'post') setPollingEnabled(false)`)
  // was the actual root cause of live games silently freezing until the
  // screen was left and re-entered. Requiring the SAME reading twice in a
  // row before stopping costs at most one extra ~5s poll on a real final,
  // while making a one-off flaky read harmless.
  const consecutiveFinalReadsRef = useRef(0);
  // Timestamp of the last poll that actually completed successfully
  // (regardless of whether the data it returned was new) — the input to the
  // staleness watchdog below. Deliberately NOT the same as `lastUpdated`,
  // which only advances when the DISPLAYED data changes and would read as
  // "stale" during a perfectly healthy quiet stretch of a live game.
  const lastSuccessfulPollAtRef = useRef<number>(Date.now());
  // Mirrors `pollingEnabled` into a ref so the watchdog's interval (which
  // intentionally does NOT depend on `pollingEnabled`, so it keeps running
  // even if polling itself were ever wedged) can read the current value
  // without needing to be recreated every time polling toggles.
  const pollingEnabledRef = useRef(true);

  const clearDelayTimers = useCallback(() => {
    delayTimersRef.current.forEach((timer) => clearTimeout(timer));
    delayTimersRef.current = [];
  }, []);

  const publishLiveData = useCallback(
    (nextData: LiveGameData, fetchedAtIso: string) => {
      const nextSignature = buildImportantSignature(nextData);
      const commit = () => {
        displayedSignatureRef.current = nextSignature;
        setData(nextData);
        setLastUpdated(fetchedAtIso);
      };

      if (liveDataDelaySeconds <= 0) {
        commit();
        return;
      }

      const timer = setTimeout(() => {
        delayTimersRef.current = delayTimersRef.current.filter((item) => item !== timer);
        commit();
      }, liveDataDelaySeconds * 1000);
      delayTimersRef.current.push(timer);
    },
    [liveDataDelaySeconds],
  );

  const setGameId = useCallback((nextGameId: string, nextMode?: GameMode) => {
    const resolvedMode = nextMode ?? mode;
    if (!nextGameId) {
      return;
    }
    if (resolvedMode !== mode) {
      setMode(resolvedMode);
    }
    if (nextGameId === gameId && resolvedMode === mode) {
      return;
    }
    setGameIdState(nextGameId);
  }, [gameId, mode, setMode]);

  useEffect(() => {
    if (!gameId) {
      setGameIdState(DEFAULT_GAME_ID_BY_MODE[mode]);
    }
  }, [gameId, mode]);

  useEffect(() => {
    setPollingEnabled(true);
    setIsReconnecting(false);
    consecutiveFinalReadsRef.current = 0;
    lastSuccessfulPollAtRef.current = Date.now();
    setLoading(true);
    setIsFromCache(false);
    setError(null);
    errorRef.current = null;
    signatureRef.current = '';
    displayedSignatureRef.current = '';
    clearDelayTimers();
    firstSeenByPlayIdRef.current = new Map();
    setSyncCalibrationPlays([]);
    prevMinutesByPlayerIdRef.current = new Map();
    dataRef.current = null;
    // Instant-shell seed: if the schedule list stashed this game's
    // already-known data before navigating here, paint it right away rather
    // than starting from a blank `data`. Deliberately assigned to `setData`
    // only, NOT `dataRef.current` — refresh()'s own cold-open detection
    // (`!dataRef.current`) and the ratings-enrichment phase's `previousData`
    // must stay exactly as they were before this feature existed; this seed
    // is purely a transient value for the UI to render while the real fetch
    // pipeline (unchanged) runs underneath it and then overwrites it.
    const seed = consumePendingGameSeed(gameId);
    setData(seed ? buildSeedLiveGameData(seed, mode) : null);
    setLastUpdated(null);
    setDebug((prev) => ({
      ...prev,
      url: `${mode}:${gameId}`,
      lastStatus: null,
      parsedCounts: {},
    }));
  }, [clearDelayTimers, gameId, getApiBase, mode]);

  useEffect(() => {
    if (liveDataDelaySeconds <= 0 && dataRef.current) {
      clearDelayTimers();
      publishLiveData(dataRef.current, new Date().toISOString());
    }
  }, [clearDelayTimers, liveDataDelaySeconds, publishLiveData]);

  useEffect(() => {
    return () => {
      clearDelayTimers();
    };
  }, [clearDelayTimers]);

  useEffect(() => {
    let mounted = true;
    const loadCached = async () => {
      const cached = await getCachedLiveGame<LiveGameData>(gameId, mode);
      if (!mounted || !cached) {
        return;
      }
      const cachedData = cached.data.mode ? cached.data : { ...cached.data, mode };
      signatureRef.current = buildImportantSignature(cachedData);
      displayedSignatureRef.current = signatureRef.current;
      dataRef.current = cachedData;
      cachedData.plays.forEach((play) => {
        firstSeenByPlayIdRef.current.set(
          play.id,
          new Date(cached.fetchedAt).toISOString(),
        );
      });
      setSyncCalibrationPlays(
        buildSyncCalibrationPlays(cachedData.plays, firstSeenByPlayIdRef.current),
      );
      prevMinutesByPlayerIdRef.current = buildMinutesMap(cachedData.playersByTeam);
      setData(cachedData);
      setLastUpdated(new Date(cached.fetchedAt).toISOString());
      setIsFromCache(true);
      setLoading(false);
    };
    loadCached();
    return () => {
      mounted = false;
    };
  }, [gameId, mode]);

  const refresh = useCallback(async () => {
    try {
      const apiBase = getApiBase();
      if (!apiBase) {
        throw new Error(API_SETUP_MESSAGE);
      }
      const payload = await fetchLiveGamePayload(mode, gameId);
      console.log(`[LiveGame] URL: ${apiBase}/${mode}/game/${gameId}/live`);

      // Phase 1: parse + roster/logo fallback only — no per-player network
      // calls, so this resolves quickly regardless of roster size.
      const shell = await buildLiveGameShellFromPayload({
        apiBase,
        gameId,
        mode,
        payload,
        rosterCache: rosterRef.current,
        logoCache: logoRef.current,
        seasonPowerCache: seasonPowerCacheRef.current,
        pregameTeamSeasonStatsCache: pregameTeamSeasonStatsCacheRef.current,
      });

      if (shell.status === 'empty') {
        setDebug((prev) => (prev.lastStatus === shell.code ? prev : { ...prev, lastStatus: shell.code }));
        setIsOffline(shell.isOffline);
        setIsFromCache(Boolean(dataRef.current));
        if (!dataRef.current) {
          signatureRef.current = '';
          setData(null);
          setLastUpdated(null);
        }
        if (errorRef.current !== shell.message) {
          errorRef.current = shell.message;
          setError(shell.message);
        }
        return;
      }

      if (shell.status === 'error') {
        setDebug((prev) => (prev.lastStatus === shell.code ? prev : { ...prev, lastStatus: shell.code }));
        console.warn(`[LiveGame] College Baseball fetch warning: ${shell.message}`);
        if (errorRef.current !== shell.message) {
          errorRef.current = shell.message;
          setError(shell.message);
        }
        setIsOffline(shell.isOffline);
        setIsFromCache(Boolean(dataRef.current));
        if (!dataRef.current) {
          signatureRef.current = '';
          setData(null);
          setLastUpdated(null);
        }
        return;
      }

      if (shell.status !== 'ok') {
        return;
      }

      // Paint the shell immediately on a COLD open (no data displayed yet) —
      // score, team names, and the tab bar can render now instead of
      // waiting on the much slower per-player ratings fetch + full-game
      // replay below (enrichLiveGameShellWithPlayerRanks). Gated on
      // `!dataRef.current` so this never applies mid-session: a routine
      // poll of an already-loaded game must not flash ratings/on-court
      // state back to blank just because this poll's shell resolved before
      // its ratings phase did. `loading` is intentionally left false here
      // (not reset to true later) — the ratings phase's own setData below
      // simply updates the same data in place once it lands.
      if (!shell.isFinal && !dataRef.current) {
        setData(shell.data);
        setLoading(false);
      }

      // Phase 2 (skipped for baseball, which has no separate ratings phase):
      // the slow part — per-player season-rating fetch + full-game replay.
      const built: BuildLiveGameDataFromPayloadResult = shell.isFinal
        ? {
            status: 'ok',
            data: shell.data,
            parsedCounts: shell.parsedCounts,
            onCourtDebug: null,
          }
        : await (async () => {
            if (__DEV__) {
              console.time('[timing] useLiveGame:enrichLiveGameShellWithPlayerRanks');
            }
            const ranked = await enrichLiveGameShellWithPlayerRanks(shell.data, {
              mode,
              previousData: dataRef.current,
              prevMinutesByPlayerId: prevMinutesByPlayerIdRef.current,
              seasonInputCache: seasonInputRef.current,
            });
            if (__DEV__) {
              console.timeEnd('[timing] useLiveGame:enrichLiveGameShellWithPlayerRanks');
            }
            return {
              status: 'ok' as const,
              data: ranked.data,
              parsedCounts: shell.parsedCounts,
              onCourtDebug: ranked.onCourtDebug,
            };
          })();

      if (built.status !== 'ok') {
        return;
      }

      setDebug((prev) => (prev.lastStatus === 200 ? prev : { ...prev, lastStatus: 200 }));
      const withRatings = built.data;
      const fetchedAtIso = new Date().toISOString();
      withRatings.plays.forEach((play) => {
        if (!firstSeenByPlayIdRef.current.has(play.id)) {
          firstSeenByPlayIdRef.current.set(play.id, fetchedAtIso);
        }
      });
      setSyncCalibrationPlays(
        buildSyncCalibrationPlays(withRatings.plays, firstSeenByPlayIdRef.current),
      );

      console.log(
        `[LiveGame] Parsed player rows -> ${Object.entries(built.parsedCounts)
          .map(([team, count]) => `${team}: ${count}`)
          .join(', ')}`,
      );

      if (mode === 'baseball') {
        prevMinutesByPlayerIdRef.current = buildMinutesMap(withRatings.playersByTeam);
        const nextSignature = buildImportantSignature(withRatings);

        if (nextSignature !== signatureRef.current || !dataRef.current) {
          signatureRef.current = nextSignature;
          dataRef.current = withRatings;
        }

        if (nextSignature !== displayedSignatureRef.current || !dataRef.current) {
          publishLiveData(withRatings, fetchedAtIso);
        }

        await setCachedLiveGame(gameId, withRatings, mode);
        setIsOffline(false);
        setIsFromCache(false);
        lastSuccessfulPollAtRef.current = Date.now();
        setIsReconnecting(false);

        if (withRatings.status.state === 'post') {
          consecutiveFinalReadsRef.current += 1;
          if (consecutiveFinalReadsRef.current >= FINAL_STATUS_CONFIRMATION_COUNT) {
            setPollingEnabled(false);
          }
        } else {
          consecutiveFinalReadsRef.current = 0;
        }

        if (errorRef.current !== null) {
          errorRef.current = null;
          setError(null);
        }

        setDebug((prev) => {
          const countsChanged =
            JSON.stringify(prev.parsedCounts) !== JSON.stringify(built.parsedCounts);
          return countsChanged ? { ...prev, parsedCounts: built.parsedCounts } : prev;
        });
        return;
      }

      prevMinutesByPlayerIdRef.current = buildMinutesMap(withRatings.playersByTeam);
      const playersOnCourt = Object.values(withRatings.playersByTeam)
        .flat()
        .filter((player) => player.onCourt);
      console.log(
        'LIVE RATINGS',
        playersOnCourt.map((player) => [player.name, player.minutes, player.points, player.liveDisplay]),
      );
      console.log(
        'ON COURT HOME',
        built.onCourtDebug?.home.selected.map((row) => [row.name, row.delta, row.source ?? 'n/a']) ?? [],
      );
      console.log(
        'ON COURT AWAY',
        built.onCourtDebug?.away.selected.map((row) => [row.name, row.delta, row.source ?? 'n/a']) ?? [],
      );
      console.log(
        'DELTA HOME TOP 8',
        built.onCourtDebug?.home.topDeltas.map((row) => [row.name, row.prevMIN, row.curMIN, row.delta]) ?? [],
      );
      console.log(
        'DELTA AWAY TOP 8',
        built.onCourtDebug?.away.topDeltas.map((row) => [row.name, row.prevMIN, row.curMIN, row.delta]) ?? [],
      );
      const nextSignature = buildImportantSignature(withRatings);

      if (nextSignature !== signatureRef.current || !dataRef.current) {
        signatureRef.current = nextSignature;
        dataRef.current = withRatings;
      }

      if (nextSignature !== displayedSignatureRef.current || !dataRef.current) {
        publishLiveData(withRatings, fetchedAtIso);
      }

      await setCachedLiveGame(gameId, withRatings, mode);
      setIsOffline(false);
      setIsFromCache(false);
      lastSuccessfulPollAtRef.current = Date.now();
      setIsReconnecting(false);

      if (withRatings.status.state === 'post') {
        consecutiveFinalReadsRef.current += 1;
        if (consecutiveFinalReadsRef.current >= FINAL_STATUS_CONFIRMATION_COUNT) {
          setPollingEnabled(false);
        }
      } else {
        consecutiveFinalReadsRef.current = 0;
      }

      if (errorRef.current !== null) {
        errorRef.current = null;
        setError(null);
      }

      setDebug((prev) => {
        const countsChanged =
          JSON.stringify(prev.parsedCounts) !== JSON.stringify(built.parsedCounts);
        return countsChanged ? { ...prev, parsedCounts: built.parsedCounts } : prev;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (errorRef.current !== message) {
        errorRef.current = message;
        setError(message);
      }
      setIsOffline(true);
      setIsFromCache(Boolean(dataRef.current));
      const apiBase = getApiBase();
      console.log(`[LiveGame] request failed -> ${apiBase ?? "(no API base configured)"}/${mode}/game/${gameId}/live`);
      console.log(`[LiveGame] Error: ${message}`);
      if (err instanceof Error && err.stack) {
        console.log(err.stack);
      }
    } finally {
      setLoading(false);
    }
  }, [gameId, getApiBase, mode, publishLiveData]);

  useEffect(() => {
    pollingEnabledRef.current = pollingEnabled;
  }, [pollingEnabled]);

  useEffect(() => {
    if (!pollingEnabled) {
      return;
    }

    // `refresh` already wraps its entire body in try/catch/finally and never
    // rejects, but that safety net lives one function away from this call
    // site — catching defensively here too means a poll can NEVER produce
    // an unhandled promise rejection or otherwise stop this interval from
    // firing again, no matter what future changes happen to `refresh`.
    const runPoll = () => {
      if (__DEV__) {
        console.log(`[timing] useLiveGame poll tick start @ ${performance.now().toFixed(1)}ms`);
      }
      refresh()
        .catch((err) => {
          console.log('[LiveGame] Unexpected error escaped refresh():', err);
        })
        .finally(() => {
          if (__DEV__) {
            console.log(`[timing] useLiveGame poll tick end @ ${performance.now().toFixed(1)}ms`);
          }
        });
    };

    runPoll();
    const id = setInterval(runPoll, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [pollingEnabled, refresh]);

  // Staleness watchdog: independent of `pollingEnabled` (so it keeps
  // running even in the scenario it exists to catch — polling believing
  // it's active but no poll actually landing), this checks whether a poll
  // has genuinely completed recently. If not, it surfaces a subtle
  // "reconnecting" signal and kicks an out-of-cycle refresh attempt, rather
  // than the screen silently going stale with zero feedback until the user
  // leaves and re-enters.
  useEffect(() => {
    const id = setInterval(() => {
      // Skip until the very first load has actually landed — a slow cold
      // start is "loading," not "reconnecting," and `dataRef.current` being
      // null is the same signal `refresh()` itself uses to distinguish that.
      if (!pollingEnabledRef.current || !dataRef.current) {
        return;
      }
      const elapsed = Date.now() - lastSuccessfulPollAtRef.current;
      if (elapsed > STALE_POLL_THRESHOLD_MS) {
        setIsReconnecting(true);
        refresh().catch((err) => {
          console.log('[LiveGame] Watchdog retry failed:', err);
        });
      }
    }, WATCHDOG_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const value = useMemo<LiveGameContextValue>(
    () => ({
      loading,
      error,
      isOffline,
      isFromCache,
      isReconnecting,
      gameId,
      mode,
      data,
      lastUpdated,
      syncCalibrationPlays,
      debug,
      refresh,
      setGameId,
      setPollingEnabled,
    }),
    [
      loading,
      error,
      isOffline,
      isFromCache,
      isReconnecting,
      gameId,
      mode,
      data,
      lastUpdated,
      syncCalibrationPlays,
      debug,
      refresh,
      setGameId,
    ],
  );

  return <LiveGameContext.Provider value={value}>{children}</LiveGameContext.Provider>;
}

export function useLiveGame() {
  const context = useContext(LiveGameContext);
  if (!context) {
    throw new Error('useLiveGame must be used inside LiveGameProvider');
  }
  return context;
}
