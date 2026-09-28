export type PlayerBoxScore = {
  playerId: string;
  name: string;
  PTS: number;
  FGM: number;
  FGA: number;
  FTM: number;
  FTA: number;
  REB: number;
  AST: number;
  STL: number;
  BLK: number;
  TOV: number;
  PF: number;
  MIN: number;
};

export type RatingConfig = {
  ftCoef: number;
  liveMinFloor: number;
  liveMeaningfulEventsMin: number;
  liveShrinkMinutes: number;
  seasonMinFloor: number;
  spreadFactorLive: number;
  spreadFactorSeason: number;
  mappingMode: "sigmoid" | "percentile";
  lowSampleCap: number;
  liveUsageWeight: number;
  liveEfficiencyWeight: number;
  liveFoulPenaltyWeight: number;
  livePlusMinusWeight: number;
  liveSeasonPriorBlend: number;
  seasonUsageWeight: number;
  seasonEfficiencyWeight: number;
  seasonFoulPenaltyWeight: number;
};

export type SeasonPlayerRatingInput = {
  playerId: string;
  name?: string;
  seasonMIN: number;
  box: {
    PTS: number;
    FGM: number;
    FGA: number;
    FTM: number;
    FTA: number;
    REB: number;
    AST: number;
    STL: number;
    BLK: number;
    TOV: number;
    PF: number;
    MIN: number;
  };
};

export type SeasonPlayerRatingOutput = {
  playerId: string;
  name: string;
  seasonEFF: number;
  seasonEFF40: number;
  seasonRaw: number;
  seasonRating10: number;
  lowSample: boolean;
};

export const defaultRatingConfig: RatingConfig = {
  ftCoef: 0.475,
  liveMinFloor: 6,
  liveMeaningfulEventsMin: 4,
  liveShrinkMinutes: 8,
  seasonMinFloor: 300,
  spreadFactorLive: 1.8,
  spreadFactorSeason: 1.6,
  mappingMode: "sigmoid",
  lowSampleCap: 6.5,
  liveUsageWeight: 0.35,
  liveEfficiencyWeight: 0.25,
  liveFoulPenaltyWeight: 0.2,
  livePlusMinusWeight: 0.2,
  liveSeasonPriorBlend: 0.45,
  seasonUsageWeight: 0.4,
  seasonEfficiencyWeight: 0.35,
  seasonFoulPenaltyWeight: 0.25,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function safePer40(value: number, minutes: number): number {
  const min = Math.max(0, finiteOrZero(minutes));
  if (min <= 0) {
    return 0;
  }
  return (finiteOrZero(value) / min) * 40;
}

export function simpleOffensiveRating(points: number, possUsed: number): number {
  const poss = Math.max(0, finiteOrZero(possUsed));
  if (poss <= 0) {
    return 0;
  }
  return (finiteOrZero(points) / poss) * 100;
}

export function zScores(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, values.length - 1);
  const std = Math.sqrt(variance);
  const safeStd = std < 1e-6 ? 1 : std;
  return values.map((value) => (value - mean) / safeStd);
}

export function computeEFF(p: PlayerBoxScore): number {
  const missedFG = finiteOrZero(p.FGA) - finiteOrZero(p.FGM);
  const missedFT = finiteOrZero(p.FTA) - finiteOrZero(p.FTM);
  return (
    finiteOrZero(p.PTS) +
    finiteOrZero(p.REB) +
    finiteOrZero(p.AST) +
    finiteOrZero(p.STL) +
    finiteOrZero(p.BLK) -
    (missedFG + missedFT + finiteOrZero(p.TOV))
  );
}

export function computeEFF40(p: PlayerBoxScore): number {
  return safePer40(computeEFF(p), p.MIN);
}

export function possessionsUsed(
  p: PlayerBoxScore,
  ftCoef = defaultRatingConfig.ftCoef,
): number {
  return (
    finiteOrZero(p.FGA) +
    ftCoef * finiteOrZero(p.FTA) +
    finiteOrZero(p.TOV)
  );
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function mapSigmoid(raws: number[], spreadFactor: number): number[] {
  if (raws.length === 0) {
    return [];
  }

  const mean = raws.reduce((sum, value) => sum + value, 0) / raws.length;
  const variance =
    raws.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, raws.length - 1);
  const std = Math.sqrt(variance);
  const safeStd = std < 1e-6 ? 1 : std;

  return raws.map((raw) => {
    const z = (raw - mean) / safeStd;
    const transformed = 10 * sigmoid(z * spreadFactor);
    return Math.round(clamp(transformed, 1, 10) * 10) / 10;
  });
}

function mapPercentile(raws: number[]): number[] {
  if (raws.length === 0) {
    return [];
  }
  const indexed = raws.map((raw, index) => ({ raw, index }));
  indexed.sort((a, b) => a.raw - b.raw);
  const denom = Math.max(1, raws.length - 1);

  const out = new Array<number>(raws.length).fill(5);
  indexed.forEach((entry, rankIndex) => {
    const pct = rankIndex / denom;
    const mapped = 1 + 9 * pct;
    out[entry.index] = Math.round(clamp(mapped, 1, 10) * 10) / 10;
  });
  return out;
}

function mapToRating10(
  raws: number[],
  spreadFactor: number,
  mode: RatingConfig["mappingMode"],
): number[] {
  return mode === "percentile"
    ? mapPercentile(raws)
    : mapSigmoid(raws, spreadFactor);
}

export function computeSeasonRatings(
  rows: SeasonPlayerRatingInput[],
  config: Partial<RatingConfig> = {},
): SeasonPlayerRatingOutput[] {
  const cfg = { ...defaultRatingConfig, ...config };

  const normalizedRows = rows.map((row) => {
    const minutes = Math.max(0, row.seasonMIN || row.box.MIN || 0);
    const score: PlayerBoxScore = {
      playerId: row.playerId,
      name: row.name ?? row.playerId,
      PTS: row.box.PTS,
      FGM: row.box.FGM,
      FGA: row.box.FGA,
      FTM: row.box.FTM,
      FTA: row.box.FTA,
      REB: row.box.REB,
      AST: row.box.AST,
      STL: row.box.STL,
      BLK: row.box.BLK,
      TOV: row.box.TOV,
      PF: row.box.PF,
      MIN: minutes,
    };

    const seasonEFF = computeEFF(score);
    const seasonEFF40 = computeEFF40(score);
    const possUsed = possessionsUsed(score, cfg.ftCoef);
    const usagePerMin = minutes > 0 ? possUsed / minutes : 0;
    const simpleORtg = simpleOffensiveRating(score.PTS, possUsed);
    const foulPer40 = safePer40(score.PF, minutes);
    return {
      row,
      minutes,
      name: row.name ?? row.playerId,
      seasonEFF,
      seasonEFF40,
      usagePerMin,
      simpleORtg,
      foulPer40,
      lowSample: minutes < cfg.seasonMinFloor,
    };
  });

  const usageZ = zScores(normalizedRows.map((entry) => entry.usagePerMin));
  const efficiencyZ = zScores(normalizedRows.map((entry) => entry.simpleORtg));
  const foulZ = zScores(normalizedRows.map((entry) => entry.foulPer40));

  const seasonRaws = normalizedRows.map(
    (entry, idx) =>
      entry.seasonEFF40 +
      cfg.seasonUsageWeight * (usageZ[idx] ?? 0) +
      cfg.seasonEfficiencyWeight * (efficiencyZ[idx] ?? 0) -
      cfg.seasonFoulPenaltyWeight * (foulZ[idx] ?? 0),
  );

  const ratings = mapToRating10(
    seasonRaws,
    cfg.spreadFactorSeason,
    cfg.mappingMode,
  );

  const out = normalizedRows.map((entry, idx) => {
    const capped = entry.lowSample
      ? Math.min(ratings[idx] ?? 1, cfg.lowSampleCap)
      : ratings[idx] ?? 1;
    return {
      playerId: entry.row.playerId,
      name: entry.name,
      seasonEFF: Number(entry.seasonEFF.toFixed(3)),
      seasonEFF40: Number(entry.seasonEFF40.toFixed(3)),
      seasonRaw: Number((seasonRaws[idx] ?? entry.seasonEFF40).toFixed(3)),
      seasonRating10: Number(capped.toFixed(2)),
      lowSample: entry.lowSample,
    };
  });

  out.sort((a, b) => b.seasonRating10 - a.seasonRating10);
  return out;
}
