import type { BaseballGameSituation } from "@/src/features/baseball/baseballTypes";
import type { GameMode } from "@/src/mode/gameModeTypes";

export const MAX_MULTI_VIEW_GAMES = 4;

export type MultiViewEntrySource = "multiview" | "normal";

export type MultiViewGameSnapshot = {
  sport?: "basketball" | "baseball";
  awayName?: string;
  homeName?: string;
  awayLogo?: string;
  homeLogo?: string;
  awayScore?: string;
  homeScore?: string;
  statusText?: string;
  venue?: string;
  startDateTime?: string;
  baseballState?: BaseballGameSituation | null;
};

export type MultiViewGameSelection = {
  key: string;
  gameId: string;
  mode: GameMode;
  addedAt: string;
  snapshot?: MultiViewGameSnapshot;
};

export type MultiViewState = {
  games: MultiViewGameSelection[];
  lastEntrySource: MultiViewEntrySource;
};

export type AddMultiViewGameInput = {
  gameId: string;
  mode: GameMode;
  snapshot?: MultiViewGameSnapshot;
};

export type AddMultiViewGameResult =
  | { status: "added"; key: string }
  | { status: "already_exists"; key: string }
  | { status: "max_reached"; max: number }
  | { status: "invalid" };

export function buildMultiViewGameKey(mode: GameMode, gameId: string): string {
  return `${mode}:${gameId.trim()}`;
}
