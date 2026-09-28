import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readResourceCache, writeResourceCache } from "@/src/loading/resourceCache";
import type { MultiViewGameSelection } from "@/src/multiview/multiViewTypes";
import type { BaseballGameSituation } from "@/src/features/baseball/baseballTypes";
import { fetchLiveGamePayload } from "@/src/features/basketball/api";
import type { GameMode } from "@/src/mode/gameModeTypes";
import { useSettingsState } from "@/src/settings/SettingsContext";

const MULTI_VIEW_POLL_INTERVAL_MS = 5000;
const MULTI_VIEW_CACHE_TTL_MS = 10_000;

type TeamSummary = {
  id?: string;
  name: string;
  abbreviation: string;
  logo?: string;
  score: string;
  hits?: string;
  errors?: string;
};

export type MultiViewLiveGameSnapshot = {
  key: string;
  gameId: string;
  mode: GameMode;
  sport: "basketball" | "baseball";
  statusText: string;
  statusDetail: string;
  isLive: boolean;
  period: number;
  clock: string;
  venue?: string;
  startDateTime?: string;
  away: TeamSummary;
  home: TeamSummary;
  baseballState?: BaseballGameSituation | null;
};

export type MultiViewLiveGameState = {
  data: MultiViewLiveGameSnapshot;
  isLoading: boolean;
  error: string | null;
  updatedAt: string | null;
};

type SummaryCompetition = {
  date?: string;
  venue?: { fullName?: string };
  status?: {
    period?: number;
    displayClock?: string;
    periodPrefix?: string;
    type?: {
      state?: string;
      description?: string;
      detail?: string;
      shortDetail?: string;
    };
  };
  competitors?: Array<{
    homeAway?: "home" | "away";
    score?: string | { displayValue?: string; value?: number };
    hits?: number;
    errors?: number;
    team?: {
      id?: string;
      abbreviation?: string;
      displayName?: string;
      shortDisplayName?: string;
      logo?: string;
      logos?: Array<{ href?: string }>;
    };
  }>;
};

type SummaryPlay = {
  outs?: number;
  onFirst?: boolean;
  onSecond?: boolean;
  onThird?: boolean;
  resultCount?: string;
};

type SummaryPayload = {
  header?: {
    competitions?: SummaryCompetition[];
  };
  plays?: SummaryPlay[];
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
  return null;
}

function parseScore(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (value && typeof value === "object") {
    const candidate = value as { displayValue?: unknown; value?: unknown };
    if (
      typeof candidate.displayValue === "string" &&
      candidate.displayValue.trim().length > 0
    ) {
      return candidate.displayValue.trim();
    }
    const score = safeNumber(candidate.value);
    if (score !== null) {
      return String(Math.round(score));
    }
  }
  return "0";
}

function parseBaseballHalf(
  periodPrefix: string | undefined,
  state: string | undefined,
  shortDetail: string | undefined,
): BaseballGameSituation["half"] {
  const normalizedPrefix = safeText(periodPrefix).toLowerCase();
  if (normalizedPrefix.startsWith("top")) return "top";
  if (normalizedPrefix.startsWith("bottom")) return "bottom";
  if (normalizedPrefix.startsWith("middle")) return "middle";
  if (normalizedPrefix.startsWith("end")) return "end";

  const normalizedDetail = safeText(shortDetail).toLowerCase();
  if (normalizedDetail.startsWith("top")) return "top";
  if (normalizedDetail.startsWith("bottom")) return "bottom";
  if (normalizedDetail.startsWith("middle")) return "middle";
  if (normalizedDetail.startsWith("end")) return "end";

  const normalizedState = safeText(state).toLowerCase();
  if (normalizedState === "pre" || normalizedState === "scheduled") return "pregame";
  if (normalizedState === "post" || normalizedState === "final") return "final";

  return "unknown";
}

function parseCount(resultCount: string | undefined): { balls: number | null; strikes: number | null } {
  const match = safeText(resultCount).match(/(\d)\s*-\s*(\d)/);
  if (!match) {
    return { balls: null, strikes: null };
  }
  const balls = Number.parseInt(match[1] ?? "", 10);
  const strikes = Number.parseInt(match[2] ?? "", 10);
  return {
    balls: Number.isFinite(balls) ? balls : null,
    strikes: Number.isFinite(strikes) ? strikes : null,
  };
}

function buildFallbackFromSelection(
  selection: MultiViewGameSelection,
): MultiViewLiveGameSnapshot {
  const fallbackSport =
    selection.snapshot?.sport ?? (selection.mode === "baseball" ? "baseball" : "basketball");
  return {
    key: selection.key,
    gameId: selection.gameId,
    mode: selection.mode,
    sport: fallbackSport,
    statusText: safeText(selection.snapshot?.statusText, "Loading"),
    statusDetail: safeText(selection.snapshot?.statusText, "Loading game state"),
    isLive: false,
    period: 0,
    clock: "",
    venue: selection.snapshot?.venue,
    startDateTime: selection.snapshot?.startDateTime,
    away: {
      name: safeText(selection.snapshot?.awayName, "Away"),
      abbreviation: safeText(selection.snapshot?.awayName, "AWY"),
      logo: selection.snapshot?.awayLogo,
      score: safeText(selection.snapshot?.awayScore, "0"),
    },
    home: {
      name: safeText(selection.snapshot?.homeName, "Home"),
      abbreviation: safeText(selection.snapshot?.homeName, "HOME"),
      logo: selection.snapshot?.homeLogo,
      score: safeText(selection.snapshot?.homeScore, "0"),
    },
    baseballState:
      fallbackSport === "baseball" ? selection.snapshot?.baseballState ?? null : undefined,
  };
}

function parseSummaryToTileState(
  selection: MultiViewGameSelection,
  payload: SummaryPayload,
): MultiViewLiveGameSnapshot {
  const competition = payload.header?.competitions?.[0];
  const status = competition?.status;
  const competitors = competition?.competitors ?? [];
  const awayTeam = competitors.find((row) => row.homeAway === "away");
  const homeTeam = competitors.find((row) => row.homeAway === "home");
  const isBaseball = selection.mode === "baseball";
  const state = safeText(status?.type?.state).toLowerCase();
  const latestPlay = payload.plays?.[payload.plays.length - 1];
  const count = parseCount(latestPlay?.resultCount);

  const baseballState: BaseballGameSituation | null =
    isBaseball
      ? {
          inning:
            typeof status?.period === "number" && status.period > 0 ? status.period : null,
          half: parseBaseballHalf(
            status?.periodPrefix,
            status?.type?.state,
            status?.type?.shortDetail,
          ),
          label:
            safeText(status?.type?.shortDetail) ||
            safeText(status?.type?.detail) ||
            safeText(status?.type?.description) ||
            "Scheduled",
          outs:
            typeof latestPlay?.outs === "number" && Number.isFinite(latestPlay.outs)
              ? latestPlay.outs
              : null,
          balls: count.balls,
          strikes: count.strikes,
          bases: {
            first: Boolean(latestPlay?.onFirst),
            second: Boolean(latestPlay?.onSecond),
            third: Boolean(latestPlay?.onThird),
          },
        }
      : null;

  return {
    key: selection.key,
    gameId: selection.gameId,
    mode: selection.mode,
    sport: isBaseball ? "baseball" : "basketball",
    statusText:
      safeText(status?.type?.shortDetail) ||
      safeText(status?.type?.description) ||
      safeText(selection.snapshot?.statusText, "Scheduled"),
    statusDetail:
      safeText(status?.type?.detail) ||
      safeText(status?.type?.shortDetail) ||
      safeText(status?.type?.description) ||
      "Scheduled",
    isLive: state === "in",
    period: typeof status?.period === "number" ? status.period : 0,
    clock: safeText(status?.displayClock),
    venue:
      safeText(competition?.venue?.fullName) ||
      safeText(selection.snapshot?.venue) ||
      undefined,
    startDateTime:
      safeText(competition?.date) || safeText(selection.snapshot?.startDateTime) || undefined,
    away: {
      id: safeText(awayTeam?.team?.id) || undefined,
      name:
        safeText(awayTeam?.team?.shortDisplayName) ||
        safeText(awayTeam?.team?.displayName) ||
        safeText(selection.snapshot?.awayName, "Away"),
      abbreviation:
        safeText(awayTeam?.team?.abbreviation) ||
        safeText(selection.snapshot?.awayName, "AWY").slice(0, 3).toUpperCase(),
      logo:
        safeText(awayTeam?.team?.logos?.[0]?.href) ||
        safeText(awayTeam?.team?.logo) ||
        selection.snapshot?.awayLogo,
      score: parseScore(awayTeam?.score ?? selection.snapshot?.awayScore),
      hits: isBaseball ? String(Math.max(0, safeNumber(awayTeam?.hits) ?? 0)) : undefined,
      errors: isBaseball ? String(Math.max(0, safeNumber(awayTeam?.errors) ?? 0)) : undefined,
    },
    home: {
      id: safeText(homeTeam?.team?.id) || undefined,
      name:
        safeText(homeTeam?.team?.shortDisplayName) ||
        safeText(homeTeam?.team?.displayName) ||
        safeText(selection.snapshot?.homeName, "Home"),
      abbreviation:
        safeText(homeTeam?.team?.abbreviation) ||
        safeText(selection.snapshot?.homeName, "HOME").slice(0, 4).toUpperCase(),
      logo:
        safeText(homeTeam?.team?.logos?.[0]?.href) ||
        safeText(homeTeam?.team?.logo) ||
        selection.snapshot?.homeLogo,
      score: parseScore(homeTeam?.score ?? selection.snapshot?.homeScore),
      hits: isBaseball ? String(Math.max(0, safeNumber(homeTeam?.hits) ?? 0)) : undefined,
      errors: isBaseball ? String(Math.max(0, safeNumber(homeTeam?.errors) ?? 0)) : undefined,
    },
    baseballState: isBaseball ? baseballState : undefined,
  };
}

async function fetchSnapshot(
  selection: MultiViewGameSelection,
): Promise<MultiViewLiveGameSnapshot> {
  const cacheKey = `multiview-summary:${selection.key}`;
  const cached = readResourceCache<SummaryPayload>(cacheKey, MULTI_VIEW_CACHE_TTL_MS);
  const payload =
    cached ??
    ((await fetchLiveGamePayload(selection.mode, selection.gameId)) as SummaryPayload);

  if (!cached) {
    writeResourceCache(cacheKey, payload);
  }

  return parseSummaryToTileState(selection, payload);
}

export function useMultiViewLiveGames(games: MultiViewGameSelection[]) {
  const [entries, setEntries] = useState<Record<string, MultiViewLiveGameState>>({});
  const inFlightRef = useRef(false);
  const keys = useMemo(() => games.map((game) => game.key), [games]);
  const keySignature = useMemo(() => keys.join("|"), [keys]);

  // Broadcast/sync delay: hold freshly-fetched snapshots for the configured
  // number of seconds before committing them, mirroring the main live-game
  // provider's publish buffer so multiview does not run ahead of a delayed
  // stream. Held in a ref so changing the delay doesn't restart the poll loop.
  const { state: settingsState } = useSettingsState();
  const delayRef = useRef(settingsState.inGame.liveDataDelaySeconds);
  const delayTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    delayRef.current = settingsState.inGame.liveDataDelaySeconds;
  }, [settingsState.inGame.liveDataDelaySeconds]);
  // Clear any pending delayed commits on unmount or when the game set changes,
  // so stale snapshots never render late.
  useEffect(() => {
    return () => {
      delayTimersRef.current.forEach((timer) => clearTimeout(timer));
      delayTimersRef.current = [];
    };
  }, [keySignature]);

  const refresh = useCallback(async () => {
    if (games.length === 0 || inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;

    const updates = await Promise.all(
      games.map(async (selection) => {
        try {
          const data = await fetchSnapshot(selection);
          return {
            key: selection.key,
            next: {
              data,
              isLoading: false,
              error: null,
              updatedAt: new Date().toISOString(),
            } satisfies MultiViewLiveGameState,
          };
        } catch (error) {
          return {
            key: selection.key,
            next: {
              data: buildFallbackFromSelection(selection),
              isLoading: false,
              error: error instanceof Error ? error.message : "Failed to refresh game.",
              updatedAt: new Date().toISOString(),
            } satisfies MultiViewLiveGameState,
          };
        }
      }),
    );

    const commit = () => {
      setEntries((current) => {
        const next: Record<string, MultiViewLiveGameState> = {};
        keys.forEach((key) => {
          const update = updates.find((entry) => entry.key === key);
          if (update) {
            next[key] = update.next;
            return;
          }
          if (current[key]) {
            next[key] = current[key];
          }
        });
        return next;
      });
    };

    const delaySeconds = delayRef.current;
    if (delaySeconds > 0) {
      const timer = setTimeout(() => {
        delayTimersRef.current = delayTimersRef.current.filter((item) => item !== timer);
        commit();
      }, delaySeconds * 1000);
      delayTimersRef.current.push(timer);
    } else {
      commit();
    }

    inFlightRef.current = false;
  }, [games, keys]);

  useEffect(() => {
    setEntries((current) => {
      if (games.length === 0) {
        return {};
      }

      const next: Record<string, MultiViewLiveGameState> = {};
      games.forEach((selection) => {
        next[selection.key] =
          current[selection.key] ??
          ({
            data: buildFallbackFromSelection(selection),
            isLoading: true,
            error: null,
            updatedAt: null,
          } satisfies MultiViewLiveGameState);
      });
      return next;
    });
  }, [games, keySignature]);

  useEffect(() => {
    let cancelled = false;
    if (games.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    const runRefresh = async () => {
      if (cancelled) {
        return;
      }
      await refresh();
    };

    void runRefresh();

    const timer = setInterval(() => {
      void runRefresh();
    }, MULTI_VIEW_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [games.length, keySignature, refresh]);

  const isInitialLoading = useMemo(
    () =>
      games.length > 0 &&
      games.some((game) => {
        const entry = entries[game.key];
        return !entry || entry.isLoading;
      }),
    [entries, games],
  );

  return {
    entries,
    refresh,
    isInitialLoading,
  };
}
