import type {
  BettingGame,
  BettingSettings,
  EvItem,
  FliffLine,
  TopMarketEvItem,
} from "./types";
import { apiFetch, getApiUrl } from '@/src/config/api';

type RawBettingGame = {
  id?: string;
  eventId?: string;
  sport_key?: string;
  sportKey?: string;
  home_team?: string;
  homeTeam?: string;
  away_team?: string;
  awayTeam?: string;
  commence_time?: string;
  commenceTime?: string;
};

export type MatchedOddsWinProbability = {
  homeWinProb: number;
  awayWinProb: number;
};

export type MatchedOddsResponse = {
  event: BettingGame | null;
  odds: Record<string, unknown> | null;
  winProbability: MatchedOddsWinProbability | null;
};

function mapBettingGame(raw: RawBettingGame): BettingGame {
  return {
    eventId: raw.eventId ?? raw.id ?? '',
    sportKey: raw.sportKey ?? raw.sport_key ?? 'basketball_ncaab',
    homeTeam: raw.homeTeam ?? raw.home_team,
    awayTeam: raw.awayTeam ?? raw.away_team,
    commenceTime: raw.commenceTime ?? raw.commence_time,
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const url = getApiUrl(path);
  console.log(`[betting api] request -> ${url}`);
  try {
    const response = await apiFetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    if (!response.ok) {
      const body = await response.text();
      let message = body || `Request failed: ${response.status}`;
      // Server errors come back as { error: string }; surface just that.
      try {
        const parsed = JSON.parse(body) as { error?: unknown };
        if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
          message = parsed.error;
        }
      } catch {
        // Non-JSON body: keep the raw text.
      }
      throw new Error(message);
    }
    // Use text() → manual parse so we can strip a leading BOM or stray characters
    // that cause JSON.parse to throw "Unexpected non-whitespace character after JSON".
    const raw = await response.text();
    // TEMP DEBUG (remove after diagnosing the "Fliff/betting lines still not
    // working" report) — the raw, unparsed body exactly as received, before
    // any cleanup/parsing touches it.
    console.log(`[betting api][TEMP DEBUG] raw response from ${url} (status ${response.status}, length ${raw.length}):`);
    console.log(raw);
    // ﻿ = UTF-8 BOM; trim() also removes stray leading/trailing whitespace
    const cleaned = raw.replace(/^﻿/, "").trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch (parseErr) {
      const preview = cleaned.slice(0, 120);
      throw new Error(`Response is not valid JSON (first 120 chars: ${preview})`);
    }
  } catch (error) {
    const err = error as Error;
    console.log(`[betting api] request failed -> ${url}`);
    console.log(`[betting api] error: ${err.message}`);
    if (err.stack) {
      console.log(err.stack);
    }
    throw error;
  }
}

export function fetchBettingGames(date: string, sportKey = 'basketball_ncaab') {
  return api<RawBettingGame[]>(`/betting/games?date=${encodeURIComponent(date)}&sportKey=${encodeURIComponent(sportKey)}`)
    .then((rows) => rows.map(mapBettingGame).filter((row) => row.eventId));
}

export function fetchWatchlist() {
  return api<Array<{ eventId: string; sportKey: string; addedAt: string }>>('/betting/watchlist');
}

export function setWatchlist(eventId: string, sportKey: string, watching: boolean) {
  return api<{ ok: boolean }>('/betting/watchlist', {
    method: 'POST',
    body: JSON.stringify({ eventId, sportKey, watching }),
  });
}

export function fetchEventOdds(eventId: string, sportKey = 'basketball_ncaab') {
  return api<Record<string, unknown>>(`/betting/odds?eventId=${encodeURIComponent(eventId)}&sportKey=${encodeURIComponent(sportKey)}`);
}

export function fetchMatchedEventOdds(params: {
  sportKey?: string;
  homeTeam: string;
  homeShortTeam?: string;
  homeAbbreviation?: string;
  awayTeam: string;
  awayShortTeam?: string;
  awayAbbreviation?: string;
  startDateTime?: string;
  forceRefresh?: boolean;
}) {
  const query = new URLSearchParams();
  query.set("sportKey", params.sportKey ?? "basketball_ncaab");
  query.set("homeTeam", params.homeTeam);
  query.set("awayTeam", params.awayTeam);
  if (params.homeShortTeam) {
    query.set("homeShortTeam", params.homeShortTeam);
  }
  if (params.homeAbbreviation) {
    query.set("homeAbbreviation", params.homeAbbreviation);
  }
  if (params.awayShortTeam) {
    query.set("awayShortTeam", params.awayShortTeam);
  }
  if (params.awayAbbreviation) {
    query.set("awayAbbreviation", params.awayAbbreviation);
  }
  if (params.startDateTime) {
    query.set("startDateTime", params.startDateTime);
  }
  if (params.forceRefresh) {
    query.set("forceRefresh", "true");
  }

  return api<MatchedOddsResponse>(`/betting/matched-odds?${query.toString()}`);
}

export async function fetchTopMarketEv(
  date: string,
  sportKey = "basketball_ncaab",
  options?: {
    signal?: AbortSignal;
    forceRefresh?: boolean;
    sortBy?: "proEv" | "fairProb";
    limit?: number;
  },
): Promise<TopMarketEvItem[]> {
  void sportKey;
  const query = new URLSearchParams();
  query.set("date", date);
  if (options?.forceRefresh) {
    query.set("forceRefresh", "true");
  }
  if (options?.sortBy) {
    query.set("sortBy", options.sortBy);
  }
  if (typeof options?.limit === "number" && Number.isFinite(options.limit)) {
    query.set("limit", `${Math.max(1, Math.floor(options.limit))}`);
  }
  return api<TopMarketEvItem[]>(`/betting/top-market-ev?${query.toString()}`, {
    signal: options?.signal,
  });
}

export function fetchFliffLines(params: { date?: string; eventId?: string }) {
  const query = new URLSearchParams();
  if (params.date) {
    query.set('date', params.date);
  }
  if (params.eventId) {
    query.set('eventId', params.eventId);
  }
  return api<FliffLine[]>(`/betting/fliff-lines?${query.toString()}`);
}

export function createFliffLine(payload: {
  eventId: string;
  sportKey: string;
  marketType: 'moneyline' | 'spread' | 'total';
  side: string;
  americanOdds: number;
  linePoint?: number | null;
  notes?: string | null;
}) {
  return api<{ id: number }>('/betting/fliff-lines', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchTopEV(
  date: string | undefined,
  settings: BettingSettings,
  watchedOnly = false,
  options?: { signal?: AbortSignal },
) {
  const query = new URLSearchParams();
  if (date) {
    query.set('date', date);
  }
  query.set('minEV', `${settings.minEV}`);
  query.set('referenceBooks', settings.referenceBooks.join(','));
  query.set('watchedOnly', watchedOnly ? 'true' : 'false');
  return api<EvItem[]>(`/betting/ev?${query.toString()}`, { signal: options?.signal });
}

export function createBet(payload: {
  fliffLineId: number;
  stake: number;
  americanOdds: number;
  linePoint?: number | null;
  marketType: 'moneyline' | 'spread' | 'total';
  side: string;
  notes?: string | null;
}) {
  return api<{ id: number }>('/betting/bets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchBets() {
  return api<Array<Record<string, unknown>>>('/betting/bets');
}

export function settleBet(id: number, result: 'win' | 'loss' | 'push') {
  return api<{ ok: boolean }>(`/betting/bets/${id}/result`, {
    method: 'POST',
    body: JSON.stringify({ result }),
  });
}

export function fetchCLV(liveMinutes: number) {
  return api<{ snapshots: Array<Record<string, unknown>> }>(`/betting/clv?liveMinutes=${liveMinutes}`);
}
