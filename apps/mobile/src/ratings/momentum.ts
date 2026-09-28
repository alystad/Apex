// ============================================================================
// MOMENTUM  —  "how hot or cold is this player RIGHT NOW"
// ----------------------------------------------------------------------------
// A completely separate metric from Impact Rating (impactRating.ts):
//   * Signed, -5..+5, centred at 0 (never 0..10, so it is never confused with
//     Impact Rating).
//   * Rolling last-3-minutes-of-game-clock window. Idle decay is free: a player
//     who does nothing for 3 minutes has an empty window and slides back to 0.
//   * A hot-hand streak multiplier (Momentum ONLY — never applied to Impact).
//   * The SAME clutch conditions as Impact, but tuned via this module's own
//     config so the two metrics share no constants.
//
// This module NEVER imports Impact values and Impact NEVER imports Momentum
// values — keeping them independent is deliberate. The only thing shared is the
// canonical play-by-play event *type* (a compile-time type import, erased at
// runtime), so both read the same normalized event stream.
// ============================================================================

import type { CanonicalPbpEventType } from "./impactRating";

declare const require: (id: string) => unknown;

export type MomentumStreakConfig = {
  start: number;
  madeStep: number;
  missStep: number;
  min: number;
  max: number;
};

export type MomentumClutchConfig = {
  multiplier: number;
  clockSec: number;
  marginMax: number;
};

export type MomentumEventImpacts = {
  made2pt: number;
  made3pt: number;
  missedShot: number;
  turnover: number;
  steal: number;
  block: number;
  assist: number;
  offRebound: number;
  defRebound: number;
  foul: number;
  madeFt: number;
  missedFt: number;
};

export type MomentumConfig = {
  schemaVersion: string;
  windowSec: number;
  range: number;
  normalizationScale: number;
  streak: MomentumStreakConfig;
  clutch: MomentumClutchConfig;
  eventImpacts: MomentumEventImpacts;
};

const FALLBACK_MOMENTUM_CONFIG: MomentumConfig = {
  schemaVersion: "momentum-v1",
  windowSec: 180,
  range: 5,
  normalizationScale: 8,
  streak: { start: 1.0, madeStep: 0.15, missStep: 0.25, min: 0.5, max: 2.0 },
  clutch: { multiplier: 1.6, clockSec: 300, marginMax: 8 },
  eventImpacts: {
    made2pt: 2.0,
    made3pt: 3.2,
    missedShot: -1.2,
    turnover: -2.5,
    steal: 1.8,
    block: 1.5,
    assist: 1.0,
    offRebound: 0.8,
    defRebound: 0.5,
    foul: -0.5,
    madeFt: 0.8,
    missedFt: -0.6,
  },
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseMomentumConfig(input: unknown): MomentumConfig | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const file = input as Partial<MomentumConfig>;
  const topLevel = [file.windowSec, file.range, file.normalizationScale];
  if (!topLevel.every(isFiniteNumber)) {
    return null;
  }
  const streak = file.streak;
  const clutch = file.clutch;
  const impacts = file.eventImpacts;
  if (!streak || !clutch || !impacts) {
    return null;
  }
  const streakOk = [streak.start, streak.madeStep, streak.missStep, streak.min, streak.max].every(
    isFiniteNumber,
  );
  const clutchOk = [clutch.multiplier, clutch.clockSec, clutch.marginMax].every(isFiniteNumber);
  const impactKeys: Array<keyof MomentumEventImpacts> = [
    "made2pt",
    "made3pt",
    "missedShot",
    "turnover",
    "steal",
    "block",
    "assist",
    "offRebound",
    "defRebound",
    "foul",
    "madeFt",
    "missedFt",
  ];
  const impactsOk = impactKeys.every((key) => isFiniteNumber(impacts[key]));
  if (!streakOk || !clutchOk || !impactsOk) {
    return null;
  }
  return file as MomentumConfig;
}

function loadBundledMomentumConfig(): MomentumConfig {
  try {
    const loaded = parseMomentumConfig(require("./momentumWeights.json"));
    if (loaded) {
      return loaded;
    }
  } catch {
    // Fall back to bundled defaults when json is missing/corrupt.
  }
  return FALLBACK_MOMENTUM_CONFIG;
}

export const ACTIVE_MOMENTUM_CONFIG: MomentumConfig = loadBundledMomentumConfig();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// How often (game seconds) to sample the sliding-window sum during idle
// stretches between events, so the timeline shows the real decay curve
// instead of a straight line jumping from one event to the next. 20s gives
// 9 samples across the full 180s window — dense enough to read as a curve
// without generating an unbounded number of points over a long game.
const MOMENTUM_DECAY_SAMPLE_SEC = 20;

/** One normalized play attributed to a single player. */
export type MomentumInputEvent = {
  eventId: string;
  canonicalType: CanonicalPbpEventType;
  /** For MADE_SHOT: 2 or 3. Ignored otherwise. */
  shotPoints?: number;
  /** Elapsed game seconds (same time base as the rating timeline). */
  tSec: number;
  period: number;
  clockSec: number;
  /** |home - away| at the time of the play, for the clutch test. */
  scoreMargin: number;
  /** Regulation periods in this league (2 = NCAA halves, 4 = NBA quarters). */
  regulationPeriods: number;
};

export type MomentumTimelinePoint = {
  tSec: number;
  momentum: number;
  period?: number;
  clockSec?: number;
  eventId?: string;
};

export type MomentumResult = {
  /** Current momentum, signed and clamped to +/- config.range. */
  current: number;
  /** Chronological momentum snapshots, one per contributing event + a final "now". */
  timeline: MomentumTimelinePoint[];
};

type WeightedMomentumEvent = {
  tSec: number;
  impact: number;
  period: number;
  clockSec: number;
  eventId: string;
};

function baseImpactForEvent(
  event: MomentumInputEvent,
  impacts: MomentumEventImpacts,
): number {
  switch (event.canonicalType) {
    case "MADE_SHOT":
      return event.shotPoints === 3 ? impacts.made3pt : impacts.made2pt;
    case "MISS_SHOT":
      return impacts.missedShot;
    case "TURNOVER":
      return impacts.turnover;
    case "STEAL":
      return impacts.steal;
    case "BLOCK":
      return impacts.block;
    case "ASSIST":
      return impacts.assist;
    case "REB_OFF":
      return impacts.offRebound;
    case "REB_DEF":
      return impacts.defRebound;
    case "FOUL":
      return impacts.foul;
    case "MADE_FT":
      return impacts.madeFt;
    case "MISS_FT":
      return impacts.missedFt;
    default:
      return 0;
  }
}

// Only field-goal makes/misses (and turnovers) move the hot-hand streak.
function isStreakUp(type: CanonicalPbpEventType): boolean {
  return type === "MADE_SHOT";
}
function isStreakDown(type: CanonicalPbpEventType): boolean {
  return type === "MISS_SHOT" || type === "TURNOVER";
}

function isMomentumClutch(event: MomentumInputEvent, config: MomentumClutchConfig): boolean {
  const regulationPeriods = Math.max(1, Math.floor(event.regulationPeriods || 2));
  const inFinalPeriodOrLater = event.period >= regulationPeriods;
  const lateInPeriod = event.clockSec <= config.clockSec;
  const closeScore = Math.abs(event.scoreMargin) <= config.marginMax;
  return inFinalPeriodOrLater && lateInPeriod && closeScore;
}

/**
 * Replays a single player's chronological events, maintaining the hot-hand
 * streak (reset whenever the rolling window empties), and returns the current
 * momentum plus a timeline of snapshots. Recomputed from scratch each poll,
 * exactly like the rating timeline.
 */
export function computePlayerMomentum(
  events: MomentumInputEvent[],
  nowTSec: number,
  config: MomentumConfig = ACTIVE_MOMENTUM_CONFIG,
): MomentumResult {
  const windowSec = Math.max(1, config.windowSec);
  const ordered = [...events]
    .filter((event) => Number.isFinite(event.tSec))
    .sort((a, b) => a.tSec - b.tSec || a.eventId.localeCompare(b.eventId));

  const weighted: WeightedMomentumEvent[] = [];
  let streak = config.streak.start;
  let previousTSec = Number.NEGATIVE_INFINITY;

  for (const event of ordered) {
    // The streak resets whenever the rolling window empties — i.e. there was a
    // gap of at least a full window with no plays before this one.
    if (event.tSec - previousTSec >= windowSec) {
      streak = config.streak.start;
    }
    previousTSec = event.tSec;

    // Update the streak first, then apply it (spec order).
    if (isStreakUp(event.canonicalType)) {
      streak = Math.min(streak + config.streak.madeStep, config.streak.max);
    } else if (isStreakDown(event.canonicalType)) {
      streak = Math.max(streak - config.streak.missStep, config.streak.min);
    }

    const base = baseImpactForEvent(event, config.eventImpacts);
    const clutchMultiplier = isMomentumClutch(event, config.clutch)
      ? config.clutch.multiplier
      : 1;
    const impact = base * streak * clutchMultiplier;

    weighted.push({
      tSec: event.tSec,
      impact,
      period: event.period,
      clockSec: event.clockSec,
      eventId: event.eventId,
    });
  }

  const normalize = (sum: number): number => {
    const scaled = config.range * Math.tanh(sum / Math.max(0.1, config.normalizationScale));
    return Number(clamp(scaled, -config.range, config.range).toFixed(2));
  };

  // Momentum at time t = normalized sum of weighted impacts whose tSec lies in
  // the trailing window (t - windowSec, t].
  const momentumAt = (endTSec: number): number => {
    const start = endTSec - windowSec;
    let sum = 0;
    for (const w of weighted) {
      if (w.tSec > endTSec) {
        break;
      }
      if (w.tSec > start) {
        sum += w.impact;
      }
    }
    return normalize(sum);
  };

  const effectiveNow = Math.max(nowTSec, weighted.at(-1)?.tSec ?? 0);
  const current = momentumAt(effectiveNow);

  // Momentum is a sliding-window SUM, not a value that only changes on
  // events — as time passes, old events fall out of the trailing window and
  // momentum drifts/decays even with zero new activity. A timeline with only
  // one point per event (plus a final "now" point) has nothing to show that
  // decay: a chart connecting two sparse event-points draws a straight line
  // between them, which reads as an unnatural flat/diagonal plateau instead
  // of the real decay curve. Walk the event boundaries and fill every gap
  // (between events, and from the last event to "now") with regularly-spaced
  // samples of momentumAt() so the line reflects the window sliding, not
  // just event-to-event interpolation.
  //
  // Each synthetic sample needs a `period` (the chart buckets points by
  // period for its x-axis) — carried forward from the boundary the gap
  // started at, since gaps only rarely span a period change. `clockSec` is
  // derived exactly (not approximated): within a period the game clock
  // counts down 1:1 with elapsed real seconds, so clockSec at tSec = t is
  // simply the boundary's clockSec minus the elapsed seconds since it.
  const boundaries: Array<{ tSec: number; period?: number; clockSec?: number; eventId?: string }> =
    weighted.map((w) => ({ tSec: w.tSec, period: w.period, clockSec: w.clockSec, eventId: w.eventId }));
  if (boundaries.length === 0 || boundaries[boundaries.length - 1].tSec < effectiveNow) {
    // No period for the synthetic "now" boundary itself — approximate with
    // the last known event's period (a game is far more often still in the
    // same period at "now" than not).
    boundaries.push({ tSec: effectiveNow, period: weighted.at(-1)?.period });
  }

  const timeline: MomentumTimelinePoint[] = [];
  for (let i = 0; i < boundaries.length; i += 1) {
    const boundary = boundaries[i];
    timeline.push({
      tSec: boundary.tSec,
      momentum: momentumAt(boundary.tSec),
      period: boundary.period,
      clockSec: boundary.clockSec,
      eventId: boundary.eventId,
    });

    const next = boundaries[i + 1];
    if (!next) {
      continue;
    }
    for (
      let t = boundary.tSec + MOMENTUM_DECAY_SAMPLE_SEC;
      t < next.tSec;
      t += MOMENTUM_DECAY_SAMPLE_SEC
    ) {
      const sampleTSec = Math.round(t);
      const clockSec =
        typeof boundary.clockSec === "number"
          ? boundary.clockSec - (sampleTSec - boundary.tSec)
          : undefined;
      timeline.push({
        tSec: sampleTSec,
        momentum: momentumAt(sampleTSec),
        period: boundary.period,
        clockSec,
      });
    }
  }

  return { current, timeline };
}
