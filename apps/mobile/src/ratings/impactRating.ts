import { computeScoringLeadershipMultiplier } from "../../../../src/lib/ratings/scoringLeadership";

export type PlayerBox = {
  playerId: string;
  minutes: number;
  points: number;
  fga: number;
  fgm: number;
  fta: number;
  ftm: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
};

export type GameContext = {
  period: number;
  clockSec: number;
  homeScore: number;
  awayScore: number;
  possessionTeamId?: string;
  isCloseGame?: boolean;
  isClutch?: boolean;
  leadChangedOnPlay?: boolean;
  /**
   * How many regulation periods this league plays (2 for NCAA halves, 4 for
   * NBA quarters). Used to define "final regulation period or later" for the
   * clutch window in a mode-aware way. Defaults to IMPACT_THRESHOLDS.clutchPeriodMin.
   */
  regulationPeriods?: number;
};

export type PbpEvent = {
  id: string;
  type: string;
  teamId?: string;
  playerId?: string;
  player2Id?: string;
  points?: number;
  made?: boolean;
  shotType?: "2PT" | "3PT" | "FT";
  clockSec: number;
  period: number;
  description: string;
  homeScore: number;
  awayScore: number;
};

export type PlayerImpact = {
  playerId: string;
  rating: number;
  rawImpact: number;
  lastMeaningfulImpact?: {
    eventId: string;
    description: string;
    period: number;
    clockSec: number;
    ratingBefore: number;
    ratingAfter: number;
    delta: number;
    displayRatingBefore?: number | null;
    displayRatingAfter?: number | null;
    displayDelta?: number | null;
  };
};

declare const require: (id: string) => unknown;

export const IMPACT_THRESHOLDS = {
  closeGameMargin: 8,
  clutchClockSec: 5 * 60,
  clutchPeriodMin: 2,
  closeGameMultiplier: 1.04,
  clutchMultiplier: 1.08,
  leadChangeMultiplier: 1.06,
  contextMaxMultiplier: 1.22,
  meaningfulDeltaThreshold: 0.1,
} as const;

export const COLD_START_THRESHOLDS = {
  defaultBaselineRating: 5.0,
  minMinutesForLive: 0.5,
} as const;
const REGULATION_PERIOD_SECONDS = 12 * 60;
const OVERTIME_PERIOD_SECONDS = 5 * 60;

export type WinImpactModelCoefficients = {
  intercept: number;
  pointsPerPoss: number;
  assistPerPoss: number;
  orebPerPoss: number;
  drebPerPoss: number;
  stealPerPoss: number;
  blockPerPoss: number;
  turnoverPerPoss: number;
  foulPerPoss: number;
  missedFgPerPoss: number;
  missedFtPerPoss: number;
  fgPct: number;
  ftPct: number;
  fgVolumePenaltyWeight: number;
  fgVolumePenaltyBaseline: number;
  closeGameBonus: number;
  clutchBonus: number;
  leadChangeBonus: number;
  defenseCloseInteraction: number;
  defenseClutchInteraction: number;
  defenseLeadInteraction: number;
  turnoverClosePenalty: number;
  turnoverClutchPenalty: number;
  foulClutchPenalty: number;
  reliabilityMinutesScale: number;
  reliabilityFloor: number;
  ratingCenter: number;
  ratingScale: number;
  topEndPressure: number;
  topEndStart: number;
  excellenceBoostMax: number;
  excellenceBoostCenter: number;
  excellenceBoostScale: number;
};

// IMPACT ONLY. Clutch context = final regulation period (or OT), late clock,
// close score. In this window a play's marginal impact is weighted by
// `multiplier` (positive AND negative), applied once as an event-derived term.
// Momentum has its OWN clutch config in momentumWeights.json — the two never
// share values so the metrics stay fully independent.
export type ImpactClutchConfig = {
  multiplier: number;
  clockSec: number;
  marginMax: number;
};

export type WinImpactWeightsFile = {
  schemaVersion: string;
  trainedAt: string;
  trainingWindow: string;
  refreshCadence: string;
  coefficients: WinImpactModelCoefficients;
  clutch?: ImpactClutchConfig;
};

const FALLBACK_IMPACT_CLUTCH: ImpactClutchConfig = {
  multiplier: 1.6,
  clockSec: 5 * 60,
  marginMax: 8,
};

const FALLBACK_WIN_IMPACT_WEIGHTS: WinImpactWeightsFile = {
  schemaVersion: "win-impact-v1",
  trainedAt: "2026-02-20",
  trainingWindow: "2024-25 to 2025-26",
  refreshCadence: "monthly_in_season",
  coefficients: {
    intercept: 0,
    pointsPerPoss: 1.25,
    assistPerPoss: 0.95,
    orebPerPoss: 0.9,
    drebPerPoss: 0.65,
    stealPerPoss: 1.6,
    blockPerPoss: 1.35,
    turnoverPerPoss: -1.85,
    foulPerPoss: -0.45,
    missedFgPerPoss: -0.85,
    missedFtPerPoss: -0.4,
    fgPct: 1.25,
    ftPct: 0.35,
    fgVolumePenaltyWeight: 0.16,
    fgVolumePenaltyBaseline: 0.52,
    closeGameBonus: 0.06,
    clutchBonus: 0.22,
    leadChangeBonus: 0.06,
    defenseCloseInteraction: 0,
    defenseClutchInteraction: 0,
    defenseLeadInteraction: 0,
    turnoverClosePenalty: -0.18,
    turnoverClutchPenalty: -0.28,
    foulClutchPenalty: -0.08,
    reliabilityMinutesScale: 12,
    reliabilityFloor: 0,
    ratingCenter: 8,
    ratingScale: 13,
    topEndPressure: 1.55,
    topEndStart: 8.5,
    excellenceBoostMax: 1.22,
    excellenceBoostCenter: 9.72,
    excellenceBoostScale: 1.55,
  },
  clutch: {
    multiplier: 1.6,
    clockSec: 5 * 60,
    marginMax: 8,
  },
};

function parseWinImpactWeights(input: unknown): WinImpactWeightsFile | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const file = input as Partial<WinImpactWeightsFile>;
  if (!file.coefficients || typeof file.coefficients !== "object") {
    return null;
  }
  const coeff = file.coefficients as Partial<WinImpactModelCoefficients>;
  const required: Array<keyof WinImpactModelCoefficients> = [
    "intercept",
    "pointsPerPoss",
    "assistPerPoss",
    "orebPerPoss",
    "drebPerPoss",
    "stealPerPoss",
    "blockPerPoss",
    "turnoverPerPoss",
    "foulPerPoss",
    "missedFgPerPoss",
    "missedFtPerPoss",
    "fgPct",
    "ftPct",
    "fgVolumePenaltyWeight",
    "fgVolumePenaltyBaseline",
    "closeGameBonus",
    "clutchBonus",
    "leadChangeBonus",
    "defenseCloseInteraction",
    "defenseClutchInteraction",
    "defenseLeadInteraction",
    "turnoverClosePenalty",
    "turnoverClutchPenalty",
    "foulClutchPenalty",
    "reliabilityMinutesScale",
    "reliabilityFloor",
    "ratingCenter",
    "ratingScale",
    "topEndPressure",
    "topEndStart",
    "excellenceBoostMax",
    "excellenceBoostCenter",
    "excellenceBoostScale",
  ];
  for (const key of required) {
    if (typeof coeff[key] !== "number" || !Number.isFinite(coeff[key])) {
      return null;
    }
  }
  return file as WinImpactWeightsFile;
}

function loadBundledWinImpactWeights(): WinImpactWeightsFile {
  try {
    const loaded = parseWinImpactWeights(require("./winImpactWeights.json"));
    if (loaded) {
      return loaded;
    }
  } catch {
    // Fallback to bundled defaults when json is missing/corrupt.
  }
  return FALLBACK_WIN_IMPACT_WEIGHTS;
}

const ACTIVE_WIN_IMPACT_WEIGHTS = loadBundledWinImpactWeights();

function parseImpactClutch(input: unknown): ImpactClutchConfig | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const candidate = input as Partial<ImpactClutchConfig>;
  const keys: Array<keyof ImpactClutchConfig> = ["multiplier", "clockSec", "marginMax"];
  for (const key of keys) {
    if (typeof candidate[key] !== "number" || !Number.isFinite(candidate[key])) {
      return null;
    }
  }
  return candidate as ImpactClutchConfig;
}

export const ACTIVE_IMPACT_CLUTCH: ImpactClutchConfig =
  parseImpactClutch(ACTIVE_WIN_IMPACT_WEIGHTS.clutch) ?? FALLBACK_IMPACT_CLUTCH;

export type CanonicalPbpEventType =
  | "MADE_SHOT"
  | "MISS_SHOT"
  | "MADE_FT"
  | "MISS_FT"
  | "REB_OFF"
  | "REB_DEF"
  | "ASSIST"
  | "STEAL"
  | "BLOCK"
  | "TURNOVER"
  | "FOUL"
  | "UNKNOWN";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function toCanonicalText(value: string | undefined): string {
  return (value ?? "").toLowerCase().trim();
}

export function normalizePbpType(ev: PbpEvent): CanonicalPbpEventType {
  // Events synthesized by buildImpactEventsFromPlay (e.g. the STEAL half of a
  // turnover+steal combo play) already carry an exact canonical type, but
  // share the SAME full play-text description across both derived events
  // (e.g. "... bad pass turnover (X steals)" for both the TURNOVER and
  // STEAL events). If this already-canonical type isn't matched directly, the
  // code below falls through to keyword-matching that shared description —
  // and since it checks "turnover" before "steal", the STEAL event gets
  // silently reclassified as a TURNOVER. So the already-canonical type must
  // be trusted first, uppercase, before any lowercase text heuristics run.
  const rawUpper = (ev.type ?? "").trim().toUpperCase();
  const raw = toCanonicalText(ev.type);
  const desc = toCanonicalText(ev.description);
  const text = `${raw} ${desc}`;

  if (
    rawUpper === "MADE_SHOT" ||
    rawUpper === "MISS_SHOT" ||
    rawUpper === "MADE_FT" ||
    rawUpper === "MISS_FT"
  ) {
    return rawUpper;
  }
  if (
    rawUpper === "REB_OFF" ||
    rawUpper === "REB_DEF" ||
    rawUpper === "ASSIST" ||
    rawUpper === "STEAL" ||
    rawUpper === "BLOCK"
  ) {
    return rawUpper;
  }
  if (rawUpper === "TURNOVER" || rawUpper === "FOUL") {
    return rawUpper;
  }

  if (ev.shotType === "FT" && ev.made === true) {
    return "MADE_FT";
  }
  if (ev.shotType === "FT" && ev.made === false) {
    return "MISS_FT";
  }
  if ((ev.shotType === "2PT" || ev.shotType === "3PT") && ev.made === true) {
    return "MADE_SHOT";
  }
  if ((ev.shotType === "2PT" || ev.shotType === "3PT") && ev.made === false) {
    return "MISS_SHOT";
  }

  if (text.includes("turnover")) {
    return "TURNOVER";
  }
  if (text.includes("steal")) {
    return "STEAL";
  }
  if (text.includes("assist")) {
    return "ASSIST";
  }
  if (text.includes("block")) {
    return "BLOCK";
  }
  if (text.includes("offensive rebound")) {
    return "REB_OFF";
  }
  if (text.includes("defensive rebound")) {
    return "REB_DEF";
  }
  if (text.includes("rebound")) {
    return "REB_DEF";
  }
  if (text.includes("foul")) {
    return "FOUL";
  }
  if (text.includes("free throw") && (text.includes("makes") || text.includes("made"))) {
    return "MADE_FT";
  }
  if (text.includes("free throw") && text.includes("miss")) {
    return "MISS_FT";
  }
  if (text.includes("makes") && (text.includes("jumper") || text.includes("layup") || text.includes("dunk") || text.includes("3-pt") || text.includes("three"))) {
    return "MADE_SHOT";
  }
  if (text.includes("miss") && (text.includes("jumper") || text.includes("layup") || text.includes("dunk") || text.includes("3-pt") || text.includes("three") || text.includes("shot"))) {
    return "MISS_SHOT";
  }

  return "UNKNOWN";
}

export function createEmptyPlayerBox(playerId: string): PlayerBox {
  return {
    playerId,
    minutes: 0,
    points: 0,
    fga: 0,
    fgm: 0,
    fta: 0,
    ftm: 0,
    oreb: 0,
    dreb: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    pf: 0,
  };
}

function inferMadeShotPoints(ev: PbpEvent): number {
  if (typeof ev.points === "number" && ev.points > 0) {
    return ev.points >= 3 ? 3 : 2;
  }
  if (ev.shotType === "3PT") {
    return 3;
  }
  if (ev.shotType === "2PT") {
    return 2;
  }
  const desc = toCanonicalText(ev.description);
  if (desc.includes("3-pt") || desc.includes("three")) {
    return 3;
  }
  return 2;
}

export function applyEventToBox(box: PlayerBox, ev: PbpEvent): PlayerBox {
  const next: PlayerBox = { ...box };
  const normalizedType = normalizePbpType(ev);

  switch (normalizedType) {
    case "MADE_SHOT": {
      const pts = inferMadeShotPoints(ev);
      return {
        ...next,
        fga: next.fga + 1,
        fgm: next.fgm + 1,
        points: next.points + pts,
      };
    }
    case "MISS_SHOT":
      return { ...next, fga: next.fga + 1 };
    case "MADE_FT":
      return {
        ...next,
        fta: next.fta + 1,
        ftm: next.ftm + 1,
        points: next.points + 1,
      };
    case "MISS_FT":
      return { ...next, fta: next.fta + 1 };
    case "REB_OFF":
      return {
        ...next,
        oreb: next.oreb + 1,
        reb: next.reb + 1,
      };
    case "REB_DEF":
      return {
        ...next,
        dreb: next.dreb + 1,
        reb: next.reb + 1,
      };
    case "ASSIST":
      return { ...next, ast: next.ast + 1 };
    case "STEAL":
      return { ...next, stl: next.stl + 1 };
    case "BLOCK":
      return { ...next, blk: next.blk + 1 };
    case "TURNOVER":
      return { ...next, tov: next.tov + 1 };
    case "FOUL":
      return { ...next, pf: next.pf + 1 };
    default:
      return next;
  }
}

function estimatePossessions(box: PlayerBox): number {
  const est = box.fga + 0.44 * box.fta + box.tov - box.oreb;
  return Math.max(1, est);
}

function estimateGameElapsedMinutes(ctx: GameContext): number {
  const period = Math.max(1, Math.floor(ctx.period || 1));
  if (period <= 4) {
    const periodSeconds =
      ctx.clockSec > REGULATION_PERIOD_SECONDS ? 20 * 60 : REGULATION_PERIOD_SECONDS;
    const clockSec = clamp(ctx.clockSec, 0, periodSeconds);
    return (
      ((period - 1) * periodSeconds +
        (periodSeconds - clockSec)) /
      60
    );
  }
  const clockSec = clamp(ctx.clockSec, 0, OVERTIME_PERIOD_SECONDS);
  return (
    (4 * REGULATION_PERIOD_SECONDS +
      (period - 5) * OVERTIME_PERIOD_SECONDS +
      (OVERTIME_PERIOD_SECONDS - clockSec)) /
    60
  );
}

function getActivityEvents(box: PlayerBox): number {
  return (
    box.fga +
    0.5 * box.fta +
    box.tov +
    box.reb +
    box.ast +
    box.stl +
    box.blk +
    box.pf
  );
}

function getContextFlags(ctx: GameContext): {
  closeGame: boolean;
  clutch: boolean;
  leadChange: boolean;
} {
  const closeGame =
    typeof ctx.isCloseGame === "boolean"
      ? ctx.isCloseGame
      : Math.abs(ctx.homeScore - ctx.awayScore) <= IMPACT_THRESHOLDS.closeGameMargin;
  const clutch =
    typeof ctx.isClutch === "boolean"
      ? ctx.isClutch
      : ctx.period >= IMPACT_THRESHOLDS.clutchPeriodMin &&
        ctx.clockSec <= IMPACT_THRESHOLDS.clutchClockSec;

  return {
    closeGame,
    clutch,
    leadChange: Boolean(ctx.leadChangedOnPlay),
  };
}

function getContextMultiplier(ctx: GameContext): number {
  const flags = getContextFlags(ctx);
  let mult = 1;
  if (flags.closeGame) {
    mult *= IMPACT_THRESHOLDS.closeGameMultiplier;
  }
  if (flags.clutch) {
    mult *= IMPACT_THRESHOLDS.clutchMultiplier;
  }
  if (flags.leadChange) {
    mult *= IMPACT_THRESHOLDS.leadChangeMultiplier;
  }
  return clamp(mult, 1, IMPACT_THRESHOLDS.contextMaxMultiplier);
}

function getEventReasonTags(ev: PbpEvent, ctx: GameContext): string[] {
  const tags: string[] = [];
  const eventType = normalizePbpType(ev);
  if (eventType === "MADE_SHOT") {
    tags.push(inferMadeShotPoints(ev) >= 3 ? "3PT" : "2PT");
  } else if (eventType === "MADE_FT" || eventType === "MISS_FT") {
    tags.push("FT");
  } else if (eventType !== "UNKNOWN") {
    tags.push(eventType);
  }

  const flags = getContextFlags(ctx);
  if (flags.closeGame) {
    tags.push("CLOSE");
  }
  if (flags.clutch) {
    tags.push("CLUTCH");
  }
  if (flags.leadChange) {
    tags.push("LEAD_CHANGE");
  }
  return tags;
}

function withReasonTags(description: string, tags: string[]): string {
  if (tags.length === 0) {
    return description;
  }
  return `${description} [${tags.join("|")}]`;
}

function getEliteScoringFloor(box: PlayerBox): number {
  if (box.points >= 50) return 9.7;
  if (box.points >= 40) return 9.5;
  const fgPct = box.fga > 0 ? box.fgm / box.fga : 0;
  if (box.points >= 35 && fgPct > 0.6) return 9.2;
  return 0;
}

function impactToRating(rawImpact: number, box: PlayerBox, coefficients: WinImpactModelCoefficients): number {
  const eliteScoringFloor = getEliteScoringFloor(box);

  if (rawImpact < 0) {
    const negativeRating = 5 + 2.5 * Math.tanh(rawImpact / 6);
    if (rawImpact < -20) {
      const bottomPenalty = clamp((-20 - rawImpact) / 80, 0, 0.55);
      return Number(clamp(Math.max(negativeRating - bottomPenalty, eliteScoringFloor), 0, 10).toFixed(1));
    }
    return Number(clamp(Math.max(negativeRating, eliteScoringFloor), 0, 10).toFixed(1));
  }

  const baseRating =
    2 +
    7.8 *
      sigmoid(
        (rawImpact - coefficients.ratingCenter) /
          Math.max(0.1, coefficients.ratingScale),
      );
  if (baseRating <= coefficients.topEndStart) {
    return Number(clamp(Math.max(baseRating, eliteScoringFloor), 0, 10).toFixed(1));
  }

  const flattenedTop =
    coefficients.topEndStart +
    (coefficients.excellenceBoostCenter - coefficients.topEndStart) *
      (1 -
        Math.exp(
          -1 *
            (baseRating - coefficients.topEndStart) /
            Math.max(0.1, coefficients.excellenceBoostScale),
        ));

  return Number(clamp(Math.max(flattenedTop, eliteScoringFloor), 0, 9.8).toFixed(1));
}

export function rawImpactToRating(
  rawImpact: number,
  box: PlayerBox,
  coefficients: WinImpactModelCoefficients = ACTIVE_WIN_IMPACT_WEIGHTS.coefficients,
): number {
  return impactToRating(rawImpact, box, coefficients);
}

export function computeWinImpactFromBox(
  box: PlayerBox,
  ctx: GameContext,
  coefficients: WinImpactModelCoefficients = ACTIVE_WIN_IMPACT_WEIGHTS.coefficients,
): { rawImpact: number; rating: number } {
  const missedFG = Math.max(0, box.fga - box.fgm);
  const missedFT = Math.max(0, box.fta - box.ftm);
  const fgPct = box.fga > 0 ? box.fgm / box.fga : coefficients.fgVolumePenaltyBaseline;
  const ftPct = box.fta > 0 ? box.ftm / box.fta : 0.76;
  const fgEfficiencyVolumeScale = Math.min(1, Math.max(0, box.fga) / 5);
  const minutes = Math.max(0, box.minutes);
  const elapsedMinutes = Math.max(0.5, estimateGameElapsedMinutes(ctx));
  const activityEvents = getActivityEvents(box);
  const flags = getContextFlags(ctx);

  let productionScore =
    coefficients.intercept +
    box.points * coefficients.pointsPerPoss +
    box.ast * coefficients.assistPerPoss +
    box.oreb * coefficients.orebPerPoss +
    box.dreb * coefficients.drebPerPoss +
    box.stl * coefficients.stealPerPoss +
    box.blk * coefficients.blockPerPoss +
    box.tov * coefficients.turnoverPerPoss +
    box.pf * coefficients.foulPerPoss +
    missedFG * coefficients.missedFgPerPoss +
    missedFT * coefficients.missedFtPerPoss +
    box.fgm * 0.18 * fgEfficiencyVolumeScale +
    box.ftm * 0.08 +
    (box.fga > 0
      ? (fgPct - coefficients.fgVolumePenaltyBaseline) *
        box.fga *
        coefficients.fgPct *
        fgEfficiencyVolumeScale
      : 0) +
    (box.fta > 0 ? (ftPct - 0.76) * box.fta * coefficients.ftPct : 0);
  if (box.fga >= 5 && fgPct < 0.4) {
    productionScore -= (0.4 - fgPct) * box.fga * 3;
  }

  let rawImpact: number;
  if (activityEvents === 0 && minutes > 0) {
    rawImpact = -6 - minutes * 0.48 - elapsedMinutes * 0.06;
  } else {
    // IMPACT ONLY: the old time-based `elapsedFactor` (1 + 1.25/√(elapsed+1))
    // caused a producing player's rating to drift DOWN purely because the game
    // clock advanced. That was never an intended part of Impact Rating — an
    // overall game rating shouldn't decay just because time passes — so it is
    // neutralized to 1. (Idle decay is a Momentum concept; see momentum.ts.)
    const elapsedFactor = 1;
    const minuteFactor =
      productionScore >= 0
        ? clamp(Math.pow(12 / Math.max(4, minutes + 6), 0.45), 0.78, 1.38)
        : clamp(Math.pow(Math.max(4, minutes + 4) / 12, 0.5), 0.55, 1.35);
    const positiveContributions =
      box.points + box.reb + box.ast + box.stl + box.blk;
    const passivePenalty = Math.max(
      0,
      minutes * coefficients.fgVolumePenaltyWeight - positiveContributions * 0.62,
    );
    rawImpact = productionScore * elapsedFactor * minuteFactor - passivePenalty;
  }

  let contextMultiplier = 1;
  if (flags.closeGame) {
    contextMultiplier *= 1 + coefficients.closeGameBonus;
  }
  if (flags.clutch) {
    contextMultiplier *= 1 + coefficients.clutchBonus;
  }
  if (flags.leadChange) {
    contextMultiplier *= 1 + coefficients.leadChangeBonus;
  }
  const contextMagnitude = clamp(Math.abs(productionScore) / 5, 0, 1);
  rawImpact *= 1 + (contextMultiplier - 1) * contextMagnitude;
  if (flags.closeGame) {
    rawImpact += box.tov * coefficients.turnoverClosePenalty;
  }
  if (flags.clutch) {
    rawImpact +=
      box.tov * coefficients.turnoverClutchPenalty +
      box.pf * coefficients.foulClutchPenalty;
  }
  rawImpact = Number(rawImpact.toFixed(3));
  const rating = impactToRating(rawImpact, box, coefficients);

  return { rawImpact, rating };
}

export function computeImpactFromBox(
  box: PlayerBox,
  ctx: GameContext,
): { rawImpact: number; rating: number } {
  return computeWinImpactFromBox(box, ctx);
}

// ============================================================================
// CONSOLIDATED IN-GAME IMPACT RATING (Part 1.4)
// ----------------------------------------------------------------------------
// The displayed live rating used to be three separate passes reshaping each
// other's output: (1) the core box engine, (2) a scoring-leadership multiplier
// applied in the hook, and (3) a phase/model display blend also in the hook.
// They are now folded into ONE function with an explicit, inspectable factor
// breakdown. Each factor is applied exactly once, in a fixed order:
//
//   production (pure, no time decay, clutch-neutral)
//     × scoring-leadership multiplier
//     + event-derived clutch bonus (accrued by the caller across the pbp)
//     -> 0..10 model rating
//     -> cold-start phase/model display blend
//
// Momentum is NOT involved anywhere in here — it is a fully separate metric.
// ============================================================================

// IMPACT ONLY. Mode-aware clutch test: final regulation period (or any OT),
// inside the late clock, with a close score.
export function isImpactClutchContext(
  ctx: GameContext,
  config: ImpactClutchConfig = ACTIVE_IMPACT_CLUTCH,
): boolean {
  const regulationPeriods = Math.max(
    1,
    Math.floor(ctx.regulationPeriods ?? IMPACT_THRESHOLDS.clutchPeriodMin),
  );
  const inFinalPeriodOrLater = ctx.period >= regulationPeriods;
  const lateInPeriod = ctx.clockSec <= config.clockSec;
  const closeScore = Math.abs(ctx.homeScore - ctx.awayScore) <= config.marginMax;
  return inFinalPeriodOrLater && lateInPeriod && closeScore;
}

// IMPACT ONLY. The extra raw-impact weight a single play earns for happening in
// clutch. Signed: a clutch turnover/miss (negative marginal) hurts more, a
// clutch make (positive marginal) helps more. The caller accumulates these
// across the play-by-play and passes the running total into
// computeInGameImpactRating as `clutchImpactBonus`, so clutch is counted once.
export function computeClutchImpactDelta(params: {
  boxBefore: PlayerBox;
  boxAfter: PlayerBox;
  ctx: GameContext;
  config?: ImpactClutchConfig;
  coefficients?: WinImpactModelCoefficients;
}): number {
  const config = params.config ?? ACTIVE_IMPACT_CLUTCH;
  if (!isImpactClutchContext(params.ctx, config)) {
    return 0;
  }
  const coefficients = params.coefficients ?? ACTIVE_WIN_IMPACT_WEIGHTS.coefficients;
  const neutralCtx: GameContext = {
    ...params.ctx,
    isCloseGame: false,
    isClutch: false,
    leadChangedOnPlay: false,
  };
  const before = computeWinImpactFromBox(params.boxBefore, neutralCtx, coefficients).rawImpact;
  const after = computeWinImpactFromBox(params.boxAfter, neutralCtx, coefficients).rawImpact;
  return Number(((config.multiplier - 1) * (after - before)).toFixed(3));
}

// --- Cold-start display-blend helpers (relocated from useLiveGame so the whole
// Impact calculation lives in one module). Values unchanged. -----------------

export function getDisplaySampleProgress(box: PlayerBox): number {
  const minutesProgress = clamp(Math.max(0, box.minutes) / 6, 0, 1);
  const activityProgress = clamp(getActivityEvents(box) / 4, 0, 1);
  return Math.max(minutesProgress, activityProgress);
}

function getGamePhaseProgress(ctx: GameContext): number {
  const period = Math.max(1, Math.floor(ctx.period || 1));
  if (period <= 2) {
    const periodSeconds = 20 * 60;
    const clampedClockSec = clamp(ctx.clockSec, 0, periodSeconds);
    const elapsed = (period - 1) * periodSeconds + (periodSeconds - clampedClockSec);
    const total = 2 * periodSeconds;
    return clamp(elapsed / Math.max(1, total), 0, 1);
  }
  const regulationSeconds = 2 * 20 * 60;
  const overtimeSeconds = 5 * 60;
  const clampedClockSec = clamp(ctx.clockSec, 0, overtimeSeconds);
  const elapsed =
    regulationSeconds +
    (period - 3) * overtimeSeconds +
    (overtimeSeconds - clampedClockSec);
  const total = regulationSeconds + (period - 2) * overtimeSeconds;
  return clamp(elapsed / Math.max(1, total), 0, 1);
}

export function computePhasePerformanceRating(box: PlayerBox, ctx: GameContext): number {
  const missedFG = Math.max(0, box.fga - box.fgm);
  const missedFT = Math.max(0, box.fta - box.ftm);
  const netEventScore =
    1.0 * box.fgm +
    0.7 * box.ftm +
    0.7 * box.ast +
    0.8 * box.oreb +
    0.45 * box.dreb +
    1.2 * box.stl +
    1.0 * box.blk -
    0.9 * missedFG -
    0.5 * missedFT -
    1.1 * box.tov -
    0.45 * box.pf;
  const minutesProgress = clamp(Math.max(0, box.minutes) / 6, 0, 1);
  const gamePhaseProgress = getGamePhaseProgress(ctx);
  const phaseDifficulty = 0.9 + 2.2 * gamePhaseProgress + 1.2 * minutesProgress;
  const phaseRating = 5 + 2.4 * Math.tanh(netEventScore / Math.max(0.1, phaseDifficulty));
  return Number(clamp(phaseRating, 0, 10).toFixed(1));
}

function hasAnyTrackedLiveStat(box: PlayerBox): boolean {
  return getActivityEvents(box) >= 1;
}

function hasMovedOffBaseline(rating: number | null): boolean {
  if (typeof rating !== "number" || !Number.isFinite(rating)) {
    return false;
  }
  const baseline = Number(COLD_START_THRESHOLDS.defaultBaselineRating.toFixed(1));
  return Math.abs(rating - baseline) >= 0.1;
}

export function isEligibleForVisibleInGameRating(params: {
  box: PlayerBox;
  liveRating: number | null;
}): boolean {
  return hasAnyTrackedLiveStat(params.box) && hasMovedOffBaseline(params.liveRating);
}

export type InGameImpactInput = {
  box: PlayerBox;
  ctx: GameContext;
  /** Points scored by each teammate, for the scoring-leadership factor. */
  teammatePoints?: number[];
  /** Running event-derived clutch bonus (raw-impact units) from the pbp. */
  clutchImpactBonus?: number;
  coefficients?: WinImpactModelCoefficients;
};

export type InGameImpactFactors = {
  productionRaw: number;
  leadershipMultiplier: number;
  clutchBonus: number;
  modelRating: number;
  phaseRating: number;
  modelAdoption: number;
};

export type InGameImpactResult = {
  /** Authoritative raw impact after leadership + clutch. */
  rawImpact: number;
  /** 0..10 rating derived from rawImpact, before the cold-start blend. */
  modelRating: number;
  /** The value shown in the UI (phase-blended for small samples). */
  displayRating: number;
  /** Whether the rating has moved enough off baseline to be shown. */
  visible: boolean;
  factors: InGameImpactFactors;
};

export function computeInGameImpactRating(input: InGameImpactInput): InGameImpactResult {
  const coefficients = input.coefficients ?? ACTIVE_WIN_IMPACT_WEIGHTS.coefficients;

  // (1) Base production — no time decay, and clutch-neutral so clutch is
  //     applied exactly once as the event-derived term in step (3).
  const neutralCtx: GameContext = {
    ...input.ctx,
    isCloseGame: false,
    isClutch: false,
    leadChangedOnPlay: false,
  };
  const productionRaw = computeWinImpactFromBox(input.box, neutralCtx, coefficients).rawImpact;

  // (2) Scoring-leadership multiplier.
  const leadership = computeScoringLeadershipMultiplier({
    playerPoints: Math.max(0, input.box.points),
    teammatePoints: (input.teammatePoints ?? []).map((points) => Math.max(0, points)),
    fga: input.box.fga,
    fta: input.box.fta,
    tov: input.box.tov,
    points: input.box.points,
    bonusCap: 0.2,
    shareBase: 0.18,
    shareScale: 0.22,
    gapScale: 12,
    tsBaseline: 0.52,
    tsScale: 0.22,
    tovBaseline: 3,
    tovScale: 4,
    shareWeight: 0.12,
    gapWeight: 0.08,
  });
  const leadershipMultiplier = leadership.multiplier;

  // (3) Event-derived clutch bonus (already accrued by the caller).
  const clutchBonus =
    typeof input.clutchImpactBonus === "number" && Number.isFinite(input.clutchImpactBonus)
      ? input.clutchImpactBonus
      : 0;

  const rawImpact = Number((productionRaw * leadershipMultiplier + clutchBonus).toFixed(3));
  const modelRating = impactToRating(rawImpact, input.box, coefficients);

  // (4) Cold-start display blend: lean on the phase rating early, adopt the
  //     model rating as the sample grows.
  const baseline = Number(COLD_START_THRESHOLDS.defaultBaselineRating.toFixed(1));
  const minutes = Math.max(0, input.box.minutes);
  const activityEvents = getActivityEvents(input.box);
  let phaseRating = baseline;
  let modelAdoption = 1;
  let displayRating = baseline;
  if (minutes >= COLD_START_THRESHOLDS.minMinutesForLive || activityEvents >= 1) {
    phaseRating = computePhasePerformanceRating(input.box, input.ctx);
    const sampleProgress = getDisplaySampleProgress(input.box);
    const rawModelAdoption = sampleProgress * sampleProgress * sampleProgress;
    const phaseGap = Math.abs(phaseRating - baseline);
    const phaseDamp = clamp(1 - phaseGap / 3, 0.2, 1);
    modelAdoption = sampleProgress >= 1 ? 1 : rawModelAdoption * phaseDamp;
    displayRating = Number(
      clamp(phaseRating * (1 - modelAdoption) + modelRating * modelAdoption, 0, 10).toFixed(1),
    );
  } else {
    modelAdoption = 0;
  }

  const visible = isEligibleForVisibleInGameRating({ box: input.box, liveRating: displayRating });

  return {
    rawImpact,
    modelRating,
    displayRating,
    visible,
    factors: {
      productionRaw,
      leadershipMultiplier,
      clutchBonus,
      modelRating,
      phaseRating,
      modelAdoption,
    },
  };
}

export function updatePlayerImpactFromEvent(
  player: PlayerImpact,
  currentBox: PlayerBox,
  ev: PbpEvent,
  ctx: GameContext,
): { nextImpact: PlayerImpact; nextBox: PlayerBox } {
  const before = computeImpactFromBox(currentBox, ctx);
  const nextBox = applyEventToBox(currentBox, ev);
  const after = computeImpactFromBox(nextBox, ctx);
  const canonicalType = normalizePbpType(ev);
  const isMadeScoringEvent = canonicalType === "MADE_SHOT" || canonicalType === "MADE_FT";
  const nextRawImpact = isMadeScoringEvent
    ? Math.max(after.rawImpact, before.rawImpact)
    : after.rawImpact;
  const nextRating = isMadeScoringEvent
    ? Math.max(after.rating, before.rating)
    : after.rating;
  const delta = Number((nextRating - before.rating).toFixed(1));
  const reasonTags = getEventReasonTags(ev, ctx);

  const nextImpact: PlayerImpact = {
    ...player,
    playerId: currentBox.playerId,
    rating: nextRating,
    rawImpact: nextRawImpact,
  };

  if (Math.abs(delta) >= IMPACT_THRESHOLDS.meaningfulDeltaThreshold) {
    return {
      nextBox,
      nextImpact: {
        ...nextImpact,
        lastMeaningfulImpact: {
          eventId: ev.id,
          description: withReasonTags(ev.description, reasonTags),
          period: ev.period,
          clockSec: ev.clockSec,
          ratingBefore: before.rating,
          ratingAfter: nextRating,
          delta,
        },
      },
    };
  }

  return { nextImpact, nextBox };
}

export function runImpactRatingDevChecks(): {
  ok: boolean;
  checks: Record<string, boolean>;
} {
  const ctx: GameContext = {
    period: 2,
    clockSec: 240,
    homeScore: 71,
    awayScore: 68,
  };

  const solidLine: PlayerBox = {
    playerId: "solid",
    minutes: 28,
    points: 14,
    fga: 12,
    fgm: 6,
    fta: 4,
    ftm: 2,
    oreb: 2,
    dreb: 4,
    reb: 6,
    ast: 5,
    stl: 1,
    blk: 1,
    tov: 2,
    pf: 2,
  };

  const hugeLine: PlayerBox = {
    playerId: "huge",
    minutes: 36,
    points: 34,
    fga: 21,
    fgm: 12,
    fta: 11,
    ftm: 9,
    oreb: 4,
    dreb: 8,
    reb: 12,
    ast: 9,
    stl: 3,
    blk: 2,
    tov: 2,
    pf: 2,
  };

  const tinySample: PlayerBox = {
    playerId: "tiny",
    minutes: 0.5,
    points: 2,
    fga: 1,
    fgm: 1,
    fta: 0,
    ftm: 0,
    oreb: 0,
    dreb: 0,
    reb: 0,
    ast: 0,
    stl: 1,
    blk: 0,
    tov: 0,
    pf: 0,
  };

  const solid = computeImpactFromBox(solidLine, ctx).rating;
  const huge = computeImpactFromBox(hugeLine, ctx).rating;
  const tiny = computeImpactFromBox(tinySample, ctx).rating;

  const earlyQ1: GameContext = {
    period: 1,
    clockSec: 6 * 60,
    homeScore: 20,
    awayScore: 18,
  };
  const cadeLike: PlayerBox = {
    playerId: "cade-like",
    minutes: 6,
    points: 9,
    fga: 6,
    fgm: 4,
    fta: 0,
    ftm: 0,
    oreb: 0,
    dreb: 3,
    reb: 3,
    ast: 2,
    stl: 0,
    blk: 1,
    tov: 1,
    pf: 0,
  };
  const zeroContribution: PlayerBox = {
    ...createEmptyPlayerBox("zero-contribution"),
    minutes: 6,
  };
  const twoPointCameo: PlayerBox = {
    ...createEmptyPlayerBox("two-point-cameo"),
    minutes: 6,
    points: 2,
    fga: 1,
    fgm: 1,
  };
  const lateEfficientThirty: PlayerBox = {
    playerId: "late-efficient-thirty",
    minutes: 36,
    points: 34,
    fga: 22,
    fgm: 13,
    fta: 8,
    ftm: 7,
    oreb: 2,
    dreb: 6,
    reb: 8,
    ast: 6,
    stl: 2,
    blk: 1,
    tov: 2,
    pf: 2,
  };
  const harmfulLine: PlayerBox = {
    playerId: "harmful",
    minutes: 24,
    points: 5,
    fga: 15,
    fgm: 2,
    fta: 2,
    ftm: 1,
    oreb: 0,
    dreb: 2,
    reb: 2,
    ast: 1,
    stl: 0,
    blk: 0,
    tov: 6,
    pf: 4,
  };
  const lateClose: GameContext = {
    period: 4,
    clockSec: 2 * 60,
    homeScore: 98,
    awayScore: 96,
  };
  const cadeImpact = computeImpactFromBox(cadeLike, earlyQ1);
  const zeroImpact = computeImpactFromBox(zeroContribution, earlyQ1);
  const twoPointImpact = computeImpactFromBox(twoPointCameo, earlyQ1);
  const lateEfficientThirtyRating = computeImpactFromBox(lateEfficientThirty, lateClose).rating;
  const harmfulRating = computeImpactFromBox(harmfulLine, lateClose).rating;

  const monotonicBase: PlayerBox = {
    playerId: "mono",
    minutes: 14,
    points: 8,
    fga: 9,
    fgm: 4,
    fta: 2,
    ftm: 1,
    oreb: 1,
    dreb: 3,
    reb: 4,
    ast: 2,
    stl: 0,
    blk: 0,
    tov: 1,
    pf: 1,
  };
  const baseImpact = computeImpactFromBox(monotonicBase, ctx);
  const withExtraTurnover = computeImpactFromBox(
    { ...monotonicBase, tov: monotonicBase.tov + 1 },
    ctx,
  );
  const withExtraFoul = computeImpactFromBox(
    { ...monotonicBase, pf: monotonicBase.pf + 1 },
    ctx,
  );
  const withExtraMissedFg = computeImpactFromBox(
    { ...monotonicBase, fga: monotonicBase.fga + 1 },
    ctx,
  );
  const withExtraMissedFt = computeImpactFromBox(
    { ...monotonicBase, fta: monotonicBase.fta + 1 },
    ctx,
  );

  const checks = {
    bounded:
      solid >= 0 &&
      solid <= 10 &&
      huge >= 0 &&
      huge <= 10 &&
      tiny >= 0 &&
      tiny <= 10,
    hugeAboveSolid: huge > solid,
    cadeRanksAboveZero: cadeImpact.rawImpact > zeroImpact.rawImpact,
    cadeRanksAboveTwoPointCameo: cadeImpact.rawImpact > twoPointImpact.rawImpact,
    zeroContributionBelowAverage: zeroImpact.rating < 5,
    twoPointCameoBelowCade: twoPointImpact.rating < cadeImpact.rating,
    lateThirtyApproachesElite:
      lateEfficientThirtyRating >= 9.0 && lateEfficientThirtyRating <= 9.5,
    harmfulLinePunished: harmfulRating >= 2.0 && harmfulRating <= 4.0,
    solidAboveTiny: solid > tiny,
    tinyLowSampleNotElite: tiny <= 7.0,
    plusOneTurnoverHurtsRaw: withExtraTurnover.rawImpact < baseImpact.rawImpact,
    plusOneTurnoverHurtsRating: withExtraTurnover.rating < baseImpact.rating,
    plusOneFoulHurtsRaw: withExtraFoul.rawImpact < baseImpact.rawImpact,
    plusOneFoulHurtsRating: withExtraFoul.rating < baseImpact.rating,
    plusOneMissedFgHurtsRaw: withExtraMissedFg.rawImpact < baseImpact.rawImpact,
    plusOneMissedFgHurtsRating: withExtraMissedFg.rating < baseImpact.rating,
    plusOneMissedFtHurtsRaw: withExtraMissedFt.rawImpact < baseImpact.rawImpact,
    plusOneMissedFtHurtsRating: withExtraMissedFt.rating < baseImpact.rating,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
  };
}
