import { apiFetch, getApiUrl } from "@/src/config/api";
import type { BaseballBaseOccupancy, BaseballGameSituation } from "@/src/features/baseball/baseballTypes";
import type { GameComment, LiveGameListItem } from "@/src/features/cbb/api";
import { COLLEGE_BASKETBALL_CONFERENCES } from "@/src/conferences/conferenceCatalog";

const COLLEGE_BASEBALL_SCOREBOARD_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard";
const COLLEGE_BASEBALL_SUMMARY_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/summary";
const COLLEGE_BASEBALL_TEAMS_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/teams";
const TEAM_CONFERENCE_CACHE_TTL_MS = 1000 * 60 * 60 * 6;

type EspnBaseballCompetitor = {
  homeAway?: "home" | "away";
  score?: string | { displayValue?: string; value?: number };
  hits?: number;
  errors?: number;
  records?: Array<{
    type?: string;
    summary?: string;
    displayValue?: string;
  }>;
  team?: {
    id?: string;
    displayName?: string;
    shortDisplayName?: string;
    abbreviation?: string;
    logo?: string;
    logos?: Array<{ href?: string }>;
  };
};

type EspnBaseballTeamResponse = {
  team?: {
    id?: string;
    standingSummary?: string;
    groups?: {
      id?: string;
      name?: string;
      shortName?: string;
    };
  };
};

type EspnBaseballScoreboardEvent = {
  id?: string;
  status?: {
    period?: number;
    displayClock?: string;
    periodPrefix?: string;
    type?: {
      state?: string;
      shortDetail?: string;
      detail?: string;
      description?: string;
      completed?: boolean;
    };
  };
  competitions?: Array<{
    venue?: { fullName?: string };
    groups?: {
      id?: string;
      name?: string;
      shortName?: string;
      isConference?: boolean;
    };
    status?: {
      period?: number;
      displayClock?: string;
      periodPrefix?: string;
      type?: {
        state?: string;
        shortDetail?: string;
        detail?: string;
        description?: string;
        completed?: boolean;
      };
    };
    competitors?: EspnBaseballCompetitor[];
  }>;
};

type EspnBaseballScoreboardResponse = {
  events?: EspnBaseballScoreboardEvent[];
};

type SafeFetchResult<T> =
  | {
      ok: true;
      status: number;
      data: T;
      error?: undefined;
    }
  | {
      ok: false;
      status: number | "network_error";
      data: null;
      error?: string;
    };

export type CollegeBaseballLivePayloadResult =
  | {
      status: "ok";
      data: unknown;
    }
  | {
      status: "empty";
      events: [];
    }
  | {
      status: "error";
      events: [];
      code: number | "network_error";
      error?: string;
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

function getScore(value: EspnBaseballCompetitor["score"]): string {
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
  return "0";
}

function normalizeHalfInning(prefix: string | undefined, state: string | undefined): BaseballGameSituation["half"] {
  const normalized = safeText(prefix).toLowerCase();
  if (normalized.startsWith("top")) return "top";
  if (normalized.startsWith("bottom")) return "bottom";
  if (normalized.startsWith("middle")) return "middle";
  if (normalized.startsWith("end")) return "end";
  const normalizedState = safeText(state).toLowerCase();
  if (normalizedState === "pre") return "pregame";
  if (normalizedState === "post") return "final";
  return "unknown";
}

function createBaseballSituation(
  status:
    | {
        period?: number;
        periodPrefix?: string;
        type?: {
          state?: string;
          shortDetail?: string;
          detail?: string;
          description?: string;
        };
      }
    | undefined,
): BaseballGameSituation | null {
  if (!status) {
    return null;
  }

  const inning = typeof status.period === "number" && status.period > 0 ? status.period : null;
  const detail =
    safeText(status.type?.shortDetail) ||
    safeText(status.type?.detail) ||
    safeText(status.type?.description) ||
    (inning ? `${status.periodPrefix ?? ""} ${inning}`.trim() : "Scheduled");

  return {
    inning,
    half: normalizeHalfInning(status.periodPrefix, status.type?.state),
    label: detail,
    outs: null,
    balls: null,
    strikes: null,
    bases: {
      first: false,
      second: false,
      third: false,
    } satisfies BaseballBaseOccupancy,
  };
}

function mapConference(
  group?: {
    id?: string;
    name?: string;
    shortName?: string;
  } | null,
): LiveGameListItem["conference"] {
  const shortName = safeText(group?.shortName, safeText(group?.name));
  if (!shortName) {
    return null;
  }
  return {
    id: safeText(group?.id) || undefined,
    name: safeText(group?.name, shortName) || undefined,
    shortName,
  };
}

function normalizeConferenceLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseConferenceFromStandingSummary(
  standingSummary: string | undefined,
): LiveGameListItem["conference"] {
  const summary = safeText(standingSummary);
  if (!summary) {
    return null;
  }
  const normalizedSummary = normalizeConferenceLabel(summary);
  const canonical = COLLEGE_BASKETBALL_CONFERENCES.find((conference) =>
    conference.aliases.some((alias) => {
      const normalizedAlias = normalizeConferenceLabel(alias);
      return (
        normalizedSummary === normalizedAlias ||
        normalizedSummary.startsWith(`${normalizedAlias} `) ||
        normalizedSummary.includes(` ${normalizedAlias} `)
      );
    }),
  );

  if (!canonical) {
    return null;
  }

  return {
    id: canonical.key,
    name: canonical.label,
    shortName: canonical.label,
  };
}

type TeamConferenceCacheEntry = {
  conference: LiveGameListItem["conference"];
  expiresAt: number;
};

const teamConferenceCache = new Map<string, TeamConferenceCacheEntry>();

async function resolveTeamConference(
  teamId: string | undefined,
  fallbackConference: LiveGameListItem["conference"],
): Promise<LiveGameListItem["conference"]> {
  const normalizedTeamId = safeText(teamId);
  if (!normalizedTeamId) {
    return fallbackConference;
  }

  const cached = teamConferenceCache.get(normalizedTeamId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.conference ?? fallbackConference;
  }

  const response = await safeFetchJson<EspnBaseballTeamResponse>(
    `${COLLEGE_BASEBALL_TEAMS_BASE}/${encodeURIComponent(normalizedTeamId)}`,
  );
  if (!response.ok) {
    teamConferenceCache.set(normalizedTeamId, {
      conference: fallbackConference,
      expiresAt: Date.now() + 1000 * 60 * 10,
    });
    return fallbackConference;
  }

  const payload = response.data;
  const parsedConference =
    mapConference(payload.team?.groups) ??
    parseConferenceFromStandingSummary(payload.team?.standingSummary) ??
    fallbackConference;
  teamConferenceCache.set(normalizedTeamId, {
    conference: parsedConference,
    expiresAt: Date.now() + TEAM_CONFERENCE_CACHE_TTL_MS,
  });
  return parsedConference;
}

function mapCompetitor(
  competitor: EspnBaseballCompetitor | undefined,
  conference: LiveGameListItem["conference"],
): LiveGameListItem["home"] {
  const totalRecord =
    competitor?.records?.find((entry) => safeText(entry.type) === "total")?.displayValue ??
    competitor?.records?.find((entry) => safeText(entry.type) === "total")?.summary ??
    "";

  return {
    id: safeText(competitor?.team?.id) || undefined,
    name:
      safeText(competitor?.team?.displayName) ||
      safeText(competitor?.team?.shortDisplayName) ||
      "Team",
    shortDisplayName: safeText(competitor?.team?.shortDisplayName) || undefined,
    abbreviation: safeText(competitor?.team?.abbreviation) || undefined,
    score: getScore(competitor?.score),
    logo:
      safeText(competitor?.team?.logos?.[0]?.href) ||
      safeText(competitor?.team?.logo) ||
      undefined,
    conference,
    record: safeText(totalRecord),
  };
}

async function mapBaseballEvent(
  event: EspnBaseballScoreboardEvent,
): Promise<LiveGameListItem | null> {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const away = competitors.find((row) => row.homeAway === "away");
  const home = competitors.find((row) => row.homeAway === "home");
  const gameId = safeText(event.id);
  const status = competition?.status ?? event.status;
  const baseballState = createBaseballSituation(status);
  const state = safeText(status?.type?.state).toLowerCase();

  if (!competition || !away || !home || !gameId) {
    return null;
  }
  const gameConference = mapConference(competition.groups);
  const [homeConference, awayConference] = await Promise.all([
    resolveTeamConference(home.team?.id, gameConference),
    resolveTeamConference(away.team?.id, gameConference),
  ]);

  return {
    sport: "baseball",
    gameId,
    home: mapCompetitor(home, homeConference),
    away: mapCompetitor(away, awayConference),
    statusText:
      safeText(status?.type?.shortDetail) ||
      safeText(status?.type?.description) ||
      "Scheduled",
    statusDetail:
      baseballState?.label ||
      safeText(status?.type?.detail) ||
      safeText(status?.type?.description),
    period: typeof status?.period === "number" ? status.period : 0,
    clock: safeText(status?.displayClock),
    isLive: state === "in",
    venue: safeText(competition.venue?.fullName) || undefined,
    conference: mapConference(competition.groups),
    baseballState,
    baseballScoreboard: {
      inningLabel: baseballState?.label ?? safeText(status?.type?.shortDetail, "Scheduled"),
      situation: baseballState,
      away: {
        runs: getScore(away.score),
        hits: String(Math.max(0, safeNumber(away.hits) ?? 0)),
        errors: String(Math.max(0, safeNumber(away.errors) ?? 0)),
      },
      home: {
        runs: getScore(home.score),
        hits: String(Math.max(0, safeNumber(home.hits) ?? 0)),
        errors: String(Math.max(0, safeNumber(home.errors) ?? 0)),
      },
    },
  };
}

async function safeFetchJson<T>(url: string, init?: RequestInit): Promise<SafeFetchResult<T>> {
  try {
    const response = await fetch(url, init);
    if (response.status === 404) {
      return {
        ok: false,
        status: 404,
        data: null,
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: null,
      };
    }

    const data = (await response.json()) as T;
    return {
      ok: true,
      status: response.status,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: "network_error",
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildCollegeBaseballFetchErrorMessage(
  status: number | "network_error",
  context: string,
): string {
  if (status === "network_error") {
    return `College Baseball network error (${context})`;
  }
  return `College Baseball HTTP ${status} (${context})`;
}

function getScoreboardUrl(dateKey?: string): string {
  if (!dateKey) {
    return COLLEGE_BASEBALL_SCOREBOARD_BASE;
  }
  return `${COLLEGE_BASEBALL_SCOREBOARD_BASE}?dates=${dateKey.replace(/-/g, "")}`;
}

function buildCommentGameId(gameId: string): string {
  return `baseball:${gameId}`;
}

async function commentsApi<T>(path: string, init?: RequestInit): Promise<T> {
  const url = getApiUrl(path);
  console.log(`[college baseball api] request -> ${url}`);
  const response = await apiFetch(path, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchCollegeBaseballGamesForDate(
  dateKey: string,
): Promise<LiveGameListItem[]> {
  const response = await safeFetchJson<EspnBaseballScoreboardResponse>(getScoreboardUrl(dateKey));
  if (!response.ok) {
    if (response.status === 404) {
      return [];
    }
    throw new Error(buildCollegeBaseballFetchErrorMessage(response.status, "scoreboard"));
  }
  const payload = response.data;
  const rows = await Promise.all((payload.events ?? []).map(mapBaseballEvent));
  return rows.filter((row): row is LiveGameListItem => Boolean(row));
}

export async function fetchCollegeBaseballLiveGames(): Promise<LiveGameListItem[]> {
  const rows = await fetchCollegeBaseballTodayGames();
  return rows.filter((row) => row.isLive);
}

export async function fetchCollegeBaseballTodayGames(): Promise<LiveGameListItem[]> {
  const response = await safeFetchJson<EspnBaseballScoreboardResponse>(COLLEGE_BASEBALL_SCOREBOARD_BASE);
  if (!response.ok) {
    if (response.status === 404) {
      return [];
    }
    throw new Error(buildCollegeBaseballFetchErrorMessage(response.status, "today-scoreboard"));
  }
  const payload = response.data;
  const rows = await Promise.all((payload.events ?? []).map(mapBaseballEvent));
  return rows.filter((row): row is LiveGameListItem => Boolean(row));
}

export async function fetchCollegeBaseballLiveGamePayload(
  gameId: string,
): Promise<CollegeBaseballLivePayloadResult> {
  const response = await safeFetchJson<unknown>(
    `${COLLEGE_BASEBALL_SUMMARY_BASE}?event=${encodeURIComponent(gameId)}`,
  );
  if (!response.ok) {
    if (response.status === 404) {
      return {
        status: "empty",
        events: [],
      };
    }
    return {
      status: "error",
      events: [],
      code: response.status,
      error: buildCollegeBaseballFetchErrorMessage(response.status, "summary"),
    };
  }
  return {
    status: "ok",
    data: response.data,
  };
}

export async function getCollegeBaseballGameComments(
  gameId: string,
  limit = 100,
): Promise<GameComment[]> {
  const safeLimit = Math.max(1, Math.min(200, limit));
  return commentsApi<GameComment[]>(
    `/cbb/game/${encodeURIComponent(buildCommentGameId(gameId))}/comments?limit=${encodeURIComponent(
      String(safeLimit),
    )}`,
  );
}

export async function postCollegeBaseballGameComment(
  gameId: string,
  input: { authorName: string; body: string },
): Promise<GameComment> {
  return commentsApi<GameComment>(
    `/cbb/game/${encodeURIComponent(buildCommentGameId(gameId))}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}
