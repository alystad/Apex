import type {
  BaseballRoleDistribution,
  BaseballRoleDistributions,
  BaseballRoleDistributionSet,
  BaseballImpactRole,
} from "@/src/ratings/baseball/types";
import { clamp, roundTo2, safeDivide } from "@/src/ratings/baseball/baseballImpactFormulas";

type MetricSeed = {
  role: BaseballImpactRole;
  sampleValue: number;
  minimumSampleMet: boolean;
  offense: number;
  pitching: number;
  defense: number;
  clutch: number;
  overall: number;
};

const DEFAULT_ROLE_DISTRIBUTIONS: BaseballRoleDistributions = {
  HITTER: {
    offense: { mean: 1.4, stdDev: 1.05, count: 0, fallback: true },
    pitching: { mean: 0, stdDev: 0.4, count: 0, fallback: true },
    defense: { mean: 0.02, stdDev: 0.18, count: 0, fallback: true },
    clutch: { mean: 0.03, stdDev: 0.12, count: 0, fallback: true },
    overall: { mean: 1.35, stdDev: 1.1, count: 0, fallback: true },
  },
  STARTER: {
    offense: { mean: 0, stdDev: 0.4, count: 0, fallback: true },
    pitching: { mean: 0.2, stdDev: 0.4, count: 0, fallback: true },
    defense: { mean: 0, stdDev: 0.1, count: 0, fallback: true },
    clutch: { mean: 0.02, stdDev: 0.1, count: 0, fallback: true },
    overall: { mean: 0.25, stdDev: 0.45, count: 0, fallback: true },
  },
  RELIEVER: {
    offense: { mean: 0, stdDev: 0.4, count: 0, fallback: true },
    pitching: { mean: 0.12, stdDev: 0.35, count: 0, fallback: true },
    defense: { mean: 0, stdDev: 0.1, count: 0, fallback: true },
    clutch: { mean: 0.03, stdDev: 0.11, count: 0, fallback: true },
    overall: { mean: 0.15, stdDev: 0.38, count: 0, fallback: true },
  },
  TWO_WAY: {
    offense: { mean: 1.1, stdDev: 1.05, count: 0, fallback: true },
    pitching: { mean: 0.18, stdDev: 0.45, count: 0, fallback: true },
    defense: { mean: 0.02, stdDev: 0.18, count: 0, fallback: true },
    clutch: { mean: 0.03, stdDev: 0.12, count: 0, fallback: true },
    overall: { mean: 0.8, stdDev: 0.9, count: 0, fallback: true },
  },
};

function createDistribution(values: number[], fallback: BaseballRoleDistribution): BaseballRoleDistribution {
  if (values.length < 3) {
    return fallback;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, values.length - 1);
  const stdDev = Math.sqrt(variance);

  return {
    mean: roundTo2(mean),
    stdDev: roundTo2(Math.max(0.25, stdDev)),
    count: values.length,
    fallback: false,
  };
}

function minimumSampleForRole(role: BaseballImpactRole): number {
  switch (role) {
    case "HITTER":
      return 20;
    case "STARTER":
      return 8;
    case "RELIEVER":
      return 5;
    case "TWO_WAY":
      return 12;
    default:
      return 10;
  }
}

export function buildRoleDistributions(seeds: MetricSeed[]): BaseballRoleDistributions {
  const byRole = new Map<BaseballImpactRole, MetricSeed[]>();
  seeds.forEach((seed) => {
    const rows = byRole.get(seed.role) ?? [];
    rows.push(seed);
    byRole.set(seed.role, rows);
  });

  const output = { ...DEFAULT_ROLE_DISTRIBUTIONS };
  (Object.keys(DEFAULT_ROLE_DISTRIBUTIONS) as BaseballImpactRole[]).forEach((role) => {
    const rows = (byRole.get(role) ?? []).filter(
      (seed) => seed.minimumSampleMet && seed.sampleValue >= minimumSampleForRole(role),
    );
    const fallback = DEFAULT_ROLE_DISTRIBUTIONS[role];
    output[role] = {
      offense: createDistribution(rows.map((seed) => seed.offense), fallback.offense),
      pitching: createDistribution(rows.map((seed) => seed.pitching), fallback.pitching),
      defense: createDistribution(rows.map((seed) => seed.defense), fallback.defense),
      clutch: createDistribution(rows.map((seed) => seed.clutch), fallback.clutch),
      overall: createDistribution(rows.map((seed) => seed.overall), fallback.overall),
    };
  });

  return output;
}

export function zScoreAgainstDistribution(
  value: number,
  distribution: BaseballRoleDistribution,
): number {
  return clamp(
    safeDivide(value - distribution.mean, Math.max(0.25, distribution.stdDev), 0),
    -3,
    3,
  );
}

export function sigmoidNormalize(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

export function createDistributionSeed(input: {
  role: BaseballImpactRole;
  sampleValue: number;
  offense: number;
  pitching: number;
  defense: number;
  clutch: number;
  overall: number;
}): MetricSeed {
  return {
    ...input,
    minimumSampleMet: input.sampleValue >= minimumSampleForRole(input.role),
  };
}

export function getDistributionSet(
  distributions: BaseballRoleDistributions | undefined,
  role: BaseballImpactRole,
): BaseballRoleDistributionSet {
  return distributions?.[role] ?? DEFAULT_ROLE_DISTRIBUTIONS[role];
}
