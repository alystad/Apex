import type { GameMode } from "@/src/mode/gameModeTypes";

export type PredictionGameStatus = "pre" | "live" | "final";
export type PredictionResult = "pending" | "correct" | "incorrect";

export type GamePrediction = {
  mode: GameMode;
  gameId: string;
  pickedTeamId: string;
  pickedTeamName: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  gameDate: string;
  conference?: string;
  gameStatus: PredictionGameStatus;
  actualWinnerTeamId?: string;
  result: PredictionResult;
  createdAt: string;
  updatedAt: string;
};

export type PredictionStats = {
  total: number;
  correct: number;
  incorrect: number;
  pending: number;
  winPct: number;
  currentStreak: number;
  bestStreak: number;
  homeCorrect: number;
  homeIncorrect: number;
  awayCorrect: number;
  awayIncorrect: number;
};

export type PredictionInsight = {
  mostPickedTeamName: string | null;
  mostPickedConference: string | null;
};

export type FavoriteTeamTheme = {
  teamId: string;
  name?: string;
  shortName?: string;
  logo?: string;
  primaryColor?: string;
  secondaryColor?: string;
};

export type LocalProfile = {
  displayName: string;
  avatarUri?: string;
  favoriteTeamId?: string;
  favoriteTeamTheme?: FavoriteTeamTheme;
};

export type FavoriteGameSnapshot = {
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
};

export type FavoriteGameSelection = {
  key: string;
  mode: GameMode;
  gameId: string;
  addedAt: string;
  snapshot?: FavoriteGameSnapshot;
};

export type TrackedBetMarketType = "moneyline" | "spread" | "total";
export type TrackedBetStatus = "open" | "settled";
export type TrackedBetResult = "open" | "win" | "loss" | "push";
export type TrackedBetSource = "live-games-pro-ev" | "in-game-odds";
export type TrackedBetSettlementSource = "auto" | "manual";

export type TrackedBetCandidate = {
  eventId: string;
  gameId?: string;
  mode: GameMode;
  sportKey?: string;
  eventLabel: string;
  homeTeam: string;
  awayTeam: string;
  marketType: TrackedBetMarketType;
  marketLabel: string;
  side: string;
  linePoint?: number;
  americanOdds: number;
  source: TrackedBetSource;
};

export type TrackedProEvBet = {
  key: string;
  eventId: string;
  gameId?: string;
  mode: GameMode;
  sportKey?: string;
  eventLabel: string;
  homeTeam: string;
  awayTeam: string;
  marketType: TrackedBetMarketType;
  marketLabel: string;
  side: string;
  linePoint?: number;
  americanOdds: number;
  stake: number;
  status: TrackedBetStatus;
  result: TrackedBetResult;
  source: TrackedBetSource;
  createdAt: string;
  updatedAt: string;
  settledAt?: string;
  settlementSource?: TrackedBetSettlementSource;
};

export type TrackedBetGameSnapshot = {
  mode: GameMode;
  gameId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore?: number | null;
  awayScore?: number | null;
  gameStatus: PredictionGameStatus;
  updatedAt: string;
};

export type ToggleFavoriteGameInput = {
  mode: GameMode;
  gameId: string;
  snapshot?: FavoriteGameSnapshot;
  addedAt?: string;
};

export function buildFavoriteGameKey(mode: GameMode, gameId: string): string {
  return `${mode}:${gameId.trim()}`;
}

export type ProfileState = {
  profile: LocalProfile;
  predictions: GamePrediction[];
  favoriteGames: FavoriteGameSelection[];
  trackedBets: TrackedProEvBet[];
};

export type PredictionGameSnapshot = {
  mode: GameMode;
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  gameDate: string;
  conference?: string;
  gameStatus: PredictionGameStatus;
  actualWinnerTeamId?: string;
};

export type ProfileAction =
  | { type: "HYDRATE"; payload: ProfileState }
  | { type: "SET_DISPLAY_NAME"; payload: string }
  | { type: "SET_FAVORITE_TEAM"; payload?: FavoriteTeamTheme }
  | { type: "UPSERT_PREDICTION"; payload: GamePrediction }
  | { type: "SYNC_PREDICTIONS"; payload: PredictionGameSnapshot[] }
  | { type: "TOGGLE_GAME_FAVORITE"; payload: ToggleFavoriteGameInput }
  | { type: "TOGGLE_TRACKED_BET"; payload: TrackedBetCandidate }
  | { type: "UPDATE_TRACKED_BET_STAKE"; payload: { key: string; stake: number } }
  | {
      type: "SET_TRACKED_BET_RESULT";
      payload: {
        key: string;
        result: TrackedBetResult;
        settlementSource?: TrackedBetSettlementSource;
      };
    }
  | { type: "SYNC_TRACKED_BETS"; payload: TrackedBetGameSnapshot[] };
