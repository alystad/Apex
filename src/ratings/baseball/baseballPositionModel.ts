import type { BaseballImpactEngineConfig, BaseballImpactRole } from "@/src/ratings/baseball/types";

export const DEFAULT_HITTER_POSITION_MULTIPLIERS: Record<string, number> = {
  C: 1.12,
  SS: 1.1,
  "2B": 1.06,
  CF: 1.05,
  "3B": 1.03,
  LF: 1,
  RF: 1,
  "1B": 0.98,
  DH: 0.94,
  P: 1,
};

export const DEFAULT_DEFENSE_POSITION_WEIGHTS: Record<string, number> = {
  C: 1.15,
  SS: 1.15,
  "2B": 1.15,
  CF: 1.15,
  "3B": 1.05,
  LF: 1.05,
  RF: 1.05,
  "1B": 0.95,
  DH: 0.85,
  P: 1,
};

export const DEFAULT_PITCHER_ROLE_MULTIPLIERS = {
  STARTER: 1.08,
  RELIEVER: 1,
} as const;

export const DEFAULT_BASEBALL_IMPACT_CONFIG: BaseballImpactEngineConfig = {
  hitterPositionMultipliers: DEFAULT_HITTER_POSITION_MULTIPLIERS,
  defensePositionWeights: DEFAULT_DEFENSE_POSITION_WEIGHTS,
  pitcherRoleMultipliers: DEFAULT_PITCHER_ROLE_MULTIPLIERS,
};

const POSITION_ALIASES: Record<string, string> = {
  CATCHER: "C",
  C: "C",
  SS: "SS",
  SHORTSTOP: "SS",
  "2B": "2B",
  SECOND: "2B",
  SECOND_BASE: "2B",
  "3B": "3B",
  THIRD: "3B",
  THIRD_BASE: "3B",
  "1B": "1B",
  FIRST: "1B",
  FIRST_BASE: "1B",
  LF: "LF",
  RF: "RF",
  CF: "CF",
  OF: "CF",
  INF: "2B",
  DH: "DH",
  UTIL: "DH",
  PH: "DH",
  PR: "DH",
  P: "P",
  SP: "P",
  RP: "P",
};

export function normalizeBaseballPosition(position?: string | null): string {
  const raw = (position ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!raw) {
    return "DH";
  }
  return POSITION_ALIASES[raw] ?? raw.replace(/_/g, "");
}

export function getHitterPositionMultiplier(
  position?: string | null,
  config: BaseballImpactEngineConfig = DEFAULT_BASEBALL_IMPACT_CONFIG,
): number {
  const normalized = normalizeBaseballPosition(position);
  return config.hitterPositionMultipliers[normalized] ?? 1;
}

export function getDefensePositionWeight(
  position?: string | null,
  config: BaseballImpactEngineConfig = DEFAULT_BASEBALL_IMPACT_CONFIG,
): number {
  const normalized = normalizeBaseballPosition(position);
  return config.defensePositionWeights[normalized] ?? 1;
}

export function getPitcherRoleMultiplier(
  role: BaseballImpactRole,
  config: BaseballImpactEngineConfig = DEFAULT_BASEBALL_IMPACT_CONFIG,
): number {
  if (role === "STARTER") {
    return config.pitcherRoleMultipliers.STARTER;
  }
  if (role === "RELIEVER" || role === "TWO_WAY") {
    return config.pitcherRoleMultipliers.RELIEVER;
  }
  return 1;
}
