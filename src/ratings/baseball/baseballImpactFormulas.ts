import type {
  BaseballBattingLine,
  BaseballFieldingLine,
  BaseballPitchingLine,
} from "@/src/features/baseball/baseballTypes";
import {
  DEFAULT_BASEBALL_IMPACT_CONFIG,
  getDefensePositionWeight,
  getHitterPositionMultiplier,
  getPitcherRoleMultiplier,
  normalizeBaseballPosition,
} from "@/src/ratings/baseball/baseballPositionModel";
import type {
  BaseballGameContext,
  BaseballImpactBreakdownItem,
  BaseballImpactEngineConfig,
  BaseballImpactRole,
} from "@/src/ratings/baseball/types";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function roundTo2(value: number): number {
  return Number(clamp(value, -9999, 9999).toFixed(2));
}

export function safeNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function safeAverage(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function safeDivide(value: number, by: number, fallback = 0): number {
  return by > 0 && Number.isFinite(value) && Number.isFinite(by) ? value / by : fallback;
}

export function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

export function inningsToOuts(value: number | string | null | undefined): number {
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) {
      return 0;
    }
    const [wholeRaw, partRaw] = raw.split(".");
    const whole = Number.parseInt(wholeRaw ?? "0", 10);
    const part = Number.parseInt(partRaw ?? "0", 10);
    if (!Number.isFinite(whole)) {
      return 0;
    }
    return whole * 3 + clamp(Number.isFinite(part) ? part : 0, 0, 2);
  }

  const numeric = safeNumber(value);
  const whole = Math.trunc(numeric);
  const tenth = Math.round((numeric - whole) * 10);
  if (Math.abs(numeric - (whole + tenth / 10)) < 1e-6 && tenth >= 0 && tenth <= 2) {
    return whole * 3 + tenth;
  }
  return Math.max(0, Math.round(numeric * 3));
}

export function outsToInnings(outs: number): number {
  return clamp(outs, 0, Number.MAX_SAFE_INTEGER) / 3;
}

export function derivePlateAppearances(line?: BaseballBattingLine | null): number {
  if (!line) {
    return 0;
  }
  const atBats = safeNumber(line.atBats);
  const walks = safeNumber(line.walks);
  const hitByPitch = safeNumber(line.hitByPitch);
  const sacrificeFlies = safeNumber(line.sacrificeFlies);
  const direct = safeNumber(line.plateAppearances);
  if (direct > 0) {
    return direct;
  }
  return atBats + walks + hitByPitch + sacrificeFlies;
}

export function deriveSingles(line?: BaseballBattingLine | null): number {
  if (!line) {
    return 0;
  }
  return Math.max(
    0,
    safeNumber(line.hits) -
      safeNumber(line.doubles) -
      safeNumber(line.triples) -
      safeNumber(line.homeRuns),
  );
}

export function deriveTotalBases(line?: BaseballBattingLine | null): number {
  if (!line) {
    return 0;
  }
  return (
    deriveSingles(line) +
    safeNumber(line.doubles) * 2 +
    safeNumber(line.triples) * 3 +
    safeNumber(line.homeRuns) * 4
  );
}

export function detectBaseballRole(input: {
  position?: string | null;
  totalPlateAppearances: number;
  totalOutsRecorded: number;
  pitchingAppearances: number;
  starterHintCount?: number;
}): BaseballImpactRole {
  const normalizedPosition = normalizeBaseballPosition(input.position);
  const totalInnings = outsToInnings(input.totalOutsRecorded);
  const avgInnings =
    input.pitchingAppearances > 0 ? totalInnings / input.pitchingAppearances : 0;
  const hasBatting = input.totalPlateAppearances > 0;
  const hasPitching = input.totalOutsRecorded > 0 || normalizedPosition === "P";

  if (hasBatting && hasPitching) {
    return "TWO_WAY";
  }
  if (!hasPitching) {
    return "HITTER";
  }
  return avgInnings >= 3 || safeNumber(input.starterHintCount) > 0 ? "STARTER" : "RELIEVER";
}

export function computeHitterOffenseRaw(line?: BaseballBattingLine | null): {
  value: number;
  plateAppearances: number;
  extraBaseHits: number;
  missingCoreStats: boolean;
} {
  if (!line) {
    return {
      value: 0,
      plateAppearances: 0,
      extraBaseHits: 0,
      missingCoreStats: true,
    };
  }

  const atBats = safeNumber(line.atBats);
  const hits = safeNumber(line.hits);
  const walks = safeNumber(line.walks);
  const hitByPitch = safeNumber(line.hitByPitch);
  const runsBattedIn = safeNumber(line.runsBattedIn);
  const runs = safeNumber(line.runs);
  const strikeouts = safeNumber(line.strikeouts);
  const stolenBases = safeNumber(line.stolenBases);
  const caughtStealing = safeNumber(line.caughtStealing);
  const totalBases = deriveTotalBases(line);
  const plateAppearances = derivePlateAppearances(line);
  const denominator = Math.max(1, atBats + walks + hitByPitch * 0.8);
  const hasRcParts = atBats > 0 || hits > 0 || walks > 0 || totalBases > 0;

  const runsCreated = hasRcParts
    ? ((hits + walks + hitByPitch * 0.8) * totalBases) / denominator
    : 0;

  const fallbackRaw =
    ((safeNumber(line.onBasePct) * 0.6 + safeNumber(line.sluggingPct) * 0.4) *
      Math.max(1, plateAppearances / 4)) || 0;

  const raw = hasRcParts
    ? runsCreated +
      0.04 * runsBattedIn +
      0.03 * runs -
      0.02 * strikeouts +
      0.05 * stolenBases -
      0.08 * caughtStealing
    : fallbackRaw;

  return {
    value: roundTo2(raw),
    plateAppearances,
    extraBaseHits:
      safeNumber(line.doubles) + safeNumber(line.triples) + safeNumber(line.homeRuns),
    missingCoreStats: !hasRcParts,
  };
}

export function computeDefenseRaw(
  line?: BaseballFieldingLine | null,
  position?: string | null,
  config: BaseballImpactEngineConfig = DEFAULT_BASEBALL_IMPACT_CONFIG,
): { value: number; missing: boolean } {
  if (!line) {
    return { value: 0, missing: true };
  }

  const value =
    -0.2 * safeNumber(line.errors) +
    0.005 * (safeNumber(line.putouts) + safeNumber(line.assists)) +
    0.03 * safeNumber(line.doublePlays) -
    0.08 * safeNumber(line.passedBalls) +
    0.06 * safeNumber(line.caughtStealing);

  return {
    value: roundTo2(
      clamp(value, -0.8, 0.4) * getDefensePositionWeight(position, config),
    ),
    missing: false,
  };
}

export function computePitchingRaw(
  line?: BaseballPitchingLine | null,
  role: BaseballImpactRole = "RELIEVER",
): { value: number; outsRecorded: number; missingRunFields: boolean } {
  if (!line) {
    return { value: 0, outsRecorded: 0, missingRunFields: true };
  }

  const outsRecorded = inningsToOuts(line.inningsPitched);
  const runsAllowed = safeNumber(line.runsAllowed) || safeNumber(line.earnedRuns);
  const raw =
    0.03 * outsRecorded +
    0.08 * safeNumber(line.strikeouts) -
    0.1 * safeNumber(line.walks) -
    0.06 * safeNumber(line.hitsAllowed) -
    0.18 * safeNumber(line.homeRunsAllowed) -
    0.06 * safeNumber(line.hitBatters) -
    0.22 * runsAllowed;

  const scaled = raw * (role === "STARTER" ? 1.05 : 1);
  return {
    value: roundTo2(scaled),
    outsRecorded,
    missingRunFields:
      line.runsAllowed === null ||
      line.runsAllowed === undefined ||
      (!Number.isFinite(line.runsAllowed) && !Number.isFinite(line.earnedRuns)),
  };
}

export function computeClutchRaw(input: {
  batting?: BaseballBattingLine | null;
  pitching?: BaseballPitchingLine | null;
  role: BaseballImpactRole;
  pitchingRole: "STARTER" | "RELIEVER";
  game: BaseballGameContext;
  extraBaseHits?: number;
  outsRecorded?: number;
}): { value: number; leverageKnown: boolean } {
  const finalMargin =
    typeof input.game.finalMargin === "number"
      ? Math.abs(input.game.finalMargin)
      : null;
  const highLeverage = finalMargin !== null ? finalMargin <= 2 : false;
  const leverageKnown = Boolean(
    typeof input.game.finalMargin === "number" ||
      input.game.isCloseGame !== null ||
      input.game.leverageKnown,
  );

  if (!(input.game.isCloseGame ?? highLeverage)) {
    return { value: 0, leverageKnown };
  }

  if (input.role === "HITTER" || input.role === "TWO_WAY") {
    const batting = input.batting;
    const raw =
      0.06 * safeNumber(batting?.runsBattedIn) +
      0.04 * safeNumber(input.extraBaseHits);
    return {
      value: roundTo2(clamp(raw, -0.5, 0.5)),
      leverageKnown,
    };
  }

  const runsAllowed = safeNumber(input.pitching?.runsAllowed) || safeNumber(input.pitching?.earnedRuns);
  if (input.pitchingRole === "RELIEVER" && runsAllowed <= 0 && (input.game.isLateInning ?? true)) {
    return { value: 0.15, leverageKnown };
  }
  if (runsAllowed >= 2) {
    return { value: -0.1, leverageKnown };
  }
  return { value: 0, leverageKnown };
}

export function computeUsageMultiplier(
  role: BaseballImpactRole,
  plateAppearances: number,
  inningsPitched: number,
): number {
  if (role === "HITTER") {
    return clamp(Math.sqrt(Math.max(0, plateAppearances) / 60), 0.55, 1.15);
  }
  if (role === "TWO_WAY") {
    const hitterUsage = clamp(Math.sqrt(Math.max(0, plateAppearances) / 60), 0.55, 1.15);
    const pitcherUsage = clamp(Math.sqrt(Math.max(0, inningsPitched) / 20), 0.55, 1.15);
    return roundTo2((hitterUsage + pitcherUsage) / 2);
  }
  return clamp(Math.sqrt(Math.max(0, inningsPitched) / 20), 0.55, 1.15);
}

export function computeGameUsageMultiplier(
  role: BaseballImpactRole,
  plateAppearances: number,
  inningsPitched: number,
): number {
  if (role === "HITTER") {
    return clamp(Math.sqrt(Math.max(0, plateAppearances) / 5), 0.55, 1.15);
  }
  if (role === "TWO_WAY") {
    const hitterUsage = clamp(Math.sqrt(Math.max(0, plateAppearances) / 5), 0.55, 1.15);
    const pitcherUsage = clamp(Math.sqrt(Math.max(0, inningsPitched) / 6), 0.55, 1.15);
    return roundTo2((hitterUsage + pitcherUsage) / 2);
  }
  return clamp(Math.sqrt(Math.max(0, inningsPitched) / 6), 0.55, 1.15);
}

export function computeConfidence(input: {
  role: BaseballImpactRole;
  plateAppearances: number;
  inningsPitched: number;
  missingCoreStats: boolean;
  missingRunFields: boolean;
  missingDefense: boolean;
  leverageKnown: boolean;
}): number {
  const base =
    input.role === "HITTER"
      ? 0.35 + 0.65 * Math.min(1, input.plateAppearances / 120)
      : input.role === "TWO_WAY"
        ? 0.35 +
          0.325 * Math.min(1, input.plateAppearances / 120) +
          0.325 * Math.min(1, input.inningsPitched / 35)
        : 0.35 + 0.65 * Math.min(1, input.inningsPitched / 35);

  let confidence = base;
  if (input.missingCoreStats) {
    confidence -= 0.1;
  }
  if (input.missingRunFields) {
    confidence -= 0.15;
  }
  if (input.missingDefense) {
    confidence -= 0.05;
  }
  if (!input.leverageKnown) {
    confidence -= 0.03;
  }
  return roundTo2(clamp(confidence, 0.15, 1));
}

export function subratingFromZ(z: number): number {
  return roundTo2(clamp(5 + 2.2 * z, 0, 10));
}

export function overallRatingFromImpact01(value: number): number {
  return roundTo2(clamp(2 + 8 * clamp(value, 0, 1), 0, 10));
}

export function buildBreakdownItems(input: {
  role: BaseballImpactRole;
  position: string;
  offenseRating: number;
  pitchingRating: number;
  defenseRating: number;
  clutchRating: number;
  impactShare: number;
  confidence: number;
  usageMultiplier: number;
  config?: BaseballImpactEngineConfig;
}): BaseballImpactBreakdownItem[] {
  const config = input.config ?? DEFAULT_BASEBALL_IMPACT_CONFIG;
  const hitterPositionMultiplier = getHitterPositionMultiplier(input.position, config);
  const pitcherMultiplier = getPitcherRoleMultiplier(input.role, config);
  const items: BaseballImpactBreakdownItem[] = [];

  if (input.role === "HITTER" || input.role === "TWO_WAY") {
    items.push({
      label: "Offense",
      value: input.offenseRating,
      weight: 0.68,
      detail: "Runs created and efficient production.",
    });
    items.push({
      label: "Defense",
      value: input.defenseRating,
      weight: 0.22,
      detail: `Position-adjusted for ${normalizeBaseballPosition(input.position)} defense.`,
    });
  }

  if (input.role === "STARTER" || input.role === "RELIEVER" || input.role === "TWO_WAY") {
    items.push({
      label: "Pitching",
      value: input.pitchingRating,
      weight: input.role === "TWO_WAY" ? 0.5 : 0.88,
      detail: "Run prevention, workload, and damage avoidance.",
    });
  }

  items.push({
    label: "Clutch",
    value: input.clutchRating,
    weight:
      input.role === "HITTER"
        ? 0.1
        : input.role === "TWO_WAY"
          ? 0.08
          : 0.12,
    detail: "High-leverage impact in close games.",
  });
  items.push({
    label: "Impact Share",
    value: roundTo2(input.impactShare * 10),
    weight: 0.15,
    detail: "Share of team offense or run prevention.",
  });
  items.push({
    label: "Usage",
    value: roundTo2(input.usageMultiplier * 10),
    weight: 0.1,
    detail: "Sample and workload adjustment.",
  });
  items.push({
    label: "Position Value",
    value: roundTo2(
      (input.role === "HITTER" || input.role === "TWO_WAY"
        ? hitterPositionMultiplier
        : pitcherMultiplier) * 10,
    ),
    weight: 0.06,
    detail:
      input.role === "HITTER" || input.role === "TWO_WAY"
        ? "Premium defensive positions gain a slight edge."
        : "Starter workload receives a modest bonus.",
  });
  items.push({
    label: "Confidence",
    value: roundTo2(input.confidence * 10),
    weight: 0.05,
    detail: "Higher sample and cleaner data increase trust.",
  });

  return items;
}

export function combineHitterImpact01(input: {
  offenseRating: number;
  defenseRating: number;
  clutchRating: number;
  usageMultiplier: number;
  position: string;
  config?: BaseballImpactEngineConfig;
}): number {
  const config = input.config ?? DEFAULT_BASEBALL_IMPACT_CONFIG;
  const defenseWeight = getDefensePositionWeight(input.position, config);
  const positionMultiplier = getHitterPositionMultiplier(input.position, config);

  const impact01 =
    0.68 * (input.offenseRating / 10) +
    0.22 * clamp((input.defenseRating * defenseWeight) / 10, 0, 1) +
    0.1 * (input.clutchRating / 10);

  return clamp(impact01 * input.usageMultiplier * positionMultiplier, 0, 1);
}

export function combinePitcherImpact01(input: {
  pitchingRating: number;
  clutchRating: number;
  role: BaseballImpactRole;
  usageMultiplier: number;
  config?: BaseballImpactEngineConfig;
}): number {
  const config = input.config ?? DEFAULT_BASEBALL_IMPACT_CONFIG;
  const roleMultiplier = getPitcherRoleMultiplier(input.role, config);
  const impact01 =
    0.88 * (input.pitchingRating / 10) + 0.12 * (input.clutchRating / 10);
  return clamp(impact01 * input.usageMultiplier * roleMultiplier, 0, 1);
}
