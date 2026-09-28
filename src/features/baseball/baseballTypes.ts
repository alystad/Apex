export type BaseballHalfInning = "top" | "bottom" | "middle" | "end" | "pregame" | "final" | "unknown";

export type BaseballBaseOccupancy = {
  first: boolean;
  second: boolean;
  third: boolean;
};

export type BaseballGameSituation = {
  inning: number | null;
  half: BaseballHalfInning;
  label: string;
  outs: number | null;
  balls: number | null;
  strikes: number | null;
  bases: BaseballBaseOccupancy;
};

export type BaseballRheLine = {
  runs: string;
  hits: string;
  errors: string;
};

export type BaseballScoreboardSnapshot = {
  inningLabel: string;
  situation: BaseballGameSituation | null;
  away: BaseballRheLine;
  home: BaseballRheLine;
};

export type BaseballBattingLine = {
  atBats: number;
  runs: number;
  hits: number;
  runsBattedIn: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  doubles: number;
  triples: number;
  stolenBases: number;
  caughtStealing?: number;
  hitByPitch?: number;
  sacrificeFlies?: number;
  plateAppearances?: number;
  battingAverage: number | null;
  onBasePct: number | null;
  sluggingPct: number | null;
  ops: number | null;
};

export type BaseballPitchingLine = {
  inningsPitched: number;
  hitsAllowed: number;
  runsAllowed: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
  homeRunsAllowed: number;
  pitches: number;
  strikes: number;
  hitBatters?: number;
  appearances?: number;
  gamesStarted?: number;
  era: number | null;
  whip: number | null;
};

export type BaseballFieldingLine = {
  putouts: number;
  assists: number;
  errors: number;
  doublePlays?: number;
  passedBalls?: number;
  caughtStealing?: number;
  fieldingPct: number | null;
};

export type BaseballPlayerRole = "batter" | "pitcher" | "two-way" | "unknown";

export type BaseballPlayerCardData = {
  role: BaseballPlayerRole;
  batting: BaseballBattingLine | null;
  pitching: BaseballPitchingLine | null;
  fielding: BaseballFieldingLine | null;
  primaryLine: string;
  secondaryLine: string;
  impactRating?: number | null;
  seasonAverageRating?: number | null;
  impactShare?: number | null;
  confidence?: number | null;
  impactRole?: string | null;
  trendDelta?: number | null;
  breakdown?: Array<{
    label: string;
    value: number;
    weight: number;
    detail?: string;
  }>;
};

export type BaseballRatingBreakdownItem = {
  key: string;
  label: string;
  value: number;
  displayValue: string;
  positive: boolean;
};

export type BaseballRatingResult = {
  rating: number;
  delta: number | null;
  breakdown: BaseballRatingBreakdownItem[];
};
