import type { GameComment, LiveGameListItem } from "@/src/features/cbb/api";
import {
  fetchGamesForDate as fetchCollegeGamesForDate,
  fetchLiveGamePayload as fetchCollegeLiveGamePayload,
  fetchLiveGames as fetchCollegeLiveGames,
  fetchTodayGames as fetchCollegeTodayGames,
  getGameComments as getCollegeGameComments,
  postGameComment as postCollegeGameComment,
} from "@/src/features/cbb/api";
import {
  fetchCollegeBaseballGamesForDate,
  fetchCollegeBaseballLiveGamePayload,
  fetchCollegeBaseballLiveGames,
  fetchCollegeBaseballTodayGames,
  getCollegeBaseballGameComments,
  postCollegeBaseballGameComment,
} from "@/src/features/cbaseball/api";
import {
  fetchNbaGamesForDate,
  fetchNbaLiveGamePayload,
  fetchNbaLiveGames,
  fetchNbaTodayGames,
  getNbaGameComments,
  postNbaGameComment,
} from "@/src/features/nba/api";
import type { GameMode } from "@/src/mode/gameModeTypes";

export type { GameComment, LiveGameListItem } from "@/src/features/cbb/api";

export async function fetchGamesForDate(
  mode: GameMode,
  dateKey: string,
): Promise<LiveGameListItem[]> {
  if (mode === "nba") {
    return fetchNbaGamesForDate(dateKey);
  }
  if (mode === "baseball") {
    return fetchCollegeBaseballGamesForDate(dateKey);
  }
  return fetchCollegeGamesForDate(dateKey);
}

export async function fetchLiveGames(mode: GameMode): Promise<LiveGameListItem[]> {
  if (mode === "nba") {
    return fetchNbaLiveGames();
  }
  if (mode === "baseball") {
    return fetchCollegeBaseballLiveGames();
  }
  return fetchCollegeLiveGames();
}

export async function fetchTodayGames(
  mode: GameMode,
): Promise<LiveGameListItem[]> {
  if (mode === "nba") {
    return fetchNbaTodayGames();
  }
  if (mode === "baseball") {
    return fetchCollegeBaseballTodayGames();
  }
  return fetchCollegeTodayGames();
}

export async function fetchLiveGamePayload(
  mode: GameMode,
  gameId: string,
): Promise<unknown> {
  if (mode === "nba") {
    return fetchNbaLiveGamePayload(gameId);
  }
  if (mode === "baseball") {
    return fetchCollegeBaseballLiveGamePayload(gameId);
  }
  return fetchCollegeLiveGamePayload(gameId);
}

export async function getGameComments(
  mode: GameMode,
  gameId: string,
  limit = 100,
): Promise<GameComment[]> {
  if (mode === "nba") {
    return getNbaGameComments(gameId, limit);
  }
  if (mode === "baseball") {
    return getCollegeBaseballGameComments(gameId, limit);
  }
  return getCollegeGameComments(gameId, limit);
}

export async function postGameComment(
  mode: GameMode,
  gameId: string,
  input: { authorName: string; body: string },
): Promise<GameComment> {
  if (mode === "nba") {
    return postNbaGameComment(gameId, input);
  }
  if (mode === "baseball") {
    return postCollegeBaseballGameComment(gameId, input);
  }
  return postCollegeGameComment(gameId, input);
}
