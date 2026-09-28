import {
  computeEFF,
  computeEFF40,
  defaultRatingConfig,
  possessionsUsed,
  safePer40,
  simpleOffensiveRating,
  type PlayerBoxScore,
  type RatingConfig,
  zScores,
} from "./playerRatings";

export type PlayerLiveStatsInput = {
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
  PLUS_MINUS?: number;
  SEASON_EFF40?: number | null;
};

export type PlayerLiveRatingOutput = {
  playerId: string;
  gameEFF: number;
  gameEFF40: number;
  liveBaseRaw: number;
  liveRaw: number;
  liveDisplay: number | "-";
  onCourt: boolean;
  lowSample: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
    const mapped = 10 * sigmoid(z * spreadFactor);
    return Math.round(clamp(mapped, 1, 10) * 10) / 10;
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

function toScoreRow(row: PlayerLiveStatsInput): PlayerBoxScore {
  return {
    playerId: row.playerId,
    name: row.name,
    PTS: row.PTS,
    FGM: row.FGM,
    FGA: row.FGA,
    FTM: row.FTM,
    FTA: row.FTA,
    REB: row.REB,
    AST: row.AST,
    STL: row.STL,
    BLK: row.BLK,
    TOV: row.TOV,
    PF: row.PF,
    MIN: row.MIN,
  };
}

function buildZMap<T extends { playerId: string }>(
  entries: T[],
  pick: (entry: T) => number,
): Map<string, number> {
  const values = entries.map((entry) => pick(entry));
  const zs = zScores(values);
  return new Map(entries.map((entry, index) => [entry.playerId, zs[index] ?? 0]));
}

export function computeLiveRatings(
  rows: PlayerLiveStatsInput[],
  playersOnCourt: string[],
  config: Partial<RatingConfig> = {},
): PlayerLiveRatingOutput[] {
  const cfg = { ...defaultRatingConfig, ...config };
  const onCourtSet = new Set(playersOnCourt);

  const scored = rows.map((row) => {
    const score = toScoreRow(row);
    const gameEFF = computeEFF(score);
    const gameEFF40 = computeEFF40(score);
    const possUsed = possessionsUsed(score, cfg.ftCoef);
    const minutes = Math.max(0, row.MIN || 0);
    const activityEvents =
      Math.max(0, row.FGA || 0) +
      0.5 * Math.max(0, row.FTA || 0) +
      Math.max(0, row.TOV || 0) +
      Math.max(0, row.REB || 0) +
      Math.max(0, row.AST || 0) +
      Math.max(0, row.STL || 0) +
      Math.max(0, row.BLK || 0) +
      Math.max(0, row.PF || 0);
    return {
      playerId: row.playerId,
      gameEFF,
      gameEFF40,
      possUsed,
      activityEvents,
      usagePerMin: minutes > 0 ? possUsed / minutes : 0,
      simpleORtg: simpleOffensiveRating(row.PTS, possUsed),
      foulPer40: safePer40(row.PF, minutes),
      plusMinusPer40: safePer40(row.PLUS_MINUS ?? 0, minutes),
      minutes,
      seasonEff40Prior:
        typeof row.SEASON_EFF40 === "number" && Number.isFinite(row.SEASON_EFF40)
          ? row.SEASON_EFF40
          : null,
      onCourt: onCourtSet.has(row.playerId),
    };
  });

  const normalizationGroup = scored.filter((entry) => entry.onCourt);
  const group = normalizationGroup.length > 0 ? normalizationGroup : scored;

  const usageZById = buildZMap(group, (entry) => entry.usagePerMin);
  const efficiencyZById = buildZMap(group, (entry) => entry.simpleORtg);
  const foulZById = buildZMap(group, (entry) => entry.foulPer40);
  const plusMinusZById = buildZMap(group, (entry) => entry.plusMinusPer40);

  const liveBaseRawById = new Map<string, number>();
  scored.forEach((entry) => {
    const liveBaseRaw =
      entry.gameEFF40 +
      cfg.liveUsageWeight * (usageZById.get(entry.playerId) ?? 0) +
      cfg.liveEfficiencyWeight * (efficiencyZById.get(entry.playerId) ?? 0) -
      cfg.liveFoulPenaltyWeight * (foulZById.get(entry.playerId) ?? 0) +
      cfg.livePlusMinusWeight * (plusMinusZById.get(entry.playerId) ?? 0);
    liveBaseRawById.set(entry.playerId, liveBaseRaw);
  });

  const baseline =
    group.length > 0
      ? group.reduce(
          (sum, entry) => sum + (liveBaseRawById.get(entry.playerId) ?? 0),
          0,
        ) / group.length
      : 0;

  const liveRawById = new Map<string, number>();
  const priorBlend = clamp(cfg.liveSeasonPriorBlend, 0, 1);
  scored.forEach((entry) => {
    const conf = entry.minutes / (entry.minutes + cfg.liveShrinkMinutes);
    const baseRaw = liveBaseRawById.get(entry.playerId) ?? 0;
    const prior =
      entry.seasonEff40Prior !== null ? entry.seasonEff40Prior : baseline;
    const shrinkTarget = priorBlend * prior + (1 - priorBlend) * baseline;
    const shrunk = conf * baseRaw + (1 - conf) * shrinkTarget;
    liveRawById.set(entry.playerId, shrunk);
  });

  const groupRaws = group.map((entry) => liveRawById.get(entry.playerId) ?? 0);
  const groupRatings = mapToRating10(
    groupRaws,
    cfg.spreadFactorLive,
    cfg.mappingMode,
  );
  const groupRatingById = new Map(
    group.map((entry, idx) => [entry.playerId, groupRatings[idx] ?? 1]),
  );

  const out = scored.map((entry) => {
    let rating = groupRatingById.get(entry.playerId);
    if (rating === undefined) {
      const soloRating = mapToRating10(
        [liveRawById.get(entry.playerId) ?? 0],
        cfg.spreadFactorLive,
        cfg.mappingMode,
      )[0];
      rating = soloRating ?? 1;
    }

    const lowSample = entry.minutes < cfg.liveMinFloor;
    const hasMeaningfulStats =
      entry.minutes >= cfg.liveMinFloor ||
      entry.activityEvents >= cfg.liveMeaningfulEventsMin;
    if (lowSample) {
      rating = Math.min(rating, cfg.lowSampleCap);
    }

    const liveDisplay: number | "-" = hasMeaningfulStats
      ? Number(clamp(rating, 1, 10).toFixed(2))
      : "-";

    return {
      playerId: entry.playerId,
      gameEFF: Number(entry.gameEFF.toFixed(3)),
      gameEFF40: Number(entry.gameEFF40.toFixed(3)),
      liveBaseRaw: Number((liveBaseRawById.get(entry.playerId) ?? 0).toFixed(3)),
      liveRaw: Number((liveRawById.get(entry.playerId) ?? 0).toFixed(3)),
      liveDisplay,
      onCourt: entry.onCourt,
      lowSample: lowSample || !hasMeaningfulStats,
    };
  });

  out.sort((a, b) => {
    const aScore = typeof a.liveDisplay === "number" ? a.liveDisplay : -1;
    const bScore = typeof b.liveDisplay === "number" ? b.liveDisplay : -1;
    return bScore - aScore;
  });

  return out;
}
