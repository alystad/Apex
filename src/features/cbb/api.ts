import { apiFetch, getApiUrl } from "@/src/config/api";
import type {
  BaseballGameSituation,
  BaseballScoreboardSnapshot,
} from "@/src/features/baseball/baseballTypes";

export type LiveGameListItem = {
  gameId: string;
  sport?: "basketball" | "baseball";
  home: {
    id?: string;
    name: string;
    shortDisplayName?: string;
    abbreviation?: string;
    score: string;
    logo?: string;
    record?: string;
    conference?: {
      id?: string;
      name?: string;
      shortName?: string;
    } | null;
  };
  away: {
    id?: string;
    name: string;
    shortDisplayName?: string;
    abbreviation?: string;
    score: string;
    logo?: string;
    record?: string;
    conference?: {
      id?: string;
      name?: string;
      shortName?: string;
    } | null;
  };
  statusText: string;
  period: number;
  clock: string;
  isLive: boolean;
  statusDetail?: string;
  venue?: string;
  conference?: {
    id?: string;
    name?: string;
    shortName?: string;
  } | null;
  baseballState?: BaseballGameSituation | null;
  baseballScoreboard?: BaseballScoreboardSnapshot;
};

export type GameComment = {
  id: number;
  gameId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

async function api<T>(path: string): Promise<T> {
  const url = getApiUrl(path);
  console.log(`[cbb api] request -> ${url}`);
  const response = await apiFetch(path);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchLiveGames(): Promise<LiveGameListItem[]> {
  return api<LiveGameListItem[]>("/cbb/live-games");
}

export async function fetchGamesForDate(dateKey: string): Promise<LiveGameListItem[]> {
  return api<LiveGameListItem[]>(`/cbb/games?date=${encodeURIComponent(dateKey)}`);
}

export async function fetchTodayGames(): Promise<LiveGameListItem[]> {
  return api<LiveGameListItem[]>("/cbb/games/today");
}

export async function fetchLiveGamePayload(gameId: string): Promise<unknown> {
  return api<unknown>(`/cbb/game/${encodeURIComponent(gameId)}/live`);
}

export async function getGameComments(gameId: string, limit = 100): Promise<GameComment[]> {
  const safeLimit = Math.max(1, Math.min(200, limit));
  return api<GameComment[]>(
    `/cbb/game/${encodeURIComponent(gameId)}/comments?limit=${encodeURIComponent(String(safeLimit))}`,
  );
}

export async function postGameComment(
  gameId: string,
  input: { authorName: string; body: string },
): Promise<GameComment> {
  const url = getApiUrl(`/cbb/game/${encodeURIComponent(gameId)}/comments`);
  console.log(`[cbb api] request -> ${url}`);
  const response = await apiFetch(`/cbb/game/${encodeURIComponent(gameId)}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as GameComment;
}
