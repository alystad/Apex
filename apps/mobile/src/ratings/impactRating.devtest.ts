import {
  computeImpactFromBox,
  createEmptyPlayerBox,
  runImpactRatingDevChecks,
  type GameContext,
  type PbpEvent,
  type PlayerImpact,
  updatePlayerImpactFromEvent,
} from "./impactRating";
import { computeScoringLeadershipMultiplier } from "../../../../src/lib/ratings/scoringLeadership";

export function runImpactRatingSmokeTest(): void {
  const summary = runImpactRatingDevChecks();
  Object.entries(summary.checks).forEach(([name, pass]) => {
    console.log(`[impact-check] ${name}: ${pass ? "PASS" : "FAIL"}`);
  });
  if (!summary.ok) {
    throw new Error(`Impact rating checks failed: ${JSON.stringify(summary.checks)}`);
  }

  const clutchCloseCtx: GameContext = {
    period: 2,
    clockSec: 180,
    homeScore: 62,
    awayScore: 61,
  };
  const nonClutchCtx: GameContext = {
    period: 1,
    clockSec: 900,
    homeScore: 40,
    awayScore: 29,
  };
  const startBox = createEmptyPlayerBox("p1");
  const player: PlayerImpact = { playerId: "p1", rating: 0, rawImpact: 0 };
  const madeThree: PbpEvent = {
    id: "ev-made-3",
    type: "MADE_SHOT",
    playerId: "p1",
    made: true,
    shotType: "3PT",
    points: 3,
    clockSec: 170,
    period: 2,
    description: "Player made 3-pt jumper",
    homeScore: 65,
    awayScore: 61,
  };

  const before = computeImpactFromBox(startBox, clutchCloseCtx);
  const updatedClutch = updatePlayerImpactFromEvent(player, startBox, madeThree, clutchCloseCtx);
  const updatedNonClutch = updatePlayerImpactFromEvent(player, startBox, madeThree, nonClutchCtx);
  if (!(updatedClutch.nextImpact.rawImpact > updatedNonClutch.nextImpact.rawImpact)) {
    throw new Error("Clutch close 3PT should produce more raw impact than non-clutch 3PT.");
  }
  if (!(updatedClutch.nextImpact.rating >= updatedNonClutch.nextImpact.rating)) {
    throw new Error("Clutch close 3PT should not rate below non-clutch 3PT.");
  }
  if (!(updatedClutch.nextImpact.rating > before.rating)) {
    throw new Error("Impact rating should increase on a made 3PT event.");
  }

  if (!updatedClutch.nextImpact.lastMeaningfulImpact) {
    throw new Error("Meaningful impact should be stored when rating delta is at least 0.1.");
  }
  if (!updatedClutch.nextImpact.lastMeaningfulImpact.description.includes("CLUTCH")) {
    throw new Error("Meaningful impact description should include context tags.");
  }

  const noopEvent: PbpEvent = {
    id: "ev-noop",
    type: "TIMEOUT",
    playerId: "p1",
    clockSec: 160,
    period: 2,
    description: "Timeout",
    homeScore: 65,
    awayScore: 61,
  };
  const afterNoop = updatePlayerImpactFromEvent(
    updatedClutch.nextImpact,
    updatedClutch.nextBox,
    noopEvent,
    clutchCloseCtx,
  );
  if (
    afterNoop.nextImpact.lastMeaningfulImpact &&
    afterNoop.nextImpact.lastMeaningfulImpact.eventId === noopEvent.id
  ) {
    throw new Error("Non-meaningful events must not replace lastMeaningfulImpact.");
  }

  const turnover: PbpEvent = {
    id: "ev-tov",
    type: "TURNOVER",
    playerId: "p1",
    clockSec: 160,
    period: 2,
    description: "Player turnover",
    homeScore: 65,
    awayScore: 64,
  };
  const turnoverClutch = updatePlayerImpactFromEvent(
    { playerId: "p1", rating: 5, rawImpact: 0 },
    createEmptyPlayerBox("p1"),
    turnover,
    clutchCloseCtx,
  );
  const turnoverNonClutch = updatePlayerImpactFromEvent(
    { playerId: "p1", rating: 5, rawImpact: 0 },
    createEmptyPlayerBox("p1"),
    turnover,
    nonClutchCtx,
  );
  if (!(turnoverClutch.nextImpact.rawImpact < turnoverNonClutch.nextImpact.rawImpact)) {
    throw new Error("Clutch turnover should penalize raw impact more than non-clutch turnover.");
  }
  if (!(turnoverClutch.nextImpact.rating <= turnoverNonClutch.nextImpact.rating)) {
    throw new Error("Clutch turnover should not rate above non-clutch turnover.");
  }

  const madeFtEvent: PbpEvent = {
    id: "ev-made-ft",
    type: "MADE_FT",
    playerId: "p1",
    made: true,
    shotType: "FT",
    points: 1,
    clockSec: 155,
    period: 2,
    description: "Player made free throw",
    homeScore: 66,
    awayScore: 64,
  };
  const madeTwoEvent: PbpEvent = {
    id: "ev-made-2",
    type: "MADE_SHOT",
    playerId: "p1",
    made: true,
    shotType: "2PT",
    points: 2,
    clockSec: 150,
    period: 2,
    description: "Player made layup",
    homeScore: 68,
    awayScore: 64,
  };
  const madeThreeEvent: PbpEvent = {
    id: "ev-made-3-again",
    type: "MADE_SHOT",
    playerId: "p1",
    made: true,
    shotType: "3PT",
    points: 3,
    clockSec: 145,
    period: 2,
    description: "Player made 3-pt jumper",
    homeScore: 71,
    awayScore: 64,
  };
  const scoringMonotonicBase = createEmptyPlayerBox("score-mono");
  scoringMonotonicBase.minutes = 12;
  scoringMonotonicBase.points = 7;
  scoringMonotonicBase.fga = 8;
  scoringMonotonicBase.fgm = 3;
  scoringMonotonicBase.fta = 2;
  scoringMonotonicBase.ftm = 1;
  scoringMonotonicBase.oreb = 1;
  scoringMonotonicBase.dreb = 2;
  scoringMonotonicBase.reb = 3;
  scoringMonotonicBase.ast = 2;
  scoringMonotonicBase.tov = 1;
  const scoringMonotonicPlayer: PlayerImpact = {
    playerId: "score-mono",
    rating: computeImpactFromBox(scoringMonotonicBase, clutchCloseCtx).rating,
    rawImpact: computeImpactFromBox(scoringMonotonicBase, clutchCloseCtx).rawImpact,
  };
  const scoringContexts: GameContext[] = [clutchCloseCtx, nonClutchCtx];
  const scoringEvents: PbpEvent[] = [madeFtEvent, madeTwoEvent, madeThreeEvent];
  for (const scoringContext of scoringContexts) {
    const beforeScoring = computeImpactFromBox(scoringMonotonicBase, scoringContext);
    for (const scoringEvent of scoringEvents) {
      const scoringUpdate = updatePlayerImpactFromEvent(
        scoringMonotonicPlayer,
        scoringMonotonicBase,
        { ...scoringEvent, playerId: scoringMonotonicBase.playerId },
        scoringContext,
      );
      if (scoringUpdate.nextImpact.rawImpact < beforeScoring.rawImpact) {
        throw new Error(`${scoringEvent.type} should never lower raw impact.`);
      }
      if (scoringUpdate.nextImpact.rating < beforeScoring.rating) {
        throw new Error(`${scoringEvent.type} should never lower rating.`);
      }
    }
  }

  const baseLine = createEmptyPlayerBox("base");
  baseLine.minutes = 14;
  baseLine.points = 8;
  baseLine.fga = 9;
  baseLine.fgm = 4;
  baseLine.fta = 2;
  baseLine.ftm = 1;
  baseLine.oreb = 1;
  baseLine.dreb = 3;
  baseLine.reb = 4;
  baseLine.ast = 2;
  baseLine.stl = 0;
  baseLine.blk = 0;
  baseLine.tov = 1;
  baseLine.pf = 1;
  const baseImpact = computeImpactFromBox(baseLine, clutchCloseCtx);
  const moreTurnovers = computeImpactFromBox({ ...baseLine, tov: baseLine.tov + 1 }, clutchCloseCtx);
  if (!(moreTurnovers.rawImpact < baseImpact.rawImpact && moreTurnovers.rating < baseImpact.rating)) {
    throw new Error("Adding one turnover must lower raw impact and rating.");
  }
  const moreFouls = computeImpactFromBox({ ...baseLine, pf: baseLine.pf + 1 }, clutchCloseCtx);
  if (!(moreFouls.rawImpact < baseImpact.rawImpact && moreFouls.rating < baseImpact.rating)) {
    throw new Error("Adding one foul must lower raw impact and rating.");
  }
  const moreMissedFg = computeImpactFromBox({ ...baseLine, fga: baseLine.fga + 1 }, clutchCloseCtx);
  if (!(moreMissedFg.rawImpact < baseImpact.rawImpact && moreMissedFg.rating < baseImpact.rating)) {
    throw new Error("Adding one missed FG must lower raw impact and rating.");
  }
  const moreMissedFt = computeImpactFromBox({ ...baseLine, fta: baseLine.fta + 1 }, clutchCloseCtx);
  if (!(moreMissedFt.rawImpact < baseImpact.rawImpact && moreMissedFt.rating < baseImpact.rating)) {
    throw new Error("Adding one missed FT must lower raw impact and rating.");
  }

  const leadChangeEvent: PbpEvent = {
    id: "ev-lead-change",
    type: "MADE_SHOT",
    playerId: "p1",
    made: true,
    shotType: "2PT",
    points: 2,
    clockSec: 55,
    period: 2,
    description: "Player made layup",
    homeScore: 70,
    awayScore: 69,
  };
  const leadChangeCtx: GameContext = {
    ...clutchCloseCtx,
    leadChangedOnPlay: true,
  };
  const leadChangeUpdated = updatePlayerImpactFromEvent(
    { playerId: "p1", rating: 5, rawImpact: 0 },
    createEmptyPlayerBox("p1"),
    leadChangeEvent,
    leadChangeCtx,
  );
  if (!leadChangeUpdated.nextImpact.lastMeaningfulImpact?.description.includes("LEAD_CHANGE")) {
    throw new Error("Lead-change meaningful impact should include LEAD_CHANGE tag.");
  }

  const hotBox = createEmptyPlayerBox("hot");
  hotBox.minutes = 18;
  hotBox.fga = 12;
  hotBox.fgm = 9;
  hotBox.fta = 6;
  hotBox.ftm = 5;
  hotBox.oreb = 3;
  hotBox.dreb = 4;
  hotBox.reb = 7;
  hotBox.ast = 5;
  hotBox.stl = 2;
  hotBox.blk = 1;
  hotBox.tov = 1;
  hotBox.pf = 1;
  hotBox.points = 26;
  const hotRating = computeImpactFromBox(hotBox, clutchCloseCtx).rating;
  if (hotRating < 8.5) {
    throw new Error("High positive sample should reach at least 8.5.");
  }

  const coldBox = createEmptyPlayerBox("cold");
  coldBox.minutes = 16;
  coldBox.fga = 11;
  coldBox.fgm = 1;
  coldBox.fta = 2;
  coldBox.ftm = 0;
  coldBox.oreb = 0;
  coldBox.dreb = 1;
  coldBox.reb = 1;
  coldBox.ast = 0;
  coldBox.stl = 0;
  coldBox.blk = 0;
  coldBox.tov = 6;
  coldBox.pf = 4;
  coldBox.points = 2;
  const coldRating = computeImpactFromBox(coldBox, clutchCloseCtx).rating;
  if (coldRating > 2.0) {
    throw new Error("High negative sample should be at or below 2.0.");
  }

  const lowRef = {
    playerId: "low-ref",
    minutes: 12,
    points: 6,
    fga: 7,
    fgm: 2,
    fta: 2,
    ftm: 1,
    oreb: 1,
    dreb: 2,
    reb: 3,
    ast: 1,
    stl: 0,
    blk: 0,
    tov: 2,
    pf: 2,
  };
  const avgRef = {
    playerId: "avg-ref",
    minutes: 18,
    points: 11,
    fga: 10,
    fgm: 5,
    fta: 3,
    ftm: 2,
    oreb: 1,
    dreb: 3,
    reb: 4,
    ast: 3,
    stl: 1,
    blk: 0,
    tov: 2,
    pf: 2,
  };
  const goodRef = {
    playerId: "good-ref",
    minutes: 24,
    points: 17,
    fga: 13,
    fgm: 7,
    fta: 4,
    ftm: 3,
    oreb: 2,
    dreb: 4,
    reb: 6,
    ast: 4,
    stl: 1,
    blk: 1,
    tov: 2,
    pf: 2,
  };
  const eliteRef = {
    playerId: "elite-ref",
    minutes: 32,
    points: 28,
    fga: 19,
    fgm: 11,
    fta: 7,
    ftm: 6,
    oreb: 3,
    dreb: 6,
    reb: 9,
    ast: 7,
    stl: 2,
    blk: 1,
    tov: 2,
    pf: 2,
  };
  const lowRefRating = computeImpactFromBox(lowRef, clutchCloseCtx).rating;
  const avgRefRating = computeImpactFromBox(avgRef, clutchCloseCtx).rating;
  const goodRefRating = computeImpactFromBox(goodRef, clutchCloseCtx).rating;
  const eliteRefRating = computeImpactFromBox(eliteRef, clutchCloseCtx).rating;
  if (lowRefRating > 3.5) {
    throw new Error(`Low reference line too high (${lowRefRating}); expected <= 3.5.`);
  }
  if (avgRefRating < 5.5 || avgRefRating > 7.0) {
    throw new Error(`Average reference line out of stricter band (${avgRefRating}); expected 5.5-7.0.`);
  }
  if (goodRefRating < 7.0 || goodRefRating > 8.5) {
    throw new Error(`Good reference line out of stricter band (${goodRefRating}); expected 7.0-8.5.`);
  }
  if (eliteRefRating < 8.4 || eliteRefRating >= 9.5) {
    throw new Error(`Elite reference line should be high but rarely 9.5+ (${eliteRefRating}).`);
  }

  const betterShooting = {
    playerId: "shooting-better",
    minutes: 22,
    points: 14,
    fga: 11,
    fgm: 6,
    fta: 4,
    ftm: 3,
    oreb: 2,
    dreb: 4,
    reb: 6,
    ast: 3,
    stl: 1,
    blk: 1,
    tov: 2,
    pf: 2,
  };
  const worseShootingSameNonShooting = {
    ...betterShooting,
    playerId: "shooting-worse",
    fga: 16,
    fgm: 6,
  };
  const betterShootingRating = computeImpactFromBox(betterShooting, clutchCloseCtx).rating;
  const worseShootingRating = computeImpactFromBox(worseShootingSameNonShooting, clutchCloseCtx).rating;
  if (!(betterShootingRating > worseShootingRating)) {
    throw new Error("With non-shooting stats equal, better FG shooting should rate higher.");
  }

  const samePointsEfficient = {
    playerId: "same-points-efficient",
    minutes: 24,
    points: 18,
    fga: 12,
    fgm: 7,
    fta: 6,
    ftm: 4,
    oreb: 2,
    dreb: 4,
    reb: 6,
    ast: 3,
    stl: 1,
    blk: 0,
    tov: 2,
    pf: 2,
  };
  const samePointsVolumeMisses = {
    ...samePointsEfficient,
    playerId: "same-points-volume-misses",
    fga: 20,
    fgm: 7,
  };
  const samePointsEfficientRating = computeImpactFromBox(samePointsEfficient, clutchCloseCtx).rating;
  const samePointsVolumeMissesRating = computeImpactFromBox(samePointsVolumeMisses, clutchCloseCtx).rating;
  if (!(samePointsEfficientRating > samePointsVolumeMissesRating)) {
    throw new Error("At same points, high-attempt low-make line should be rated lower.");
  }

  const fgSwingBase = {
    playerId: "fg-swing",
    minutes: 20,
    points: 14,
    fga: 12,
    fgm: 6,
    fta: 4,
    ftm: 3,
    oreb: 1,
    dreb: 4,
    reb: 5,
    ast: 3,
    stl: 1,
    blk: 0,
    tov: 2,
    pf: 2,
  };
  const fgWorse = { ...fgSwingBase, playerId: "fg-worse", fga: 16, fgm: 6 };
  const ftSwingBase = { ...fgSwingBase, playerId: "ft-swing", fta: 8, ftm: 6 };
  const ftWorse = { ...ftSwingBase, playerId: "ft-worse", fta: 8, ftm: 4 };
  const fgDelta =
    computeImpactFromBox(fgSwingBase, clutchCloseCtx).rating -
    computeImpactFromBox(fgWorse, clutchCloseCtx).rating;
  const ftDelta =
    computeImpactFromBox(ftSwingBase, clutchCloseCtx).rating -
    computeImpactFromBox(ftWorse, clutchCloseCtx).rating;
  if (!(fgDelta > ftDelta)) {
    throw new Error("FG efficiency swing should impact rating more than comparable FT swing.");
  }

  const defenseHeavyPoorShooting = {
    playerId: "def-heavy-poor-shooting",
    minutes: 28,
    points: 10,
    fga: 18,
    fgm: 4,
    fta: 2,
    ftm: 1,
    oreb: 2,
    dreb: 8,
    reb: 10,
    ast: 3,
    stl: 3,
    blk: 2,
    tov: 1,
    pf: 2,
  };
  const balancedEfficient = {
    playerId: "balanced-efficient",
    minutes: 28,
    points: 16,
    fga: 11,
    fgm: 7,
    fta: 4,
    ftm: 3,
    oreb: 2,
    dreb: 5,
    reb: 7,
    ast: 4,
    stl: 1,
    blk: 1,
    tov: 2,
    pf: 2,
  };
  const defenseHeavyPoorShootingRating = computeImpactFromBox(defenseHeavyPoorShooting, clutchCloseCtx).rating;
  const balancedEfficientRating = computeImpactFromBox(balancedEfficient, clutchCloseCtx).rating;
  if (!(balancedEfficientRating >= defenseHeavyPoorShootingRating)) {
    throw new Error("Poor high-volume shooting should prevent out-rating a balanced efficient line by default.");
  }

  const leaderEfficient = computeScoringLeadershipMultiplier({
    playerPoints: 24,
    teammatePoints: [10, 8, 7, 5, 4],
    fga: 16,
    fta: 4,
    tov: 2,
    points: 24,
  });
  if (!(leaderEfficient.multiplier > 1.1)) {
    throw new Error("Clear team scoring leader should receive a meaningful positive multiplier.");
  }

  const leaderExtreme = computeScoringLeadershipMultiplier({
    playerPoints: 36,
    teammatePoints: [4, 3, 2, 2, 1],
    fga: 28,
    fta: 8,
    tov: 1,
    points: 36,
  });
  if (leaderExtreme.multiplier > 1.2) {
    throw new Error("Leadership multiplier must respect +20% cap.");
  }

  const leaderInefficient = computeScoringLeadershipMultiplier({
    playerPoints: 24,
    teammatePoints: [10, 8, 7, 5, 4],
    fga: 31,
    fta: 2,
    tov: 7,
    points: 24,
  });
  if (!(leaderInefficient.multiplier < leaderEfficient.multiplier)) {
    throw new Error("Very inefficient scoring leader should have reduced leadership bonus.");
  }

  const scorerLine = {
    playerId: "scorer-line",
    minutes: 30,
    points: 27,
    fga: 18,
    fgm: 10,
    fta: 6,
    ftm: 5,
    oreb: 1,
    dreb: 3,
    reb: 4,
    ast: 2,
    stl: 1,
    blk: 0,
    tov: 2,
    pf: 2,
  };
  const allAroundLine = {
    playerId: "all-around-line",
    minutes: 30,
    points: 16,
    fga: 11,
    fgm: 7,
    fta: 4,
    ftm: 3,
    oreb: 3,
    dreb: 7,
    reb: 10,
    ast: 7,
    stl: 2,
    blk: 2,
    tov: 2,
    pf: 2,
  };
  const scorerBaseRaw = computeImpactFromBox(scorerLine, clutchCloseCtx).rawImpact;
  const allAroundBaseRaw = computeImpactFromBox(allAroundLine, clutchCloseCtx).rawImpact;
  const scorerBoost = computeScoringLeadershipMultiplier({
    playerPoints: 27,
    teammatePoints: [8, 7, 6, 5, 4],
    fga: scorerLine.fga,
    fta: scorerLine.fta,
    tov: scorerLine.tov,
    points: scorerLine.points,
  }).multiplier;
  const allAroundBoost = computeScoringLeadershipMultiplier({
    playerPoints: 16,
    teammatePoints: [14, 10, 7, 5, 3],
    fga: allAroundLine.fga,
    fta: allAroundLine.fta,
    tov: allAroundLine.tov,
    points: allAroundLine.points,
  }).multiplier;
  if (!(scorerBaseRaw * scorerBoost > allAroundBaseRaw * allAroundBoost)) {
    throw new Error("High point leader should usually outrank lower-point all-around line.");
  }

  const inefficientScorerLine = {
    ...scorerLine,
    playerId: "inefficient-scorer",
    fga: 30,
    fgm: 8,
    tov: 6,
  };
  const inefficientBaseRaw = computeImpactFromBox(inefficientScorerLine, clutchCloseCtx).rawImpact;
  const inefficientBoost = computeScoringLeadershipMultiplier({
    playerPoints: inefficientScorerLine.points,
    teammatePoints: [8, 7, 6, 5, 4],
    fga: inefficientScorerLine.fga,
    fta: inefficientScorerLine.fta,
    tov: inefficientScorerLine.tov,
    points: inefficientScorerLine.points,
  }).multiplier;
  if (!(inefficientBaseRaw * inefficientBoost < allAroundBaseRaw * allAroundBoost)) {
    throw new Error("Very inefficient scoring leader should be overtaken by efficient all-around line.");
  }

  const rankComparator = (
    a: { inGameImpactRaw: number; minutes: number; points: number; assists: number; rebounds: number; lastName: string },
    b: { inGameImpactRaw: number; minutes: number; points: number; assists: number; rebounds: number; lastName: string },
  ): number => {
    const impactDiff = b.inGameImpactRaw - a.inGameImpactRaw;
    if (impactDiff !== 0) return impactDiff;
    const minutesDiff = b.minutes - a.minutes;
    if (minutesDiff !== 0) return minutesDiff;
    const pointsDiff = b.points - a.points;
    if (pointsDiff !== 0) return pointsDiff;
    const assistsDiff = b.assists - a.assists;
    if (assistsDiff !== 0) return assistsDiff;
    const reboundsDiff = b.rebounds - a.rebounds;
    if (reboundsDiff !== 0) return reboundsDiff;
    return a.lastName.localeCompare(b.lastName);
  };

  const scoringRankBase = createEmptyPlayerBox("rank-a");
  scoringRankBase.minutes = 10;
  scoringRankBase.points = 6;
  scoringRankBase.fga = 7;
  scoringRankBase.fgm = 3;
  scoringRankBase.fta = 2;
  scoringRankBase.ftm = 0;
  scoringRankBase.reb = 2;
  scoringRankBase.ast = 1;
  scoringRankBase.tov = 1;
  const scoringRankPeer = { ...scoringRankBase, playerId: "rank-b" };
  const scoringRankEvent: PbpEvent = {
    id: "ev-rank-made",
    type: "MADE_SHOT",
    playerId: scoringRankBase.playerId,
    made: true,
    shotType: "2PT",
    points: 2,
    clockSec: 132,
    period: 2,
    description: "Player made jumper",
    homeScore: 73,
    awayScore: 69,
  };
  const scoringRankBefore = computeImpactFromBox(scoringRankBase, clutchCloseCtx);
  const scoringRankAfter = updatePlayerImpactFromEvent(
    { playerId: scoringRankBase.playerId, rating: scoringRankBefore.rating, rawImpact: scoringRankBefore.rawImpact },
    scoringRankBase,
    scoringRankEvent,
    clutchCloseCtx,
  );
  if (scoringRankAfter.nextImpact.rawImpact < scoringRankBefore.rawImpact) {
    throw new Error("Made scoring event should never lower rank-driving raw impact.");
  }
  const rankAfterScoringA = {
    inGameImpactRaw: scoringRankAfter.nextImpact.rawImpact,
    minutes: scoringRankBase.minutes,
    points: scoringRankAfter.nextBox.points,
    assists: scoringRankAfter.nextBox.ast,
    rebounds: scoringRankAfter.nextBox.reb,
    lastName: "A",
  };
  const unchangedPeerB = {
    inGameImpactRaw: computeImpactFromBox(scoringRankPeer, clutchCloseCtx).rawImpact,
    minutes: scoringRankPeer.minutes,
    points: scoringRankPeer.points,
    assists: scoringRankPeer.ast,
    rebounds: scoringRankPeer.reb,
    lastName: "B",
  };
  if (!(rankComparator(rankAfterScoringA, unchangedPeerB) <= 0)) {
    throw new Error("Player should not rank worse than unchanged peer after made scoring event.");
  }

  const playerA = {
    inGameImpactRaw: baseImpact.rawImpact,
    minutes: 20,
    points: 14,
    assists: 4,
    rebounds: 5,
    lastName: "A",
  };
  const playerB = {
    inGameImpactRaw: moreTurnovers.rawImpact,
    minutes: 20,
    points: 14,
    assists: 4,
    rebounds: 5,
    lastName: "B",
  };
  if (!(rankComparator(playerA, playerB) < 0)) {
    throw new Error("Player with better impact should rank above otherwise-equal player with worse negatives.");
  }

  const activityEvents = (box: ReturnType<typeof createEmptyPlayerBox>): number =>
    box.fga + 0.5 * box.fta + box.tov + box.reb + box.ast + box.stl + box.blk + box.pf;
  const meaningful = (box: ReturnType<typeof createEmptyPlayerBox>): boolean =>
    box.minutes >= 6 || activityEvents(box) >= 4;
  const baselineRating = 5.0;
  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));
  const hasAnyTrackedLiveStat = (box: ReturnType<typeof createEmptyPlayerBox>): boolean =>
    activityEvents(box) >= 1;
  const getGamePhaseProgress = (context: { period: number; clockSec: number }): number => {
    const period = Math.max(1, Math.floor(context.period || 1));
    if (period <= 2) {
      const periodSeconds = 20 * 60;
      const clampedClockSec = clamp(context.clockSec, 0, periodSeconds);
      const elapsed = (period - 1) * periodSeconds + (periodSeconds - clampedClockSec);
      const total = 2 * periodSeconds;
      return clamp(elapsed / Math.max(1, total), 0, 1);
    }
    const regulationSeconds = 2 * 20 * 60;
    const overtimeSeconds = 5 * 60;
    const clampedClockSec = clamp(context.clockSec, 0, overtimeSeconds);
    const elapsed =
      regulationSeconds +
      (period - 3) * overtimeSeconds +
      (overtimeSeconds - clampedClockSec);
    const total = regulationSeconds + (period - 2) * overtimeSeconds;
    return clamp(elapsed / Math.max(1, total), 0, 1);
  };
  const getDisplaySampleProgress = (box: ReturnType<typeof createEmptyPlayerBox>): number => {
    const minutesProgress = clamp(box.minutes / 6, 0, 1);
    const activityProgress = clamp(activityEvents(box) / 4, 0, 1);
    return Math.max(minutesProgress, activityProgress);
  };
  const computePhasePerformanceRating = (
    box: ReturnType<typeof createEmptyPlayerBox>,
    context: { period: number; clockSec: number },
  ): number => {
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
    const minutesProgress = clamp(box.minutes / 6, 0, 1);
    const gamePhaseProgress = getGamePhaseProgress(context);
    const phaseDifficulty = 0.9 + 2.2 * gamePhaseProgress + 1.2 * minutesProgress;
    const phaseRating = 5 + 2.4 * Math.tanh(netEventScore / Math.max(0.1, phaseDifficulty));
    return Number(clamp(phaseRating, 0, 10).toFixed(1));
  };
  const computeDisplayedRating = (
    box: ReturnType<typeof createEmptyPlayerBox>,
    modelRating: number | null,
    context: { period: number; clockSec: number },
  ): number => {
    const minutes = Math.max(0, box.minutes);
    const events = activityEvents(box);
    if (minutes < 0.5 && events < 1) {
      return Number(baselineRating.toFixed(1));
    }
    const safeModel =
      typeof modelRating === "number" && Number.isFinite(modelRating)
        ? Number(clamp(modelRating, 0, 10).toFixed(1))
        : baselineRating;
    const phaseRating = computePhasePerformanceRating(box, context);
    const sampleProgress = getDisplaySampleProgress(box);
    const rawModelAdoption =
      sampleProgress * sampleProgress * sampleProgress;
    const phaseGap = Math.abs(phaseRating - baselineRating);
    const phaseDamp = clamp(1 - phaseGap / 3, 0.2, 1);
    const modelAdoption =
      sampleProgress >= 1 ? 1 : rawModelAdoption * phaseDamp;
    return Number(
      clamp(
        phaseRating * (1 - modelAdoption) + safeModel * modelAdoption,
        0,
        10,
      ).toFixed(1),
    );
  };
  const hasMovedOffBaseline = (numericRating: number | null): boolean =>
    typeof numericRating === "number" &&
    Number.isFinite(numericRating) &&
    Math.abs(Number(numericRating.toFixed(1)) - baselineRating) >= 0.1;
  const ratingVisible = (
    box: ReturnType<typeof createEmptyPlayerBox>,
    displayedRating: number | null,
  ): boolean => hasAnyTrackedLiveStat(box) && hasMovedOffBaseline(displayedRating);
  const applyDisplayFields = (
    box: ReturnType<typeof createEmptyPlayerBox>,
    modelRating: number | null,
    context: { period: number; clockSec: number },
  ) => {
    const displayedRating = computeDisplayedRating(box, modelRating, context);
    if (!ratingVisible(box, displayedRating)) {
      return { inGameRating10: null as number | null, gameRating: null as number | null, liveDisplay: "-" as "-" | number };
    }
    return {
      inGameRating10: displayedRating,
      gameRating: displayedRating,
      liveDisplay: displayedRating,
    };
  };
  const rankEligible = (box: ReturnType<typeof createEmptyPlayerBox>, onCourt: boolean, impactRaw: number | null): boolean =>
    onCourt && meaningful(box) && typeof impactRaw === "number" && Number.isFinite(impactRaw);
  const earlyContext = { period: 1, clockSec: 18 * 60 };
  const lateContext = { period: 2, clockSec: 5 * 60 };

  const noActivityBox = createEmptyPlayerBox("no-activity");
  noActivityBox.minutes = 0.2;
  const noActivityDisplay = applyDisplayFields(noActivityBox, 5.0, earlyContext);
  if (!(noActivityDisplay.inGameRating10 === null && noActivityDisplay.gameRating === null && noActivityDisplay.liveDisplay === "-")) {
    throw new Error("Player with no tracked live stats should remain unrated.");
  }
  const earlyStrongBox = createEmptyPlayerBox("early-strong");
  earlyStrongBox.minutes = 2.5;
  earlyStrongBox.fga = 2;
  earlyStrongBox.fgm = 2;
  earlyStrongBox.points = 4;
  earlyStrongBox.stl = 1;
  const earlyStrongDisplayed = computeDisplayedRating(earlyStrongBox, 8.8, earlyContext);
  if (earlyStrongDisplayed < 6.6 || earlyStrongDisplayed > 7.5) {
    throw new Error(`Early strong line should land in 6.6-7.5 band (${earlyStrongDisplayed}).`);
  }
  const lateStrongDisplayed = computeDisplayedRating(earlyStrongBox, 8.8, lateContext);
  if (!(lateStrongDisplayed < earlyStrongDisplayed)) {
    throw new Error("Same micro-line later in game should rate lower than early version.");
  }
  const earlyStrongFields = applyDisplayFields(earlyStrongBox, 8.8, earlyContext);
  if (!(earlyStrongFields.inGameRating10 !== null && earlyStrongFields.liveDisplay !== "-")) {
    throw new Error("Early strong tracked line should reveal a numeric rating.");
  }
  const earlyNegativeBox = createEmptyPlayerBox("early-negative");
  earlyNegativeBox.minutes = 2.0;
  earlyNegativeBox.fga = 1;
  earlyNegativeBox.tov = 1;
  const earlyNegativeDisplayed = computeDisplayedRating(earlyNegativeBox, 1.2, earlyContext);
  if (!(earlyNegativeDisplayed < baselineRating && earlyNegativeDisplayed > 2.0)) {
    throw new Error("Early negative line should be below baseline but not extreme.");
  }
  const earlyNegativeFields = applyDisplayFields(earlyNegativeBox, 1.2, earlyContext);
  if (!(earlyNegativeFields.inGameRating10 !== null && earlyNegativeFields.liveDisplay !== "-")) {
    throw new Error("Early tracked negative event should reveal an anchored display rating.");
  }

  const lowSampleBox = createEmptyPlayerBox("low");
  lowSampleBox.minutes = 5.9;
  lowSampleBox.fga = 1;
  const lowSampleDisplay = applyDisplayFields(lowSampleBox, 6.4, earlyContext);
  if (!(lowSampleDisplay.inGameRating10 !== null && lowSampleDisplay.gameRating !== null && lowSampleDisplay.liveDisplay !== "-")) {
    throw new Error("Player with first tracked event and off-baseline score should show in-game rating.");
  }
  if (rankEligible(lowSampleBox, true, 3.2)) {
    throw new Error("Player without meaningful sample should not be in-game rank eligible.");
  }
  const baselineLockedBox = createEmptyPlayerBox("baseline-locked");
  baselineLockedBox.minutes = 6.0;
  baselineLockedBox.fga = 1;
  const baselineLockedDisplay = applyDisplayFields(baselineLockedBox, 5.0, earlyContext);
  if (!(baselineLockedDisplay.inGameRating10 === null && baselineLockedDisplay.gameRating === null && baselineLockedDisplay.liveDisplay === "-")) {
    throw new Error("Visible rating should stay hidden until it moves off baseline 5.0.");
  }
  const minutesOnlyBox = createEmptyPlayerBox("minutes-only");
  minutesOnlyBox.minutes = 6.0;
  const minutesOnlyDisplay = applyDisplayFields(minutesOnlyBox, 6.2, earlyContext);
  if (!(minutesOnlyDisplay.inGameRating10 === null && minutesOnlyDisplay.gameRating === null && minutesOnlyDisplay.liveDisplay === "-")) {
    throw new Error("Minutes without any tracked live stat should keep rating hidden.");
  }
  const minutesQualifiedBox = createEmptyPlayerBox("minutes");
  minutesQualifiedBox.minutes = 6.0;
  minutesQualifiedBox.fga = 1;
  const minutesDisplay = applyDisplayFields(minutesQualifiedBox, 6.2, earlyContext);
  if (!(minutesDisplay.inGameRating10 !== null && minutesDisplay.gameRating !== null && minutesDisplay.liveDisplay !== "-")) {
    throw new Error("Minutes-qualified player with tracked stat and off-baseline rating should show numeric rating.");
  }
  if (!rankEligible(minutesQualifiedBox, true, 1.5)) {
    throw new Error("Player with >=6 minutes should be in-game rank eligible.");
  }
  const activityQualifiedBox = createEmptyPlayerBox("activity");
  activityQualifiedBox.minutes = 2.0;
  activityQualifiedBox.fga = 2;
  activityQualifiedBox.tov = 1;
  activityQualifiedBox.reb = 1;
  const activityDisplay = applyDisplayFields(activityQualifiedBox, 5.8, earlyContext);
  if (!(activityDisplay.inGameRating10 !== null && activityDisplay.gameRating !== null && activityDisplay.liveDisplay !== "-")) {
    throw new Error("Meaningful sample by activity events should show numeric in-game rating.");
  }
  const activityConvergedDisplay = computeDisplayedRating(activityQualifiedBox, 5.8, earlyContext);
  if (Math.abs(activityConvergedDisplay - 5.8) > 0.1) {
    throw new Error("Display rating should converge to model rating by meaningful sample threshold.");
  }
  if (!rankEligible(activityQualifiedBox, true, 1.1)) {
    throw new Error("Player with >=4 activity events should be in-game rank eligible.");
  }

  const inGameListComparator = (
    a: { gameRank: number | null; inGameImpactRaw: number | null; minutes: number; lastName: string; seasonRank: number | null },
    b: { gameRank: number | null; inGameImpactRaw: number | null; minutes: number; lastName: string; seasonRank: number | null },
  ): number => {
    const aGameRank = a.gameRank ?? Number.MAX_SAFE_INTEGER;
    const bGameRank = b.gameRank ?? Number.MAX_SAFE_INTEGER;
    if (aGameRank !== bGameRank) return aGameRank - bGameRank;
    const aImpact = typeof a.inGameImpactRaw === "number" && Number.isFinite(a.inGameImpactRaw)
      ? a.inGameImpactRaw
      : Number.NEGATIVE_INFINITY;
    const bImpact = typeof b.inGameImpactRaw === "number" && Number.isFinite(b.inGameImpactRaw)
      ? b.inGameImpactRaw
      : Number.NEGATIVE_INFINITY;
    const impactDiff = bImpact - aImpact;
    if (impactDiff !== 0) return impactDiff;
    const minutesDiff = b.minutes - a.minutes;
    if (minutesDiff !== 0) return minutesDiff;
    return a.lastName.localeCompare(b.lastName);
  };

  const meaningfulLowSeason = {
    gameRank: 1,
    inGameImpactRaw: 7.3,
    minutes: 14,
    lastName: "A",
    seasonRank: 99,
  };
  const notMeaningfulHighSeason = {
    gameRank: null,
    inGameImpactRaw: 8.1,
    minutes: 2,
    lastName: "B",
    seasonRank: 1,
  };
  if (!(inGameListComparator(meaningfulLowSeason, notMeaningfulHighSeason) < 0)) {
    throw new Error("In-game list ordering must not use season rank fallback.");
  }
}
