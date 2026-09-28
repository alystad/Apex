/**
 * NIL (Name/Image/Likeness) valuation engine — men's college basketball.
 *
 * WHY THIS MODEL (not the On3-style formula):
 * The industry-standard approach (On3, etc.) weights social media following
 * (~30-40%), performance (~25-35%), team success/exposure (~15-20%), and
 * position/market demand. We don't have social media follower data from
 * ESPN's API and don't want to scrape it, so this uses a TOP-DOWN POOL
 * ALLOCATION model instead — which, post-House settlement, is arguably a
 * more accurate reflection of how the money actually moves anyway: schools
 * operate a fixed collective/rev-share budget and allocate it across a
 * roster, rather than each athlete having an independently-priced market
 * value.
 *
 *   NIL Value = Program Pool × Player Share × Exposure Multiplier
 *
 * Every constant below is named, commented, and exported so the model can be
 * tuned without touching the formula logic. Player-facing consumers should
 * call `computeTeamNilValues()` once per roster (not per player — it does a
 * roster-wide normalization) and read results out of the returned map.
 *
 * CALIBRATION: see `runNilCalibrationCheck()` at the bottom, which validates
 * sample rosters against real 2025-26 market anchors and flags anything
 * implausible. Run it (e.g. via a one-off `npx tsx` invocation) after
 * changing any constant here.
 */

import { colors } from "@/theme/colors";

// ============================================================================
// SECTION 1 — PROGRAM POOL
// ============================================================================

export type ConferenceTier = "power" | "groupOfFive" | "otherD1";

/**
 * Base NIL collective budget by conference tier. These are season-long
 * program-wide pool anchors, not per-player figures.
 * Source anchors (2025-26 market reporting): Power 4 collective budgets
 * average ~$13.9M, Group of 5 ~$3.4M, other Division I ~$1.2M.
 */
export const CONFERENCE_TIER_BASE_POOL: Record<ConferenceTier, number> = {
  power: 13_900_000,
  groupOfFive: 3_400_000,
  otherD1: 1_200_000,
};

/**
 * Conference name/shortName -> tier. Keyed on lowercased ESPN conference
 * `shortName`/`name` values (see LiveGameTeam.conference). Basketball-power
 * classification deliberately differs from football "Power 4": the Big East
 * has no football but is unambiguously a basketball power conference
 * (UConn, Villanova, Marquette all command real NIL money), so it's included
 * in the "power" tier here. Anything not listed defaults to "otherD1" — the
 * safest fallback for smaller/low-major programs. Edit freely; this is a
 * placeholder list, not exhaustive.
 */
export const CONFERENCE_NAME_TIER_MAP: Record<string, ConferenceTier> = {
  // Power (basketball-relevant power conferences)
  "acc": "power",
  "atlantic coast conference": "power",
  "big ten": "power",
  "big ten conference": "power",
  "big 12": "power",
  "big 12 conference": "power",
  "sec": "power",
  "southeastern conference": "power",
  "big east": "power",
  "big east conference": "power",
  // Group of Five (and basketball-competitive mid-majors)
  "american": "groupOfFive",
  "american athletic conference": "groupOfFive",
  "mountain west": "groupOfFive",
  "mountain west conference": "groupOfFive",
  "atlantic 10": "groupOfFive",
  "atlantic 10 conference": "groupOfFive",
  "west coast": "groupOfFive",
  "west coast conference": "groupOfFive",
  "conference usa": "groupOfFive",
  "mid-american conference": "groupOfFive",
  "mac": "groupOfFive",
  "sun belt": "groupOfFive",
  "sun belt conference": "groupOfFive",
  "wac": "groupOfFive",
  "western athletic conference": "groupOfFive",
  "missouri valley conference": "groupOfFive",
  "mvc": "groupOfFive",
};

function normalizeConferenceKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function getConferenceTier(
  conference: { name?: string; shortName?: string } | null | undefined,
): ConferenceTier {
  const byShortName = CONFERENCE_NAME_TIER_MAP[normalizeConferenceKey(conference?.shortName)];
  if (byShortName) {
    return byShortName;
  }
  const byName = CONFERENCE_NAME_TIER_MAP[normalizeConferenceKey(conference?.name)];
  if (byName) {
    return byName;
  }
  return "otherD1";
}

/**
 * Program prestige modifier, keyed by lowercased team display name (a
 * placeholder keying scheme — swap for a stable ESPN team ID map once you
 * have one handy). Blue-blood programs draw outsized collective donations
 * within their conference; everyone else defaults to 1.0 (neutral).
 * PLACEHOLDER VALUES — tune freely.
 */
export const PROGRAM_PRESTIGE_MODIFIER: Record<string, number> = {
  "duke": 1.5,
  "kansas": 1.45,
  "kentucky": 1.45,
  "north carolina": 1.4,
  "unc": 1.4,
  "ucla": 1.3,
  "gonzaga": 1.3,
  "villanova": 1.25,
  "indiana": 1.25,
  "michigan state": 1.25,
  "arizona": 1.2,
  "houston": 1.2,
  "uconn": 1.3,
  "connecticut": 1.3,
};

const DEFAULT_PRESTIGE_MODIFIER = 1.0;

export function getProgramPrestigeModifier(teamDisplayName: string | null | undefined): number {
  const key = normalizeConferenceKey(teamDisplayName);
  for (const [name, modifier] of Object.entries(PROGRAM_PRESTIGE_MODIFIER)) {
    if (key.includes(name)) {
      return modifier;
    }
  }
  return DEFAULT_PRESTIGE_MODIFIER;
}

/**
 * IMPORTANT SCOPING NOTE: CONFERENCE_TIER_BASE_POOL above is a SCHOOL-WIDE
 * collective budget (dominated by football at P4/G5 schools), not a
 * basketball-specific figure — confirmed via calibration below (treating it
 * as 100% basketball-dedicated blew every anchor out of the water: a Power
 * blue-blood's top player came out north of $10-17M against a real top-of-
 * market ceiling of ~$4.2M). Men's basketball gets a slice of it.
 */
export const MBB_COLLECTIVE_ALLOCATION_PCT = 0.20;

/**
 * Post-House settlement revenue-share component. Schools that opt in can
 * pay athletes directly, up to a shared cap across ALL sports (~$21.3M).
 * Men's basketball is typically a distant second to football in how that
 * cap gets allocated internally; MBB_REV_SHARE_ALLOCATION_PCT is our
 * estimate of basketball's slice. This is ADDITIVE to the NIL collective
 * pool above, not a replacement for it — the two are legally/operationally
 * distinct bodies of money.
 */
export const REV_SHARE_CAP_TOTAL = 21_300_000;

/** Placeholder — men's basketball's estimated share of the total rev-share cap. */
export const MBB_REV_SHARE_ALLOCATION_PCT = 0.15;

/**
 * Not every school participates in revenue sharing at the same rate; Power
 * conference schools are assumed to be opted in near-fully, smaller programs
 * much less so. Placeholder values.
 */
export const REV_SHARE_PARTICIPATION_RATE: Record<ConferenceTier, number> = {
  power: 1.0,
  groupOfFive: 0.5,
  otherD1: 0.1,
};

export function computeProgramPool(params: {
  conference: { name?: string; shortName?: string } | null | undefined;
  teamDisplayName: string | null | undefined;
}): { pool: number; tier: ConferenceTier; prestigeModifier: number; revShareAllocation: number } {
  const tier = getConferenceTier(params.conference);
  const prestigeModifier = getProgramPrestigeModifier(params.teamDisplayName);
  const basePool = CONFERENCE_TIER_BASE_POOL[tier] * MBB_COLLECTIVE_ALLOCATION_PCT * prestigeModifier;
  const revShareAllocation =
    REV_SHARE_CAP_TOTAL * MBB_REV_SHARE_ALLOCATION_PCT * REV_SHARE_PARTICIPATION_RATE[tier];
  return {
    pool: basePool + revShareAllocation,
    tier,
    prestigeModifier,
    revShareAllocation,
  };
}

// ============================================================================
// SECTION 2 — PLAYER SHARE
// ============================================================================

export type ClassYear = "Freshman" | "Sophomore" | "Junior" | "Senior" | "Graduate";

/**
 * Upperclassmen typically command more NIL money (proven track record,
 * established local/regional brand). NOTE: class year is not currently
 * threaded through to the Court tab's data (LiveGamePlayer has no class-year
 * field), so `classYear` is always `undefined` there today and this
 * resolves to the neutral 1.0 default. Wiring in real data later is a
 * one-line change at the call site, not a formula change.
 */
export const CLASS_YEAR_MULTIPLIER: Record<ClassYear, number> = {
  Freshman: 0.85,
  Sophomore: 0.95,
  Junior: 1.05,
  Senior: 1.15,
  Graduate: 1.15,
};

const DEFAULT_CLASS_YEAR_MULTIPLIER = 1.0;

/**
 * Guards/wings have historically commanded a premium in NIL markets
 * (ball-handling stars drive engagement); true bigs slightly discounted.
 * Placeholder values, keyed by a coarse position group.
 */
export const POSITION_SCARCITY_MULTIPLIER: Record<"G" | "F" | "C", number> = {
  G: 1.15,
  F: 1.0,
  C: 0.9,
};

const DEFAULT_POSITION_MULTIPLIER = 1.0;

function normalizePositionGroup(position: string | null | undefined): "G" | "F" | "C" | null {
  const value = (position ?? "").trim().toUpperCase();
  if (!value) return null;
  if (value.includes("G")) return "G";
  if (value.includes("C")) return "C";
  if (value.includes("F")) return "F";
  return null;
}

export function getPositionScarcityMultiplier(position: string | null | undefined): number {
  const group = normalizePositionGroup(position);
  return group ? POSITION_SCARCITY_MULTIPLIER[group] : DEFAULT_POSITION_MULTIPLIER;
}

/**
 * Rating -> raw weight curve. Ratings at/below the replacement-level floor
 * contribute ~zero share (a true bench/walk-on-caliber player); weight grows
 * as a power of (rating - floor) so stars capture disproportionate share
 * instead of an even split across the roster. Both constants were tuned
 * against `runNilCalibrationCheck()` below, not picked blind.
 */
export const RATING_REPLACEMENT_FLOOR = 4.0;
export const RATING_CURVE_EXPONENT = 2.6;

/**
 * No single player can capture more than this fraction of the pool, even a
 * dominant star — real rosters spread money across enough players to field
 * a team (scholarship/depth requirements), and pool sizes here are large
 * enough that an uncapped share would blow past real top-of-market NIL
 * deals. Excess above the cap is redistributed proportionally among the
 * remaining players (see computePlayerShares).
 */
export const MAX_PLAYER_SHARE = 0.3;

/** Small positive floor so a below-replacement player still has *some* deal. */
const MIN_RATING_WEIGHT = 0.05;

function ratingCurveWeight(seasonRating10: number | null | undefined): number {
  if (typeof seasonRating10 !== "number" || !Number.isFinite(seasonRating10)) {
    return MIN_RATING_WEIGHT;
  }
  const above = seasonRating10 - RATING_REPLACEMENT_FLOOR;
  if (above <= 0) {
    return MIN_RATING_WEIGHT;
  }
  return Math.max(MIN_RATING_WEIGHT, above ** RATING_CURVE_EXPONENT);
}

/**
 * Minutes-played modifier (secondary input — role/starter status). Bounded
 * so it nudges rather than dominates; rating already captures most of the
 * "how good/impactful" signal. Based on minutes in the most recent game as a
 * proxy for season role (season-long minutes% isn't available in this data
 * path); assumes a 40-minute game.
 */
export const MINUTES_MODIFIER_BASE = 0.7;
export const MINUTES_MODIFIER_WEIGHT = 0.3;
const REGULATION_MINUTES = 40;

function minutesModifier(minutes: number | null | undefined): number {
  const pct = Math.max(0, Math.min(1, (minutes ?? 0) / REGULATION_MINUTES));
  return MINUTES_MODIFIER_BASE + MINUTES_MODIFIER_WEIGHT * pct;
}

/**
 * Usage/involvement modifier (secondary input). True possession-based usage
 * rate isn't available in this data path, so this approximates it from box
 * score volume: (FGA + 0.44*FTA + TOV) per minute, compared against a
 * reference rate for a high-usage player. Bounded to a gentle ±15% swing.
 */
export const USAGE_SHARE_WEIGHT = 0.15;
const REFERENCE_INVOLVEMENT_PER_MIN = 0.5;
const FT_POSSESSION_COEF = 0.44;

function usageModifier(params: {
  fga?: number | null;
  fta?: number | null;
  turnovers?: number | null;
  minutes?: number | null;
}): number {
  const minutes = Math.max(1, params.minutes ?? 0);
  const involvement =
    ((params.fga ?? 0) + FT_POSSESSION_COEF * (params.fta ?? 0) + (params.turnovers ?? 0)) / minutes;
  const relative = Math.max(-1, Math.min(1, involvement / REFERENCE_INVOLVEMENT_PER_MIN - 1));
  return 1 + USAGE_SHARE_WEIGHT * relative;
}

export function getClassYearMultiplier(classYear: ClassYear | null | undefined): number {
  return classYear ? CLASS_YEAR_MULTIPLIER[classYear] : DEFAULT_CLASS_YEAR_MULTIPLIER;
}

export type NilPlayerInput = {
  playerId: string;
  seasonRating10: number | null | undefined;
  minutes: number | null | undefined;
  fga?: number | null;
  fta?: number | null;
  turnovers?: number | null;
  position?: string | null;
  classYear?: ClassYear | null;
};

export type PlayerShareBreakdown = {
  playerId: string;
  rawWeight: number;
  share: number;
};

/**
 * Computes each player's normalized share of the program pool. Shares
 * always sum to ~1.0 across the roster (softmax-style normalization), which
 * guarantees the roster total never exceeds the pool regardless of how the
 * weight function above is tuned.
 */
const SHARE_CAP_ITERATIONS = 5;

export function computePlayerShares(roster: NilPlayerInput[]): Map<string, PlayerShareBreakdown> {
  const weights = roster.map((player) => {
    const rawWeight =
      ratingCurveWeight(player.seasonRating10) *
      minutesModifier(player.minutes) *
      usageModifier(player) *
      getClassYearMultiplier(player.classYear) *
      getPositionScarcityMultiplier(player.position);
    return { playerId: player.playerId, rawWeight };
  });

  const totalWeight = weights.reduce((sum, w) => sum + w.rawWeight, 0);
  let shares = weights.map((w) => ({
    playerId: w.playerId,
    rawWeight: w.rawWeight,
    share: totalWeight > 0 ? w.rawWeight / totalWeight : 0,
  }));

  // Cap-and-redistribute: excess above MAX_PLAYER_SHARE gets spread
  // proportionally across the uncapped players. Iterate a few times in case
  // redistribution pushes another player over the cap.
  for (let iteration = 0; iteration < SHARE_CAP_ITERATIONS; iteration += 1) {
    const overCap = shares.filter((s) => s.share > MAX_PLAYER_SHARE);
    if (overCap.length === 0) break;

    let excess = 0;
    shares = shares.map((s) => {
      if (s.share > MAX_PLAYER_SHARE) {
        excess += s.share - MAX_PLAYER_SHARE;
        return { ...s, share: MAX_PLAYER_SHARE };
      }
      return s;
    });

    const uncappedTotal = shares
      .filter((s) => s.share < MAX_PLAYER_SHARE)
      .reduce((sum, s) => sum + s.share, 0);
    if (uncappedTotal > 0) {
      shares = shares.map((s) =>
        s.share < MAX_PLAYER_SHARE
          ? { ...s, share: s.share + excess * (s.share / uncappedTotal) }
          : s,
      );
    }
  }

  const result = new Map<string, PlayerShareBreakdown>();
  shares.forEach((s) => result.set(s.playerId, s));
  return result;
}

// ============================================================================
// SECTION 3 — EXPOSURE MULTIPLIER
// ============================================================================

export const EXPOSURE_MULTIPLIER_MIN = 0.85;
export const EXPOSURE_MULTIPLIER_MAX = 1.35;

/**
 * Reference range for the app's internal `seasonPower` net-rating-style
 * metric (see LiveGameTeam.ratings.seasonPower), used to derive a rough
 * "how strong/exposed is this team" percentile. This IS real, continuous
 * data (unlike the placeholder fields below) — it's already computed
 * elsewhere in the app from season results.
 */
export const SEASON_POWER_REFERENCE_RANGE = { min: -10, max: 15 };

/**
 * Everything below is placeholder/static — the data isn't wired up yet
 * (no AP poll, tournament seed, or season-long TV schedule feed exists in
 * this codebase currently). Structured as named inputs so real data can be
 * populated later without touching the formula. Each contributes a small,
 * additive bump to the exposure multiplier, capped by EXPOSURE_MULTIPLIER_MAX.
 */
export type ExposureInputs = {
  seasonPower?: number | null;
  /** Placeholder — count of nationally-televised game appearances this season. */
  nationalTvAppearances?: number;
  /** Placeholder — NCAA tournament seed (1-16), null if not applicable/unknown. */
  tournamentSeed?: number | null;
  /** Placeholder — is the team in active contention for its conference title? */
  conferenceTitleContention?: boolean;
};

export const DEFAULT_EXPOSURE_INPUTS: ExposureInputs = {
  seasonPower: null,
  nationalTvAppearances: 0,
  tournamentSeed: null,
  conferenceTitleContention: false,
};

/** Bump per national TV appearance, capped at this many counted. */
export const NATIONAL_TV_BUMP_PER_APPEARANCE = 0.01;
export const NATIONAL_TV_BUMP_MAX_APPEARANCES = 10;
/** Bump for a strong tournament seed (better seed = bigger bump). */
export const TOURNAMENT_SEED_BUMP_MAX = 0.1;
export const CONFERENCE_TITLE_CONTENTION_BUMP = 0.05;

function seasonPowerPercentileBump(seasonPower: number | null | undefined): number {
  if (typeof seasonPower !== "number" || !Number.isFinite(seasonPower)) {
    return 0;
  }
  const { min, max } = SEASON_POWER_REFERENCE_RANGE;
  const percentile = Math.max(0, Math.min(1, (seasonPower - min) / (max - min)));
  // Map [0,1] percentile to a [-0.1, +0.15] swing around neutral.
  return -0.1 + percentile * 0.25;
}

function tournamentSeedBump(seed: number | null | undefined): number {
  if (typeof seed !== "number" || seed < 1 || seed > 16) {
    return 0;
  }
  // Seed 1 -> full bump, seed 16 -> ~0.
  return TOURNAMENT_SEED_BUMP_MAX * (1 - (seed - 1) / 15);
}

export function computeExposureMultiplier(inputs: ExposureInputs = DEFAULT_EXPOSURE_INPUTS): number {
  const tvBump =
    NATIONAL_TV_BUMP_PER_APPEARANCE *
    Math.min(inputs.nationalTvAppearances ?? 0, NATIONAL_TV_BUMP_MAX_APPEARANCES);
  const seedBump = tournamentSeedBump(inputs.tournamentSeed);
  const titleBump = inputs.conferenceTitleContention ? CONFERENCE_TITLE_CONTENTION_BUMP : 0;
  const powerBump = seasonPowerPercentileBump(inputs.seasonPower);

  const raw = 1 + tvBump + seedBump + titleBump + powerBump;
  return Math.max(EXPOSURE_MULTIPLIER_MIN, Math.min(EXPOSURE_MULTIPLIER_MAX, raw));
}

// ============================================================================
// SECTION 4 — PUTTING IT TOGETHER
// ============================================================================

export type NilValuationBreakdown = {
  playerId: string;
  totalValue: number;
  pool: number;
  share: number;
  rawWeight: number;
  exposureMultiplier: number;
  conferenceTier: ConferenceTier;
};

export type NilTeamInput = {
  teamId: string;
  displayName: string | null | undefined;
  conference: { name?: string; shortName?: string } | null | undefined;
  exposureInputs?: ExposureInputs;
};

/**
 * Main entry point. Computes NIL value for every player on a roster in one
 * pass (the share normalization is roster-wide, so this should be called
 * once per team, not once per player).
 */
export function computeTeamNilValues(
  team: NilTeamInput,
  roster: NilPlayerInput[],
): Map<string, NilValuationBreakdown> {
  const { pool, tier } = computeProgramPool({
    conference: team.conference,
    teamDisplayName: team.displayName,
  });
  const exposureMultiplier = computeExposureMultiplier(team.exposureInputs);
  const shares = computePlayerShares(roster);

  const result = new Map<string, NilValuationBreakdown>();
  shares.forEach((shareBreakdown, playerId) => {
    result.set(playerId, {
      playerId,
      totalValue: pool * shareBreakdown.share * exposureMultiplier,
      pool,
      share: shareBreakdown.share,
      rawWeight: shareBreakdown.rawWeight,
      exposureMultiplier,
      conferenceTier: tier,
    });
  });
  return result;
}

// ============================================================================
// SECTION 5 — FORMATTING & COLOR (UI helpers)
// ============================================================================

export function formatNilValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "-";
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${Math.round(value / 1000)}K`;
  }
  return `$${Math.round(value)}`;
}

/** Dollar-bucketed thresholds, reusing the app's existing rating palette so
 * NIL pills stay visually consistent with the 0-10 rating pills even though
 * the underlying metric changed. */
export const NIL_COLOR_THRESHOLDS = {
  low: 50_000,
  mid: 200_000,
  high: 750_000,
};

export function getNilValueColor(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "#70819d";
  }
  if (value < NIL_COLOR_THRESHOLDS.low) {
    return colors.ratingLow;
  }
  if (value < NIL_COLOR_THRESHOLDS.mid) {
    return colors.ratingOrange;
  }
  if (value < NIL_COLOR_THRESHOLDS.high) {
    return colors.ratingMid;
  }
  return colors.ratingHigh;
}

// ============================================================================
// SECTION 6 — CALIBRATION CHECK
// ============================================================================
//
// Real 2025-26 market reference points this model should roughly agree with:
//   - Top-25 D1 men's basketball athletes average ~$349K annually
//   - Average individual men's basketball NIL deal ~$14K
//   - Top of market: ~$4.2M (AJ Dybantsa), ~$2.2M (Cameron Boozer)
//   - Total 2025-26 college basketball NIL spending ~$932.5M
// If a star player at a Power-conference school comes out at $50K or $40M,
// the weights are wrong.

export type NilCalibrationFlag = {
  scenario: string;
  playerId: string;
  value: number;
  reason: string;
};

type CalibrationRosterSpec = {
  scenario: string;
  team: NilTeamInput;
  roster: NilPlayerInput[];
};

function buildRatingRoster(ratings: number[], teamId: string): NilPlayerInput[] {
  return ratings.map((rating, index) => ({
    playerId: `${teamId}-p${index}`,
    seasonRating10: rating,
    minutes: rating >= 7 ? 30 : rating >= 5.5 ? 20 : 10,
    fga: rating >= 7 ? 12 : rating >= 5.5 ? 7 : 3,
    fta: rating >= 7 ? 4 : 2,
    turnovers: 2,
    position: index % 3 === 0 ? "G" : index % 3 === 1 ? "F" : "C",
  }));
}

/** Representative sample rosters spanning the tiers this model needs to
 * distinguish between. Ratings loosely mimic a real team: 1-2 stars, a
 * handful of solid rotation players, several bench/low-usage players. */
export const CALIBRATION_SCENARIOS: CalibrationRosterSpec[] = [
  {
    scenario: "Blue-blood Power conference (e.g. Duke)",
    team: {
      teamId: "blueblood",
      displayName: "Duke",
      conference: { shortName: "ACC" },
      exposureInputs: { seasonPower: 13, nationalTvAppearances: 8, tournamentSeed: 1 },
    },
    roster: buildRatingRoster([9.2, 8.0, 7.2, 6.8, 6.2, 5.8, 5.5, 5.0, 4.8, 4.5, 4.2, 4.0, 3.8], "blueblood"),
  },
  {
    scenario: "Mid-tier Power conference",
    team: {
      teamId: "midpower",
      displayName: "Generic Power School",
      conference: { shortName: "Big 12" },
      exposureInputs: { seasonPower: 2, nationalTvAppearances: 2 },
    },
    roster: buildRatingRoster([8.3, 7.5, 6.8, 6.3, 6.0, 5.6, 5.2, 4.9, 4.6, 4.3, 4.0, 3.7, 3.5], "midpower"),
  },
  {
    scenario: "Group of Five",
    team: {
      teamId: "g5",
      displayName: "Generic G5 School",
      conference: { shortName: "American Athletic Conference" },
      exposureInputs: { seasonPower: -2 },
    },
    roster: buildRatingRoster([7.8, 6.9, 6.2, 5.8, 5.4, 5.0, 4.8, 4.5, 4.2, 4.0, 3.8, 3.5, 3.2], "g5"),
  },
  {
    scenario: "Other Division I (low-major)",
    team: {
      teamId: "lowmajor",
      displayName: "Generic Low-Major School",
      conference: { shortName: "Unclassified Conference" },
      exposureInputs: { seasonPower: -6 },
    },
    roster: buildRatingRoster([7.0, 6.2, 5.6, 5.2, 4.9, 4.6, 4.3, 4.1, 3.9, 3.7, 3.5, 3.3, 3.0], "lowmajor"),
  },
];

/** Bounds a Power-conference star (top-3 rated player on a "power" tier
 * team) is expected to fall within. Anything outside this range means the
 * weights need retuning. */
const POWER_STAR_MIN = 100_000;
const POWER_STAR_MAX = 4_500_000;
/** Bounds a typical rotation player (mid-pack rating) should fall within. */
const TYPICAL_PLAYER_MIN = 3_000;
const TYPICAL_PLAYER_MAX = 400_000;

export function runNilCalibrationCheck(): {
  results: Array<{ scenario: string; players: NilValuationBreakdown[] }>;
  flags: NilCalibrationFlag[];
} {
  const flags: NilCalibrationFlag[] = [];
  const results = CALIBRATION_SCENARIOS.map(({ scenario, team, roster }) => {
    const valuations = computeTeamNilValues(team, roster);
    const players = roster
      .map((p) => valuations.get(p.playerId))
      .filter((v): v is NilValuationBreakdown => Boolean(v))
      .sort((a, b) => b.totalValue - a.totalValue);

    if (team.conference?.shortName && CONFERENCE_NAME_TIER_MAP[normalizeConferenceKey(team.conference.shortName)] === "power") {
      const star = players[0];
      if (star && (star.totalValue < POWER_STAR_MIN || star.totalValue > POWER_STAR_MAX)) {
        flags.push({
          scenario,
          playerId: star.playerId,
          value: star.totalValue,
          reason: `Power-conference star outside plausible band [$${POWER_STAR_MIN.toLocaleString()}, $${POWER_STAR_MAX.toLocaleString()}]`,
        });
      }
      const median = players[Math.floor(players.length / 2)];
      if (median && (median.totalValue < TYPICAL_PLAYER_MIN || median.totalValue > TYPICAL_PLAYER_MAX)) {
        flags.push({
          scenario,
          playerId: median.playerId,
          value: median.totalValue,
          reason: `Median roster player outside plausible band [$${TYPICAL_PLAYER_MIN.toLocaleString()}, $${TYPICAL_PLAYER_MAX.toLocaleString()}]`,
        });
      }
    }

    return { scenario, players };
  });

  return { results, flags };
}
