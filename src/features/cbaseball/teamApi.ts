import { getCachedJson, setCachedJson } from "@/utils/cache";

import type {
  TeamGame,
  TeamGamesPage,
  TeamPlayerStats,
  TeamRatingsTimeline,
  TeamRosterPlayer,
  TeamSearchResult,
  TeamStatRow,
  TeamSummary,
} from "@/src/features/cbb/teamApi";
import type {
  BaseballBattingLine,
  BaseballFieldingLine,
  BaseballPitchingLine,
  BaseballPlayerCardData,
} from "@/src/features/baseball/baseballTypes";
import {
  buildBaseballLeaderboard,
  buildBaseballSeasonProfiles,
} from "@/src/ratings/baseball/BaseballRankingEngine";
import type {
  BaseballLeaderboardOptions,
  BaseballLeaderboardRow,
  BaseballPlayerGameLog,
  BaseballSeasonPlayerProfile,
} from "@/src/ratings/baseball/types";

const ESPN_TEAM_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/teams";
const ESPN_SUMMARY_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/summary";
const DEFAULT_TTL_MS = 1000 * 60 * 5;
const LONG_TTL_MS = 1000 * 60 * 30;
const DIRECTORY_TTL_MS = 1000 * 60 * 60 * 6;
const LEADERBOARD_TTL_MS = 1000 * 60 * 60 * 3;

type EspnTeamResponse = {
  team?: {
    id?: string;
    displayName?: string;
    shortDisplayName?: string;
    abbreviation?: string;
    color?: string;
    standingSummary?: string;
    logos?: Array<{ href?: string; rel?: string[] }>;
    record?: {
      items?: Array<{
        type?: string;
        summary?: string;
      }>;
    };
  };
};

type EspnScheduleCompetitor = {
  homeAway?: "home" | "away";
  winner?: boolean;
  score?: string | { displayValue?: string; value?: number };
  hits?: number;
  errors?: number;
  linescores?: Array<{ displayValue?: string; value?: number }>;
  team?: {
    id?: string;
    displayName?: string;
    shortDisplayName?: string;
    abbreviation?: string;
    logos?: Array<{ href?: string }>;
  };
};

type EspnScheduleEvent = {
  id?: string;
  date?: string;
  seasonType?: { type?: number };
  competitions?: Array<{
    neutralSite?: boolean;
    competitors?: EspnScheduleCompetitor[];
    venue?: { fullName?: string };
    status?: {
      period?: number;
      periodPrefix?: string;
      type?: {
        state?: string;
        description?: string;
        shortDetail?: string;
        completed?: boolean;
      };
    };
  }>;
};

type EspnScheduleResponse = {
  events?: EspnScheduleEvent[];
};

type EspnRosterResponse = {
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

type EspnSummaryResponse = {
  boxscore?: {
    teams?: Array<{
      team?: {
        id?: string;
      };
      statistics?: Array<{
        name?: string;
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
      };
      statistics?: Array<{
        type?: string;
        keys?: string[];
        athletes?: Array<{
          athlete?: {
            id?: string;
            displayName?: string;
            shortName?: string;
            headshot?: {
              href?: string;
            };
          };
          position?: {
            abbreviation?: string;
          };
          stats?: string[];
        }>;
      }>;
    }>;
  };
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
          logos?: Array<{ href?: string }>;
        };
      }>;
    }>;
  }>;
};

type CompletedSummaryBundle = {
  game: TeamGame;
  summary: EspnSummaryResponse;
};

type TeamImpactBundle = {
  profiles: BaseballSeasonPlayerProfile[];
  rows: TeamPlayerStats[];
};

function safeText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && value && "value" in value) {
    return safeNumber((value as { value?: unknown }).value);
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

function parseInningsPitched(value: string | undefined): number {
  const raw = safeText(value);
  if (!raw) {
    return 0;
  }
  const [fullRaw, partRaw] = raw.split(".");
  const full = Number.parseInt(fullRaw ?? "0", 10);
  const part = Number.parseInt(partRaw ?? "0", 10);
  if (!Number.isFinite(full)) {
    return 0;
  }
  return full + (Number.isFinite(part) ? Math.min(part, 2) / 3 : 0);
}

function toDisplayNumber(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function parseScore(value: unknown): number | null {
  return safeNumber(value);
}

async function fetchEspnJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (response.status === 404) {
    return {} as T;
  }
  if (!response.ok) {
    throw new Error(`College Baseball HTTP ${response.status}`);
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

function mapTeamGame(teamId: string, event: EspnScheduleEvent): TeamGame | null {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const teamCompetitor = competitors.find((row) => row.team?.id === teamId);
  const opponentCompetitor = competitors.find((row) => row.team?.id !== teamId);
  const gameId = safeText(event.id);
  const statusState = safeText(competition?.status?.type?.state).toLowerCase();

  if (!competition || !teamCompetitor || !opponentCompetitor || !gameId) {
    return null;
  }

  const location: TeamGame["location"] =
    competition.neutralSite ? "N" : teamCompetitor.homeAway === "away" ? "A" : "H";

  return {
    sport: "baseball",
    gameId,
    date: safeText(event.date, new Date().toISOString()),
    opponentTeamId: safeText(opponentCompetitor.team?.id),
    opponent:
      safeText(opponentCompetitor.team?.displayName) ||
      safeText(opponentCompetitor.team?.shortDisplayName) ||
      "Opponent",
    opponentLogo: safeText(opponentCompetitor.team?.logos?.[0]?.href),
    opponentRank: null,
    location,
    result: statusState === "post" ? (teamCompetitor.winner ? "W" : "L") : "",
    teamScore: parseScore(teamCompetitor.score),
    opponentScore: parseScore(opponentCompetitor.score),
    status:
      safeText(competition.status?.type?.shortDetail) ||
      safeText(competition.status?.type?.description) ||
      "Scheduled",
    completed: statusState === "post",
    competition: event.seasonType?.type === 3 ? "postseason" : "regular",
    ratingBeforeGame: null,
    ratingAfterGame: null,
    ratingDelta: null,
    offenseRating: null,
    defenseRating: null,
    sosAdjustment: null,
    baseball: {
      inningLabel:
        safeText(competition.status?.type?.shortDetail) ||
        safeText(competition.status?.type?.description),
      venue: safeText(competition.venue?.fullName) || null,
      teamHits: safeNumber(teamCompetitor.hits),
      teamErrors: safeNumber(teamCompetitor.errors),
      opponentHits: safeNumber(opponentCompetitor.hits),
      opponentErrors: safeNumber(opponentCompetitor.errors),
      teamLinescores: (teamCompetitor.linescores ?? []).map((line) => safeText(line.displayValue, "0")),
      opponentLinescores: (opponentCompetitor.linescores ?? []).map((line) =>
        safeText(line.displayValue, "0"),
      ),
    },
  };
}

function attachPlaceholderRatings(rows: TeamGame[]): TeamGame[] {
  let runningRating = 5.4;
  return rows.map((row) => {
    const differential =
      typeof row.teamScore === "number" && typeof row.opponentScore === "number"
        ? row.teamScore - row.opponentScore
        : 0;
    const before = runningRating;
    const delta = row.completed
      ? Math.max(-1.25, Math.min(1.25, differential * 0.09 + (row.result === "W" ? 0.28 : -0.28)))
      : 0;
    runningRating = Math.max(0, Math.min(10, runningRating + delta));
    return {
      ...row,
      ratingBeforeGame: Number(before.toFixed(2)),
      ratingAfterGame: row.completed ? Number(runningRating.toFixed(2)) : null,
      ratingDelta: row.completed ? Number(delta.toFixed(2)) : null,
    };
  });
}

async function getScheduleRows(teamId: string, season: number): Promise<TeamGame[]> {
  return cached(`college-baseball:schedule:${teamId}:${season}`, DEFAULT_TTL_MS, async () => {
    const payload = await fetchEspnJson<EspnScheduleResponse>(`${ESPN_TEAM_BASE}/${teamId}/schedule`);
    const rows = (payload.events ?? [])
      .map((event) => mapTeamGame(teamId, event))
      .filter((row): row is TeamGame => Boolean(row))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return attachPlaceholderRatings(rows);
  });
}

async function getCompletedSummaryBundles(
  teamId: string,
  season: number,
): Promise<CompletedSummaryBundle[]> {
  const schedule = await getScheduleRows(teamId, season);
  const completed = schedule.filter((row) => row.completed);
  const summaries = await Promise.all(
    completed.map((row) =>
      cached(`college-baseball:summary:${row.gameId}`, LONG_TTL_MS, () =>
        fetchEspnJson<EspnSummaryResponse>(`${ESPN_SUMMARY_BASE}?event=${encodeURIComponent(row.gameId)}`),
      ),
    ),
  );
  return completed.map((game, index) => ({
    game,
    summary: summaries[index] ?? {},
  }));
}

function getStatIndex(keys: string[] | undefined, names: string[]): number {
  return (keys ?? []).findIndex((key) => names.includes(key));
}

function getDisplayStat(
  stats: string[] | undefined,
  keys: string[] | undefined,
  names: string[],
): string | undefined {
  const index = getStatIndex(keys, names);
  return index >= 0 ? stats?.[index] : undefined;
}

function parseBattingLine(stats: string[] | undefined, keys: string[] | undefined): BaseballBattingLine | null {
  if (!stats || !keys?.length) {
    return null;
  }

  const atBats = safeNumber(getDisplayStat(stats, keys, ["atBats", "AB"])) ?? 0;
  const hits = safeNumber(getDisplayStat(stats, keys, ["hits", "H"])) ?? 0;
  const walks = safeNumber(getDisplayStat(stats, keys, ["walks", "BB"])) ?? 0;
  const hitByPitch = safeNumber(getDisplayStat(stats, keys, ["hitByPitch", "HBP"])) ?? 0;
  const sacrificeFlies = safeNumber(getDisplayStat(stats, keys, ["sacrificeFlies", "SF"])) ?? 0;
  const plateAppearances =
    safeNumber(getDisplayStat(stats, keys, ["plateAppearances", "PA"])) ??
    atBats + walks + hitByPitch + sacrificeFlies;

  const battingAverage = atBats > 0 ? hits / atBats : null;
  const onBasePct =
    plateAppearances > 0 ? (hits + walks + hitByPitch) / plateAppearances : null;
  const totalBases =
    hits +
    (safeNumber(getDisplayStat(stats, keys, ["doubles", "2B"])) ?? 0) +
    (safeNumber(getDisplayStat(stats, keys, ["triples", "3B"])) ?? 0) * 2 +
    (safeNumber(getDisplayStat(stats, keys, ["homeRuns", "HR"])) ?? 0) * 3;
  const sluggingPct = atBats > 0 ? totalBases / atBats : null;

  return {
    atBats,
    runs: safeNumber(getDisplayStat(stats, keys, ["runs", "R"])) ?? 0,
    hits,
    runsBattedIn: safeNumber(getDisplayStat(stats, keys, ["RBIs", "RBI", "rbi"])) ?? 0,
    homeRuns: safeNumber(getDisplayStat(stats, keys, ["homeRuns", "HR"])) ?? 0,
    walks,
    strikeouts: safeNumber(getDisplayStat(stats, keys, ["strikeouts", "SO", "K"])) ?? 0,
    doubles: safeNumber(getDisplayStat(stats, keys, ["doubles", "2B"])) ?? 0,
    triples: safeNumber(getDisplayStat(stats, keys, ["triples", "3B"])) ?? 0,
    stolenBases: safeNumber(getDisplayStat(stats, keys, ["stolenBases", "SB"])) ?? 0,
    caughtStealing: safeNumber(getDisplayStat(stats, keys, ["caughtStealing", "CS"])) ?? 0,
    hitByPitch,
    sacrificeFlies,
    plateAppearances,
    battingAverage,
    onBasePct,
    sluggingPct,
    ops:
      safeNumber(getDisplayStat(stats, keys, ["OPS", "ops"])) ??
      (onBasePct !== null && sluggingPct !== null ? onBasePct + sluggingPct : null),
  };
}

function parsePitchingLine(
  stats: string[] | undefined,
  keys: string[] | undefined,
): BaseballPitchingLine | null {
  if (!stats || !keys?.length) {
    return null;
  }

  const inningsPitched =
    parseInningsPitched(
      getDisplayStat(stats, keys, ["fullInnings.partInnings", "inningsPitched", "IP"]),
    ) || 0;
  const pitchStrikeText = safeText(
    getDisplayStat(stats, keys, ["pitches-strikes", "pit-str"]),
  );
  const strikeParts = pitchStrikeText.split("-");
  const strikes = strikeParts.length === 2 ? safeNumber(strikeParts[1]) ?? 0 : 0;
  const hitsAllowed = safeNumber(getDisplayStat(stats, keys, ["hits", "H"])) ?? 0;
  const runsAllowed = safeNumber(getDisplayStat(stats, keys, ["runs", "R"])) ?? 0;
  const earnedRuns = safeNumber(getDisplayStat(stats, keys, ["earnedRuns", "ER"])) ?? 0;
  const walks = safeNumber(getDisplayStat(stats, keys, ["walks", "BB"])) ?? 0;

  return {
    inningsPitched,
    hitsAllowed,
    runsAllowed,
    earnedRuns,
    walks,
    strikeouts: safeNumber(getDisplayStat(stats, keys, ["strikeouts", "SO", "K"])) ?? 0,
    homeRunsAllowed: safeNumber(getDisplayStat(stats, keys, ["homeRuns", "HR"])) ?? 0,
    pitches: safeNumber(getDisplayStat(stats, keys, ["pitches", "pit"])) ?? 0,
    strikes,
    hitBatters:
      safeNumber(getDisplayStat(stats, keys, ["hitBatters", "battersHit", "HBP"])) ?? 0,
    appearances: safeNumber(getDisplayStat(stats, keys, ["appearances", "APP"])) ?? 1,
    gamesStarted: safeNumber(getDisplayStat(stats, keys, ["gamesStarted", "GS"])) ?? 0,
    era:
      safeNumber(getDisplayStat(stats, keys, ["ERA", "era"])) ??
      (inningsPitched > 0 ? (earnedRuns * 9) / inningsPitched : null),
    whip:
      safeNumber(getDisplayStat(stats, keys, ["WHIP", "whip"])) ??
      (inningsPitched > 0 ? (walks + hitsAllowed) / inningsPitched : null),
  };
}

function parseFieldingLine(
  stats: string[] | undefined,
  keys: string[] | undefined,
): BaseballFieldingLine | null {
  if (!stats || !keys?.length) {
    return null;
  }

  const putouts = safeNumber(getDisplayStat(stats, keys, ["putouts", "PO"])) ?? 0;
  const assists = safeNumber(getDisplayStat(stats, keys, ["assists", "A"])) ?? 0;
  const errors = safeNumber(getDisplayStat(stats, keys, ["errors", "E"])) ?? 0;

  return {
    putouts,
    assists,
    errors,
    doublePlays: safeNumber(getDisplayStat(stats, keys, ["doublePlays", "DP"])) ?? 0,
    passedBalls: safeNumber(getDisplayStat(stats, keys, ["passedBalls", "PB"])) ?? 0,
    caughtStealing:
      safeNumber(getDisplayStat(stats, keys, ["caughtStealing", "CS", "caughtStealingAgainst"])) ?? 0,
    fieldingPct:
      safeNumber(getDisplayStat(stats, keys, ["fieldingPct", "FPCT"])) ??
      (putouts + assists + errors > 0 ? (putouts + assists) / (putouts + assists + errors) : null),
  };
}

function sumBattingLines(lines: Array<BaseballBattingLine | null | undefined>): BaseballBattingLine | null {
  const valid = lines.filter((line): line is BaseballBattingLine => Boolean(line));
  if (valid.length === 0) {
    return null;
  }

  const totals = valid.reduce<BaseballBattingLine>(
    (acc, line) => ({
      atBats: acc.atBats + line.atBats,
      runs: acc.runs + line.runs,
      hits: acc.hits + line.hits,
      runsBattedIn: acc.runsBattedIn + line.runsBattedIn,
      homeRuns: acc.homeRuns + line.homeRuns,
      walks: acc.walks + line.walks,
      strikeouts: acc.strikeouts + line.strikeouts,
      doubles: acc.doubles + line.doubles,
      triples: acc.triples + line.triples,
      stolenBases: acc.stolenBases + line.stolenBases,
      caughtStealing: (acc.caughtStealing ?? 0) + (line.caughtStealing ?? 0),
      hitByPitch: (acc.hitByPitch ?? 0) + (line.hitByPitch ?? 0),
      sacrificeFlies: (acc.sacrificeFlies ?? 0) + (line.sacrificeFlies ?? 0),
      plateAppearances: (acc.plateAppearances ?? 0) + (line.plateAppearances ?? 0),
      battingAverage: null,
      onBasePct: null,
      sluggingPct: null,
      ops: null,
    }),
    {
      atBats: 0,
      runs: 0,
      hits: 0,
      runsBattedIn: 0,
      homeRuns: 0,
      walks: 0,
      strikeouts: 0,
      doubles: 0,
      triples: 0,
      stolenBases: 0,
      caughtStealing: 0,
      hitByPitch: 0,
      sacrificeFlies: 0,
      plateAppearances: 0,
      battingAverage: null,
      onBasePct: null,
      sluggingPct: null,
      ops: null,
    },
  );

  totals.battingAverage = totals.atBats > 0 ? totals.hits / totals.atBats : null;
  totals.onBasePct =
    (totals.plateAppearances ?? 0) > 0
      ? (totals.hits + totals.walks + (totals.hitByPitch ?? 0)) / Math.max(1, totals.plateAppearances ?? 0)
      : null;
  totals.sluggingPct =
    totals.atBats > 0
      ? (totals.hits + totals.doubles + totals.triples * 2 + totals.homeRuns * 3) / totals.atBats
      : null;
  totals.ops =
    totals.onBasePct !== null && totals.sluggingPct !== null
      ? totals.onBasePct + totals.sluggingPct
      : null;

  return totals;
}

function sumPitchingLines(
  lines: Array<BaseballPitchingLine | null | undefined>,
): BaseballPitchingLine | null {
  const valid = lines.filter((line): line is BaseballPitchingLine => Boolean(line));
  if (valid.length === 0) {
    return null;
  }

  const totals = valid.reduce<BaseballPitchingLine>(
    (acc, line) => ({
      inningsPitched: acc.inningsPitched + line.inningsPitched,
      hitsAllowed: acc.hitsAllowed + line.hitsAllowed,
      runsAllowed: acc.runsAllowed + line.runsAllowed,
      earnedRuns: acc.earnedRuns + line.earnedRuns,
      walks: acc.walks + line.walks,
      strikeouts: acc.strikeouts + line.strikeouts,
      homeRunsAllowed: acc.homeRunsAllowed + line.homeRunsAllowed,
      pitches: acc.pitches + line.pitches,
      strikes: acc.strikes + line.strikes,
      hitBatters: (acc.hitBatters ?? 0) + (line.hitBatters ?? 0),
      appearances: (acc.appearances ?? 0) + (line.appearances ?? 0),
      gamesStarted: (acc.gamesStarted ?? 0) + (line.gamesStarted ?? 0),
      era: null,
      whip: null,
    }),
    {
      inningsPitched: 0,
      hitsAllowed: 0,
      runsAllowed: 0,
      earnedRuns: 0,
      walks: 0,
      strikeouts: 0,
      homeRunsAllowed: 0,
      pitches: 0,
      strikes: 0,
      hitBatters: 0,
      appearances: 0,
      gamesStarted: 0,
      era: null,
      whip: null,
    },
  );

  totals.era = totals.inningsPitched > 0 ? (totals.earnedRuns * 9) / totals.inningsPitched : null;
  totals.whip =
    totals.inningsPitched > 0 ? (totals.walks + totals.hitsAllowed) / totals.inningsPitched : null;
  return totals;
}

function sumFieldingLines(
  lines: Array<BaseballFieldingLine | null | undefined>,
): BaseballFieldingLine | null {
  const valid = lines.filter((line): line is BaseballFieldingLine => Boolean(line));
  if (valid.length === 0) {
    return null;
  }

  const totals = valid.reduce<BaseballFieldingLine>(
    (acc, line) => ({
      putouts: acc.putouts + line.putouts,
      assists: acc.assists + line.assists,
      errors: acc.errors + line.errors,
      doublePlays: (acc.doublePlays ?? 0) + (line.doublePlays ?? 0),
      passedBalls: (acc.passedBalls ?? 0) + (line.passedBalls ?? 0),
      caughtStealing: (acc.caughtStealing ?? 0) + (line.caughtStealing ?? 0),
      fieldingPct: null,
    }),
    {
      putouts: 0,
      assists: 0,
      errors: 0,
      doublePlays: 0,
      passedBalls: 0,
      caughtStealing: 0,
      fieldingPct: null,
    },
  );

  totals.fieldingPct =
    totals.putouts + totals.assists + totals.errors > 0
      ? (totals.putouts + totals.assists) / (totals.putouts + totals.assists + totals.errors)
      : null;
  return totals;
}

function createPlayerCardData(
  batting: BaseballBattingLine | null,
  pitching: BaseballPitchingLine | null,
  fielding: BaseballFieldingLine | null,
  profile?: BaseballSeasonPlayerProfile | null,
): BaseballPlayerCardData {
  const role =
    batting && pitching ? "two-way" : pitching ? "pitcher" : batting ? "batter" : "unknown";

  return {
    role,
    batting,
    pitching,
    fielding,
    primaryLine:
      role === "pitcher" || role === "two-way"
        ? `IP ${toDisplayNumber(pitching?.inningsPitched, 1)} • K ${pitching?.strikeouts ?? 0} • ER ${pitching?.earnedRuns ?? 0}`
        : `${batting?.hits ?? 0}-${batting?.atBats ?? 0} • RBI ${batting?.runsBattedIn ?? 0} • HR ${batting?.homeRuns ?? 0}`,
    secondaryLine:
      role === "pitcher" || role === "two-way"
        ? `ERA ${toDisplayNumber(pitching?.era, 2)} • WHIP ${toDisplayNumber(pitching?.whip, 2)}`
        : `AVG ${toDisplayNumber(batting?.battingAverage, 3)} • OPS ${toDisplayNumber(batting?.ops, 3)}`,
    impactRating: profile?.output.overallRating ?? null,
    seasonAverageRating: profile?.seasonAverageRating ?? null,
    impactShare: profile?.output.impactShare ?? null,
    confidence: profile?.output.confidence ?? null,
    impactRole: profile?.output.role ?? null,
    trendDelta: profile?.trendDelta ?? null,
    breakdown: profile?.output.breakdown ?? [],
  };
}

function buildGameLogsFromBundles(
  teamId: string,
  teamName: string,
  bundles: CompletedSummaryBundle[],
): BaseballPlayerGameLog[] {
  const output: BaseballPlayerGameLog[] = [];

  bundles.forEach(({ game, summary }) => {
    const section = summary.boxscore?.players?.find((row) => row.team?.id === teamId);
    const playerMap = new Map<
      string,
      {
        playerId: string;
        playerName: string;
        position: string;
        batting: BaseballBattingLine | null;
        pitching: BaseballPitchingLine | null;
        fielding: BaseballFieldingLine | null;
      }
    >();

    (section?.statistics ?? []).forEach((table) => {
      const tableType = safeText(table.type).toLowerCase();
      (table.athletes ?? []).forEach((row) => {
        const playerId = safeText(row.athlete?.id);
        if (!playerId) {
          return;
        }
        const current =
          playerMap.get(playerId) ??
          {
            playerId,
            playerName: safeText(row.athlete?.displayName, "Player"),
            position: safeText(row.position?.abbreviation, tableType === "pitching" ? "P" : "DH"),
            batting: null,
            pitching: null,
            fielding: null,
          };

        if (tableType === "batting") {
          current.batting = parseBattingLine(row.stats, table.keys);
        } else if (tableType === "pitching") {
          current.pitching = parsePitchingLine(row.stats, table.keys);
        } else if (tableType === "fielding") {
          current.fielding = parseFieldingLine(row.stats, table.keys);
        }

        playerMap.set(playerId, current);
      });
    });

    playerMap.forEach((player) => {
      output.push({
        playerId: player.playerId,
        playerName: player.playerName,
        teamId,
        teamName,
        position: player.position,
        batting: player.batting,
        pitching: player.pitching,
        fielding: player.fielding,
        game: {
          gameId: game.gameId,
          date: game.date,
          opponent: game.opponent,
          opponentTeamId: game.opponentTeamId || null,
          teamRuns: game.teamScore,
          opponentRuns: game.opponentScore,
          finalMargin:
            typeof game.teamScore === "number" && typeof game.opponentScore === "number"
              ? game.teamScore - game.opponentScore
              : null,
          isCloseGame:
            typeof game.teamScore === "number" && typeof game.opponentScore === "number"
              ? Math.abs(game.teamScore - game.opponentScore) <= 2
              : null,
          leverageKnown:
            typeof game.teamScore === "number" && typeof game.opponentScore === "number",
          starterHint:
            (player.pitching?.gamesStarted ?? 0) > 0 ||
            (player.pitching?.inningsPitched ?? 0) >= 3,
        },
      });
    });
  });

  return output;
}

function emptyPlayerRow(player: TeamRosterPlayer): TeamPlayerStats {
  return {
    ...player,
    sport: "baseball",
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
    confidence: null,
    trendDelta: null,
    impactShare: null,
    ratingTimelinePoints: [],
    baseball: {
      role: "unknown",
      batting: null,
      pitching: null,
      fielding: null,
      primaryLine: "No season box scores yet",
      secondaryLine: "Impact rating available after first appearance",
      impactRating: null,
      seasonAverageRating: null,
      impactShare: null,
      confidence: null,
      impactRole: null,
      trendDelta: null,
      breakdown: [],
    },
    baseballImpact: null,
  };
}

function mapProfileToTeamRow(
  basePlayer: TeamRosterPlayer | undefined,
  profile: BaseballSeasonPlayerProfile,
): TeamPlayerStats {
  const battingTotals = sumBattingLines(profile.games.map((game) => game.batting));
  const pitchingTotals = sumPitchingLines(profile.games.map((game) => game.pitching));
  const fieldingTotals = sumFieldingLines(profile.games.map((game) => game.fielding));
  const cardData = createPlayerCardData(battingTotals, pitchingTotals, fieldingTotals, profile);
  const games = Math.max(1, profile.gamesPlayed);

  return {
    playerId: profile.playerId,
    name: basePlayer?.name ?? profile.playerName,
    shortName: basePlayer?.shortName ?? profile.playerName,
    jersey: basePlayer?.jersey ?? "-",
    position: basePlayer?.position ?? profile.position,
    headshot: basePlayer?.headshot ?? "",
    sport: "baseball",
    games: profile.gamesPlayed,
    minutes: profile.totalInningsPitched,
    points: battingTotals?.runs ?? 0,
    rebounds: battingTotals?.hits ?? 0,
    assists: battingTotals?.runsBattedIn ?? 0,
    steals: battingTotals?.stolenBases ?? 0,
    blocks: pitchingTotals?.strikeouts ?? 0,
    turnovers: battingTotals?.strikeouts ?? 0,
    fgm: battingTotals?.hits ?? 0,
    fga: battingTotals?.atBats ?? 0,
    tpm: battingTotals?.homeRuns ?? 0,
    tpa: battingTotals?.atBats ?? 0,
    ftm: pitchingTotals?.strikes ?? 0,
    fta: pitchingTotals?.pitches ?? 0,
    perGame: {
      minutes: profile.totalInningsPitched / games,
      points: (battingTotals?.runs ?? 0) / games,
      rebounds: (battingTotals?.hits ?? 0) / games,
      assists: (battingTotals?.runsBattedIn ?? 0) / games,
      steals: (battingTotals?.stolenBases ?? 0) / games,
      blocks: (pitchingTotals?.strikeouts ?? 0) / games,
      turnovers: (battingTotals?.strikeouts ?? 0) / games,
    },
    efficiency: profile.latestRating ?? profile.output.overallRating,
    usage:
      profile.role === "HITTER"
        ? profile.totalPlateAppearances / games
        : profile.totalInningsPitched / games,
    onOff: null,
    ratingImpact: profile.latestRating,
    seasonRating10: profile.output.overallRating,
    confidence: profile.output.confidence,
    trendDelta: profile.trendDelta,
    impactShare: profile.output.impactShare,
    ratingTimelinePoints: profile.games.map((game, index) => ({
      tSec: index * 60,
      rating: game.output.overallRating,
    })),
    baseball: cardData,
    baseballImpact: profile.output,
  };
}

async function getTeamImpactBundle(teamId: string, season: number): Promise<TeamImpactBundle> {
  return cached(`college-baseball:impact:team:${teamId}:${season}`, LONG_TTL_MS, async () => {
    const [summary, roster, bundles] = await Promise.all([
      cached(`college-baseball:team:${teamId}`, LONG_TTL_MS, () =>
        fetchEspnJson<EspnTeamResponse>(`${ESPN_TEAM_BASE}/${teamId}`),
      ),
      getCollegeBaseballRoster(teamId, season),
      getCompletedSummaryBundles(teamId, season),
    ]);

    const teamName = safeText(summary.team?.displayName, "College Baseball Team");
    const profiles = buildBaseballSeasonProfiles(buildGameLogsFromBundles(teamId, teamName, bundles));
    const rosterMap = new Map(roster.map((player) => [player.playerId, player] as const));
    const rows = profiles.map((profile) =>
      mapProfileToTeamRow(rosterMap.get(profile.playerId), profile),
    );

    roster.forEach((player) => {
      if (!rows.find((row) => row.playerId === player.playerId)) {
        rows.push(emptyPlayerRow(player));
      }
    });

    rows.sort((left, right) => {
      const leftRating = typeof left.seasonRating10 === "number" ? left.seasonRating10 : -1;
      const rightRating = typeof right.seasonRating10 === "number" ? right.seasonRating10 : -1;
      if (leftRating !== rightRating) {
        return rightRating - leftRating;
      }
      return left.name.localeCompare(right.name);
    });

    return { profiles, rows };
  });
}

function computeAverage(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function consume(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () =>
    consume(),
  );
  await Promise.all(workers);
  return results;
}

async function fetchDirectoryPage(page: number, limit = 200): Promise<TeamSearchResult[]> {
  const payload = await fetchEspnJson<EspnTeamsDirectoryResponse>(`${ESPN_TEAM_BASE}?limit=${limit}&page=${page}`);
  const teams = payload.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return teams
    .map<TeamSearchResult | null>((entry) => {
      const team = entry.team;
      const teamId = safeText(team?.id);
      if (!teamId) {
        return null;
      }
      return {
        teamId,
        name: safeText(team?.displayName, "Team"),
        shortName: safeText(team?.shortDisplayName, safeText(team?.displayName, "Team")),
        abbreviation: safeText(team?.abbreviation),
        logo: safeText(team?.logos?.[0]?.href) || null,
        conference: null as string | null,
      };
    })
    .filter((row): row is TeamSearchResult => row !== null);
}

async function getDirectory(): Promise<TeamSearchResult[]> {
  return cached("college-baseball:team-directory", DIRECTORY_TTL_MS, async () => {
    const allRows: TeamSearchResult[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const rows = await fetchDirectoryPage(page);
      allRows.push(...rows);
      if (rows.length < 200) {
        break;
      }
    }
    return allRows;
  });
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function scoreSearch(row: TeamSearchResult, query: string): number {
  const fields = [row.name, row.shortName, row.abbreviation]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  if (fields.includes(query)) return 100;
  if (fields.some((value) => value.startsWith(query))) return 75;
  if (fields.some((value) => value.includes(query))) return 50;
  return 0;
}

export async function getCollegeBaseballTeamDirectory(): Promise<TeamSearchResult[]> {
  return getDirectory();
}

export async function getCollegeBaseballSummary(teamId: string, season: number): Promise<TeamSummary> {
  const [team, schedule] = await Promise.all([
    cached(`college-baseball:team:${teamId}`, LONG_TTL_MS, () =>
      fetchEspnJson<EspnTeamResponse>(`${ESPN_TEAM_BASE}/${teamId}`),
    ),
    getScheduleRows(teamId, season),
  ]);
  const completed = schedule.filter((row) => row.completed && typeof row.ratingAfterGame === "number");
  const trendLast5 = completed.slice(-5).map((row) => row.ratingDelta ?? 0);
  const record =
    team.team?.record?.items?.find((item) => item.type === "total")?.summary ||
    team.team?.standingSummary ||
    "-";

  return {
    sport: "baseball",
    teamId,
    name: safeText(team.team?.displayName, "College Baseball Team"),
    shortName: safeText(team.team?.shortDisplayName, safeText(team.team?.displayName, "Team")),
    logo: pickLogo(team.team?.logos),
    record,
    conference: safeText(team.team?.standingSummary, "College Baseball"),
    ranking: null,
    color: safeText(team.team?.color) || null,
    alternateColor: null,
    dynamicRating: {
      current: completed[completed.length - 1]?.ratingAfterGame ?? null,
      trendLast5:
        trendLast5.length > 0
          ? Number((trendLast5.reduce((sum, value) => sum + value, 0) / trendLast5.length).toFixed(2))
          : null,
    },
    availableFilters: {
      hasTop25Games: false,
    },
    baseball: {
      standingSummary: safeText(team.team?.standingSummary) || null,
    },
  };
}

export async function getCollegeBaseballGames(
  teamId: string,
  season: number,
  page: number,
  pageSize = 20,
  competition = "all",
  search = "",
): Promise<TeamGamesPage> {
  const rows = await getScheduleRows(teamId, season);
  const filtered = rows.filter((row) => {
    if (competition === "regular" && row.competition !== "regular") {
      return false;
    }
    if (competition === "postseason" && row.competition !== "postseason") {
      return false;
    }
    if (search.trim().length > 0 && !row.opponent.toLowerCase().includes(search.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  const start = page * pageSize;
  return {
    rows: filtered.slice(start, start + pageSize),
    page,
    hasMore: start + pageSize < filtered.length,
    total: filtered.length,
  };
}

export async function getCollegeBaseballRoster(
  teamId: string,
  _season: number,
): Promise<TeamRosterPlayer[]> {
  return cached(`college-baseball:roster:${teamId}`, LONG_TTL_MS, async () => {
    const payload = await fetchEspnJson<EspnRosterResponse>(`${ESPN_TEAM_BASE}/${teamId}/roster`);
    return (payload.athletes ?? []).map((athlete) => ({
      playerId: safeText(athlete.id),
      name: safeText(athlete.displayName, "Player"),
      shortName: safeText(athlete.shortName, safeText(athlete.displayName, "Player")),
      jersey: safeText(athlete.jersey, "-"),
      position: safeText(athlete.position?.abbreviation, "UN"),
      headshot: safeText(athlete.headshot?.href),
    }));
  });
}

export async function getCollegeBaseballPlayerImpactProfiles(
  teamId: string,
  season: number,
): Promise<BaseballSeasonPlayerProfile[]> {
  const bundle = await getTeamImpactBundle(teamId, season);
  return bundle.profiles;
}

export async function getCollegeBaseballPlayerImpactProfile(
  playerId: string,
  teamId: string,
  season: number,
): Promise<BaseballSeasonPlayerProfile | null> {
  const profiles = await getCollegeBaseballPlayerImpactProfiles(teamId, season);
  return profiles.find((profile) => profile.playerId === playerId) ?? null;
}

export async function getCollegeBaseballPlayerStats(
  teamId: string,
  season: number,
): Promise<TeamPlayerStats[]> {
  const bundle = await getTeamImpactBundle(teamId, season);
  return bundle.rows;
}

export async function getCollegeBaseballRatingsTimeline(
  teamId: string,
  season: number,
): Promise<TeamRatingsTimeline> {
  const rows = await getScheduleRows(teamId, season);
  return {
    formula: "Team trend is based on result swing and run differential; player impact rankings are computed separately from game logs.",
    points: rows.filter((row) => row.completed),
  };
}

export async function getCollegeBaseballStats(
  teamId: string,
  season: number,
): Promise<TeamStatRow[]> {
  const bundles = await getCompletedSummaryBundles(teamId, season);
  const average = (rows: number[]) =>
    rows.length > 0 ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;

  const aggregateValues = bundles.reduce(
    (result, bundle) => {
      const teamRow = bundle.summary.boxscore?.teams?.find((row) => row.team?.id === teamId);
      const batting = teamRow?.statistics?.find((row) => row.name === "batting")?.stats ?? [];
      const pitching = teamRow?.statistics?.find((row) => row.name === "pitching")?.stats ?? [];
      const fielding = teamRow?.statistics?.find((row) => row.name === "fielding")?.stats ?? [];
      const getValue = (
        rows: Array<{ name?: string; displayValue?: string; value?: number }>,
        names: string[],
      ) => rows.find((row) => names.includes(safeText(row.name)))?.value ?? null;

      result.avg.push(getValue(batting, ["avg", "battingAverage"]) ?? 0);
      result.obp.push(getValue(batting, ["onBasePct", "OBP"]) ?? 0);
      result.slg.push(getValue(batting, ["slugAvg", "SLG"]) ?? 0);
      result.runs.push(getValue(batting, ["runs", "R"]) ?? 0);
      result.hits.push(getValue(batting, ["hits", "H"]) ?? 0);
      result.errors.push(getValue(fielding, ["errors", "E"]) ?? 0);
      result.era.push(getValue(pitching, ["ERA", "era"]) ?? 0);
      result.whip.push(getValue(pitching, ["WHIP", "whip"]) ?? 0);
      result.strikeouts.push(getValue(pitching, ["strikeouts", "K", "SO"]) ?? 0);
      return result;
    },
    {
      avg: [] as number[],
      obp: [] as number[],
      slg: [] as number[],
      runs: [] as number[],
      hits: [] as number[],
      errors: [] as number[],
      era: [] as number[],
      whip: [] as number[],
      strikeouts: [] as number[],
    },
  );

  return [
    { key: "avg", label: "Batting AVG", value: average(aggregateValues.avg), displayValue: toDisplayNumber(average(aggregateValues.avg), 3), leagueAverage: null, conferenceAverage: null },
    { key: "obp", label: "On-Base %", value: average(aggregateValues.obp), displayValue: toDisplayNumber(average(aggregateValues.obp), 3), leagueAverage: null, conferenceAverage: null },
    { key: "slg", label: "Slugging %", value: average(aggregateValues.slg), displayValue: toDisplayNumber(average(aggregateValues.slg), 3), leagueAverage: null, conferenceAverage: null },
    { key: "runs", label: "Runs / Game", value: average(aggregateValues.runs), displayValue: toDisplayNumber(average(aggregateValues.runs), 1), leagueAverage: null, conferenceAverage: null },
    { key: "hits", label: "Hits / Game", value: average(aggregateValues.hits), displayValue: toDisplayNumber(average(aggregateValues.hits), 1), leagueAverage: null, conferenceAverage: null },
    { key: "errors", label: "Errors / Game", value: average(aggregateValues.errors), displayValue: toDisplayNumber(average(aggregateValues.errors), 1), leagueAverage: null, conferenceAverage: null },
    { key: "era", label: "Team ERA", value: average(aggregateValues.era), displayValue: toDisplayNumber(average(aggregateValues.era), 2), leagueAverage: null, conferenceAverage: null },
    { key: "whip", label: "Team WHIP", value: average(aggregateValues.whip), displayValue: toDisplayNumber(average(aggregateValues.whip), 2), leagueAverage: null, conferenceAverage: null },
    { key: "k", label: "Pitching K / Game", value: average(aggregateValues.strikeouts), displayValue: toDisplayNumber(average(aggregateValues.strikeouts), 1), leagueAverage: null, conferenceAverage: null },
  ];
}

export async function getCollegeBaseballLeagueImpactProfiles(
  season: number,
): Promise<BaseballSeasonPlayerProfile[]> {
  return cached(`college-baseball:impact:league:${season}`, LEADERBOARD_TTL_MS, async () => {
    const teams = [...new Map((await getDirectory()).map((team) => [team.teamId, team] as const)).values()];
    const teamProfiles = await mapWithConcurrency(teams, 6, async (team) => {
      try {
        return await getCollegeBaseballPlayerImpactProfiles(team.teamId, season);
      } catch {
        return [] as BaseballSeasonPlayerProfile[];
      }
    });
    return teamProfiles.flat();
  });
}

export async function getCollegeBaseballLeaderboard(
  season: number,
  options?: BaseballLeaderboardOptions,
): Promise<BaseballLeaderboardRow[]> {
  if (options?.teamId && (options.scope === "TEAM_LEADERS" || !options.scope)) {
    const profiles = await getCollegeBaseballPlayerImpactProfiles(options.teamId, season);
    return buildBaseballLeaderboard(profiles, options);
  }

  const profiles = await getCollegeBaseballLeagueImpactProfiles(season);
  return buildBaseballLeaderboard(profiles, options);
}

export async function searchCollegeBaseballTeams(
  query: string,
  limit = 20,
): Promise<TeamSearchResult[]> {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [];
  }
  const directory = await getDirectory();
  return directory
    .map((row) => ({ row, score: scoreSearch(row, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
    .slice(0, limit)
    .map((entry) => entry.row);
}
