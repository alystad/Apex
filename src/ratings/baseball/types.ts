import type {
  BaseballBattingLine,
  BaseballFieldingLine,
  BaseballPitchingLine,
} from "@/src/features/baseball/baseballTypes";

export type BaseballImpactRole = "HITTER" | "STARTER" | "RELIEVER" | "TWO_WAY";

export type BaseballImpactBreakdownItem = {
  label: string;
  value: number;
  weight: number;
  detail?: string;
};

export type BaseballImpactTrendPoint = {
  gameId: string;
  rating: number;
  date: string;
  opponent?: string;
  role?: BaseballImpactRole;
  impactShare?: number;
};

export type BaseballImpactOutput = {
  overallRating: number;
  offenseRating: number;
  pitchingRating: number;
  defenseRating: number;
  clutchRating: number;
  impactShare: number;
  role: BaseballImpactRole;
  position: string;
  confidence: number;
  breakdown: BaseballImpactBreakdownItem[];
  lastNGamesTrend: Array<{
    gameId: string;
    rating: number;
    date: string;
  }>;
};

export type BaseballGameContext = {
  gameId: string;
  date: string;
  opponent?: string;
  opponentTeamId?: string | null;
  teamRuns?: number | null;
  opponentRuns?: number | null;
  finalMargin?: number | null;
  isCloseGame?: boolean | null;
  inningNumber?: number | null;
  isLateInning?: boolean | null;
  leverageKnown?: boolean;
  starterHint?: boolean | null;
};

export type BaseballPlayerGameLog = {
  playerId: string;
  playerName: string;
  teamId: string;
  teamName?: string;
  position?: string | null;
  batting?: BaseballBattingLine | null;
  pitching?: BaseballPitchingLine | null;
  fielding?: BaseballFieldingLine | null;
  game: BaseballGameContext;
};

export type BaseballRoleDistribution = {
  mean: number;
  stdDev: number;
  count: number;
  fallback: boolean;
};

export type BaseballRoleDistributionSet = {
  offense: BaseballRoleDistribution;
  pitching: BaseballRoleDistribution;
  defense: BaseballRoleDistribution;
  clutch: BaseballRoleDistribution;
  overall: BaseballRoleDistribution;
};

export type BaseballRoleDistributions = Record<BaseballImpactRole, BaseballRoleDistributionSet>;

export type BaseballComputedGameImpact = BaseballPlayerGameLog & {
  role: BaseballImpactRole;
  pitchingRole: "STARTER" | "RELIEVER";
  normalizedPosition: string;
  plateAppearances: number;
  inningsPitched: number;
  outsRecorded: number;
  offenseRaw: number;
  pitchingRaw: number;
  defenseRaw: number;
  clutchRaw: number;
  rawIndex: number;
  offenseShare: number;
  pitchShare: number;
  impactShare: number;
  usageMultiplier: number;
  confidence: number;
  output: BaseballImpactOutput;
};

export type BaseballSeasonPlayerProfile = {
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  position: string;
  role: BaseballImpactRole;
  gamesPlayed: number;
  battingGames: number;
  pitchingAppearances: number;
  totalPlateAppearances: number;
  totalInningsPitched: number;
  totalOutsRecorded: number;
  averageImpactShare: number;
  seasonAverageRating: number;
  rollingRating: number;
  recentAverageRating: number;
  latestRating: number | null;
  trendDelta: number;
  bestGame: BaseballImpactTrendPoint | null;
  worstGame: BaseballImpactTrendPoint | null;
  output: BaseballImpactOutput;
  games: BaseballComputedGameImpact[];
};

export type BaseballLeaderboardScope =
  | "OVERALL_PLAYERS"
  | "HITTERS"
  | "PITCHERS"
  | "STARTERS"
  | "RELIEVERS"
  | "TEAM_LEADERS"
  | "POSITION";

export type BaseballLeaderboardRow = {
  playerId: string;
  playerName: string;
  teamId: string;
  team: string;
  position: string;
  role: BaseballImpactRole;
  overallRating: number;
  confidence: number;
  trendDelta: number;
  impactShare: number;
  seasonAverageRating: number;
  latestRating: number | null;
  profile: BaseballSeasonPlayerProfile;
};

export type BaseballLeaderboardOptions = {
  scope?: BaseballLeaderboardScope;
  position?: string | null;
  role?: BaseballImpactRole | null;
  teamId?: string | null;
  limit?: number;
};

export type BaseballImpactEngineConfig = {
  hitterPositionMultipliers: Record<string, number>;
  defensePositionWeights: Record<string, number>;
  pitcherRoleMultipliers: {
    STARTER: number;
    RELIEVER: number;
  };
};
