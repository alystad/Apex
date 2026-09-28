import type {
  BaseballBattingLine,
  BaseballFieldingLine,
  BaseballPitchingLine,
} from "@/src/features/baseball/baseballTypes";
import {
  buildBreakdownItems,
  clamp,
  combineHitterImpact01,
  combinePitcherImpact01,
  computeClutchRaw,
  computeConfidence,
  computeDefenseRaw,
  computeGameUsageMultiplier,
  computeHitterOffenseRaw,
  computePitchingRaw,
  computeUsageMultiplier,
  derivePlateAppearances,
  detectBaseballRole,
  inningsToOuts,
  overallRatingFromImpact01,
  roundTo2,
  safeAverage,
  subratingFromZ,
} from "@/src/ratings/baseball/baseballImpactFormulas";
import {
  createDistributionSeed,
  getDistributionSet,
  sigmoidNormalize,
  buildRoleDistributions,
  zScoreAgainstDistribution,
} from "@/src/ratings/baseball/baseballNormalization";
import { normalizeBaseballPosition } from "@/src/ratings/baseball/baseballPositionModel";
import {
  averageRating,
  buildTrendPoints,
  computeRollingRating,
  computeTrendDelta,
} from "@/src/ratings/baseball/baseballTrendModel";
import type {
  BaseballComputedGameImpact,
  BaseballImpactOutput,
  BaseballImpactRole,
  BaseballLeaderboardOptions,
  BaseballLeaderboardRow,
  BaseballPlayerGameLog,
  BaseballRoleDistributions,
  BaseballSeasonPlayerProfile,
} from "@/src/ratings/baseball/types";

type PlayerSeasonMeta = {
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  position: string;
  role: BaseballImpactRole;
  pitchingRole: "STARTER" | "RELIEVER";
  totalPlateAppearances: number;
  totalOutsRecorded: number;
  totalInningsPitched: number;
  gamesPlayed: number;
  battingGames: number;
  pitchingAppearances: number;
};

type RawGameImpact = {
  source: BaseballPlayerGameLog;
  seasonRole: BaseballImpactRole;
  pitchingRole: "STARTER" | "RELIEVER";
  position: string;
  plateAppearances: number;
  inningsPitched: number;
  outsRecorded: number;
  offenseRaw: number;
  pitchingRaw: number;
  defenseRaw: number;
  clutchRaw: number;
  rawIndex: number;
  missingCoreStats: boolean;
  missingRunFields: boolean;
  missingDefense: boolean;
  leverageKnown: boolean;
};

type RawGameImpactWithShare = RawGameImpact & {
  impactShare: number;
  offenseShare: number;
  pitchShare: number;
};

function sortLogsByDate<T extends { game: { date: string } }>(rows: T[]): T[] {
  return [...rows].sort(
    (left, right) => new Date(left.game.date).getTime() - new Date(right.game.date).getTime(),
  );
}

function averagePosition(values: Array<string | null | undefined>): string {
  const counts = new Map<string, number>();
  values
    .map((value) => normalizeBaseballPosition(value))
    .forEach((value) => {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "DH";
}

function normalizeTeamName(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function buildPlayerSeasonMeta(logs: BaseballPlayerGameLog[]): Map<string, PlayerSeasonMeta> {
  const byPlayer = new Map<string, BaseballPlayerGameLog[]>();
  logs.forEach((log) => {
    const rows = byPlayer.get(log.playerId) ?? [];
    rows.push(log);
    byPlayer.set(log.playerId, rows);
  });

  const output = new Map<string, PlayerSeasonMeta>();
  byPlayer.forEach((rows, playerId) => {
    const totalPlateAppearances = rows.reduce(
      (sum, row) => sum + derivePlateAppearances(row.batting),
      0,
    );
    const totalOutsRecorded = rows.reduce(
      (sum, row) => sum + inningsToOuts(row.pitching?.inningsPitched),
      0,
    );
    const pitchingAppearances = rows.filter(
      (row) => inningsToOuts(row.pitching?.inningsPitched) > 0,
    ).length;
    const totalInningsPitched = totalOutsRecorded / 3;
    const battingGames = rows.filter((row) => derivePlateAppearances(row.batting) > 0).length;
    const starterHintCount = rows.filter((row) => row.game.starterHint).length;
    const role = detectBaseballRole({
      position: averagePosition(rows.map((row) => row.position)),
      totalPlateAppearances,
      totalOutsRecorded,
      pitchingAppearances,
      starterHintCount,
    });
    const position =
      role === "STARTER" || role === "RELIEVER"
        ? "P"
        : averagePosition(rows.map((row) => row.position));
    const avgInnings = pitchingAppearances > 0 ? totalInningsPitched / pitchingAppearances : 0;
    output.set(playerId, {
      playerId,
      playerName: rows[0]?.playerName ?? playerId,
      teamId: rows[0]?.teamId ?? "",
      teamName: normalizeTeamName(rows[0]?.teamName, rows[0]?.teamId ?? ""),
      position,
      role,
      pitchingRole: avgInnings >= 3 || role === "STARTER" ? "STARTER" : "RELIEVER",
      totalPlateAppearances,
      totalOutsRecorded,
      totalInningsPitched,
      gamesPlayed: rows.length,
      battingGames,
      pitchingAppearances,
    });
  });

  return output;
}

function buildRawGameImpacts(
  logs: BaseballPlayerGameLog[],
  seasonMeta: Map<string, PlayerSeasonMeta>,
): RawGameImpact[] {
  const orderedLogs = sortLogsByDate(logs);

  return orderedLogs.map((log) => {
    const meta = seasonMeta.get(log.playerId);
    const position = meta?.position ?? normalizeBaseballPosition(log.position);
    const seasonRole = meta?.role ?? "HITTER";
    const perGamePitchingRole =
      (log.game.starterHint ?? false) || inningsToOuts(log.pitching?.inningsPitched) >= 9
        ? "STARTER"
        : meta?.pitchingRole ?? "RELIEVER";
    const offense = computeHitterOffenseRaw(log.batting);
    const defense = computeDefenseRaw(log.fielding, position);
    const pitching = computePitchingRaw(log.pitching, perGamePitchingRole);
    const clutch = computeClutchRaw({
      batting: log.batting,
      pitching: log.pitching,
      role: seasonRole,
      pitchingRole: perGamePitchingRole,
      game: log.game,
      extraBaseHits: offense.extraBaseHits,
      outsRecorded: pitching.outsRecorded,
    });

    let rawIndex = 0;
    if (seasonRole === "HITTER") {
      rawIndex = offense.value + defense.value + clutch.value;
    } else if (seasonRole === "TWO_WAY") {
      rawIndex = offense.value + pitching.value + defense.value + clutch.value;
    } else {
      rawIndex = pitching.value + clutch.value;
    }

    return {
      source: log,
      seasonRole,
      pitchingRole: perGamePitchingRole,
      position,
      plateAppearances: offense.plateAppearances,
      inningsPitched: pitching.outsRecorded / 3,
      outsRecorded: pitching.outsRecorded,
      offenseRaw: offense.value,
      pitchingRaw: pitching.value,
      defenseRaw: defense.value,
      clutchRaw: clutch.value,
      rawIndex: roundTo2(rawIndex),
      missingCoreStats: offense.missingCoreStats,
      missingRunFields: pitching.missingRunFields,
      missingDefense: defense.missing,
      leverageKnown: clutch.leverageKnown,
    };
  });
}

function attachImpactShares(rows: RawGameImpact[]): RawGameImpactWithShare[] {
  const teamTotals = new Map<string, { offense: number; pitching: number }>();

  rows.forEach((row) => {
    const key = `${row.source.teamId}:${row.source.game.gameId}`;
    const current = teamTotals.get(key) ?? { offense: 0, pitching: 0 };
    current.offense += Math.max(0, row.offenseRaw);
    current.pitching += Math.max(0, row.pitchingRaw);
    teamTotals.set(key, current);
  });

  return rows.map((row) => {
    const key = `${row.source.teamId}:${row.source.game.gameId}`;
    const totals = teamTotals.get(key) ?? { offense: 0.1, pitching: 0.1 };
    const offenseShare = clamp(row.offenseRaw / Math.max(0.1, totals.offense), 0, 1.2);
    const pitchShare = clamp(row.pitchingRaw / Math.max(0.1, totals.pitching), 0, 1.2);
    const offenseWeight = Math.min(1, row.plateAppearances / 5);
    const pitchingWeight = Math.min(1, row.outsRecorded / 9);
    const twoWayShare =
      offenseWeight + pitchingWeight > 0
        ? (offenseWeight * offenseShare + pitchingWeight * pitchShare) /
          (offenseWeight + pitchingWeight)
        : 0;

    return {
      ...row,
      offenseShare,
      pitchShare,
      impactShare:
        row.seasonRole === "HITTER"
          ? offenseShare
          : row.seasonRole === "TWO_WAY"
            ? clamp(twoWayShare, 0, 1.2)
            : pitchShare,
    };
  });
}

function componentRole(
  role: BaseballImpactRole,
  kind: "offense" | "pitching" | "defense" | "clutch",
  pitchingRole: "STARTER" | "RELIEVER",
): BaseballImpactRole {
  if (role === "TWO_WAY") {
    if (kind === "offense" || kind === "defense") {
      return "HITTER";
    }
    if (kind === "pitching") {
      return pitchingRole;
    }
  }
  return role;
}

function buildGameImpactOutput(
  row: RawGameImpactWithShare,
  distributions?: BaseballRoleDistributions,
): BaseballComputedGameImpact {
  const usageMultiplier = computeGameUsageMultiplier(
    row.seasonRole,
    row.plateAppearances,
    row.inningsPitched,
  );

  const offenseZ = zScoreAgainstDistribution(
    row.offenseRaw,
    getDistributionSet(distributions, componentRole(row.seasonRole, "offense", row.pitchingRole))
      .offense,
  );
  const pitchingZ = zScoreAgainstDistribution(
    row.pitchingRaw,
    getDistributionSet(distributions, componentRole(row.seasonRole, "pitching", row.pitchingRole))
      .pitching,
  );
  const defenseZ = zScoreAgainstDistribution(
    row.defenseRaw,
    getDistributionSet(distributions, componentRole(row.seasonRole, "defense", row.pitchingRole))
      .defense,
  );
  const clutchZ = zScoreAgainstDistribution(
    row.clutchRaw,
    getDistributionSet(distributions, componentRole(row.seasonRole, "clutch", row.pitchingRole))
      .clutch,
  );

  const offenseRating = row.seasonRole === "STARTER" || row.seasonRole === "RELIEVER" ? 5 : subratingFromZ(offenseZ);
  const pitchingRating = row.seasonRole === "HITTER" ? 5 : subratingFromZ(pitchingZ);
  const defenseRating = row.seasonRole === "STARTER" || row.seasonRole === "RELIEVER" ? 5 : subratingFromZ(defenseZ);
  const clutchRating = subratingFromZ(clutchZ);

  const hitterImpact01 = combineHitterImpact01({
    offenseRating,
    defenseRating,
    clutchRating,
    usageMultiplier,
    position: row.position,
  });
  const pitcherImpact01 = combinePitcherImpact01({
    pitchingRating,
    clutchRating,
    role: row.pitchingRole,
    usageMultiplier,
  });

  let impact01 = hitterImpact01;
  if (row.seasonRole === "STARTER" || row.seasonRole === "RELIEVER") {
    impact01 = pitcherImpact01;
  } else if (row.seasonRole === "TWO_WAY") {
    const offenseWeight = Math.min(1, row.plateAppearances / 5);
    const pitchingWeight = Math.min(1, row.outsRecorded / 9);
    impact01 =
      offenseWeight + pitchingWeight > 0
        ? (offenseWeight * hitterImpact01 + pitchingWeight * pitcherImpact01) /
          (offenseWeight + pitchingWeight)
        : hitterImpact01;
  }

  const confidence = computeConfidence({
    role: row.seasonRole,
    plateAppearances: row.plateAppearances,
    inningsPitched: row.inningsPitched,
    missingCoreStats: row.missingCoreStats,
    missingRunFields: row.missingRunFields,
    missingDefense: row.missingDefense,
    leverageKnown: row.leverageKnown,
  });

  const output: BaseballImpactOutput = {
    overallRating: overallRatingFromImpact01(impact01),
    offenseRating: roundTo2(clamp(offenseRating, 0, 10)),
    pitchingRating: roundTo2(clamp(pitchingRating, 0, 10)),
    defenseRating: roundTo2(clamp(defenseRating, 0, 10)),
    clutchRating: roundTo2(clamp(clutchRating, 0, 10)),
    impactShare: roundTo2(clamp(row.impactShare, 0, 1)),
    role: row.seasonRole,
    position: row.position,
    confidence,
    breakdown: buildBreakdownItems({
      role: row.seasonRole,
      position: row.position,
      offenseRating,
      pitchingRating,
      defenseRating,
      clutchRating,
      impactShare: row.impactShare,
      confidence,
      usageMultiplier,
    }),
    lastNGamesTrend: [
      {
        gameId: row.source.game.gameId,
        rating: overallRatingFromImpact01(impact01),
        date: row.source.game.date,
      },
    ],
  };

  return {
    ...row.source,
    role: row.seasonRole,
    pitchingRole: row.pitchingRole,
    normalizedPosition: row.position,
    plateAppearances: row.plateAppearances,
    inningsPitched: roundTo2(row.inningsPitched),
    outsRecorded: row.outsRecorded,
    offenseRaw: row.offenseRaw,
    pitchingRaw: row.pitchingRaw,
    defenseRaw: row.defenseRaw,
    clutchRaw: row.clutchRaw,
    rawIndex: row.rawIndex,
    offenseShare: roundTo2(row.offenseShare),
    pitchShare: roundTo2(row.pitchShare),
    impactShare: roundTo2(row.impactShare),
    usageMultiplier,
    confidence,
    output,
  };
}

export function computeBaseballGameImpacts(
  logs: BaseballPlayerGameLog[],
  options?: { distributions?: BaseballRoleDistributions },
): BaseballComputedGameImpact[] {
  if (logs.length === 0) {
    return [];
  }

  const meta = buildPlayerSeasonMeta(logs);
  const withShares = attachImpactShares(buildRawGameImpacts(logs, meta));
  const seeds = withShares.map((row) =>
    createDistributionSeed({
      role: row.seasonRole,
      sampleValue:
        row.seasonRole === "HITTER"
          ? row.plateAppearances
          : row.seasonRole === "TWO_WAY"
            ? Math.max(row.plateAppearances, row.inningsPitched)
            : row.inningsPitched,
      offense: row.offenseRaw,
      pitching: row.pitchingRaw,
      defense: row.defenseRaw,
      clutch: row.clutchRaw,
      overall: row.rawIndex,
    }),
  );
  const distributions = options?.distributions ?? buildRoleDistributions(seeds);
  return withShares.map((row) => buildGameImpactOutput(row, distributions));
}

export function buildBaseballSeasonProfiles(
  logs: BaseballPlayerGameLog[],
  options?: { distributions?: BaseballRoleDistributions },
): BaseballSeasonPlayerProfile[] {
  if (logs.length === 0) {
    return [];
  }

  const gameImpacts = computeBaseballGameImpacts(logs, options);
  const byPlayer = new Map<string, BaseballComputedGameImpact[]>();
  gameImpacts.forEach((impact) => {
    const rows = byPlayer.get(impact.playerId) ?? [];
    rows.push(impact);
    byPlayer.set(impact.playerId, rows);
  });

  const seasonSeeds = [...byPlayer.values()].map((rows) => {
    const ordered = [...rows].sort(
      (left, right) => new Date(left.game.date).getTime() - new Date(right.game.date).getTime(),
    );
    const meta = ordered[0];
    const role = meta?.role ?? "HITTER";
    const totalPlateAppearances = ordered.reduce((sum, row) => sum + row.plateAppearances, 0);
    const totalInningsPitched = ordered.reduce((sum, row) => sum + row.inningsPitched, 0);
    const sampleValue =
      role === "HITTER"
        ? totalPlateAppearances
        : role === "TWO_WAY"
          ? Math.max(totalPlateAppearances, totalInningsPitched)
          : totalInningsPitched;
    const offenseMetric = safeAverage(ordered.map((row) => row.offenseRaw));
    const pitchingMetric = safeAverage(ordered.map((row) => row.pitchingRaw));
    const defenseMetric = safeAverage(ordered.map((row) => row.defenseRaw));
    const clutchMetric = safeAverage(ordered.map((row) => row.clutchRaw));
    const overallMetric = safeAverage(ordered.map((row) => row.rawIndex));
    return createDistributionSeed({
      role,
      sampleValue,
      offense: offenseMetric,
      pitching: pitchingMetric,
      defense: defenseMetric,
      clutch: clutchMetric,
      overall: overallMetric,
    });
  });

  const distributions = options?.distributions ?? buildRoleDistributions(seasonSeeds);

  const profiles = [...byPlayer.values()].map((rows) => {
    const ordered = [...rows].sort(
      (left, right) => new Date(left.game.date).getTime() - new Date(right.game.date).getTime(),
    );
    const head = ordered[0];
    const role = head?.role ?? "HITTER";
    const position = head?.normalizedPosition ?? "DH";
    const pitchingRole = head?.pitchingRole ?? "RELIEVER";
    const totalPlateAppearances = ordered.reduce((sum, row) => sum + row.plateAppearances, 0);
    const totalInningsPitched = ordered.reduce((sum, row) => sum + row.inningsPitched, 0);
    const totalOutsRecorded = ordered.reduce((sum, row) => sum + row.outsRecorded, 0);
    const battingGames = ordered.filter((row) => row.plateAppearances > 0).length;
    const pitchingAppearances = ordered.filter((row) => row.outsRecorded > 0).length;
    const sampleValue =
      role === "HITTER"
        ? totalPlateAppearances
        : role === "TWO_WAY"
          ? Math.max(totalPlateAppearances, totalInningsPitched)
          : totalInningsPitched;

    const offenseMetric = safeAverage(ordered.map((row) => row.offenseRaw));
    const pitchingMetric = safeAverage(ordered.map((row) => row.pitchingRaw));
    const defenseMetric = safeAverage(ordered.map((row) => row.defenseRaw));
    const clutchMetric = safeAverage(ordered.map((row) => row.clutchRaw));
    const offenseZ = zScoreAgainstDistribution(
      offenseMetric,
      getDistributionSet(distributions, componentRole(role, "offense", pitchingRole)).offense,
    );
    const pitchingZ = zScoreAgainstDistribution(
      pitchingMetric,
      getDistributionSet(distributions, componentRole(role, "pitching", pitchingRole)).pitching,
    );
    const defenseZ = zScoreAgainstDistribution(
      defenseMetric,
      getDistributionSet(distributions, componentRole(role, "defense", pitchingRole)).defense,
    );
    const clutchZ = zScoreAgainstDistribution(
      clutchMetric,
      getDistributionSet(distributions, componentRole(role, "clutch", pitchingRole)).clutch,
    );

    const offenseRating = role === "STARTER" || role === "RELIEVER" ? 5 : subratingFromZ(offenseZ);
    const pitchingRating = role === "HITTER" ? 5 : subratingFromZ(pitchingZ);
    const defenseRating = role === "STARTER" || role === "RELIEVER" ? 5 : subratingFromZ(defenseZ);
    const clutchRating = subratingFromZ(clutchZ);
    const usageMultiplier = computeUsageMultiplier(role, totalPlateAppearances, totalInningsPitched);
    const hitterImpact01 = combineHitterImpact01({
      offenseRating,
      defenseRating,
      clutchRating,
      usageMultiplier,
      position,
    });
    const pitcherImpact01 = combinePitcherImpact01({
      pitchingRating,
      clutchRating,
      role: pitchingRole,
      usageMultiplier,
    });

    let impact01 = hitterImpact01;
    if (role === "STARTER" || role === "RELIEVER") {
      impact01 = pitcherImpact01;
    } else if (role === "TWO_WAY") {
      const offenseWeight = Math.min(
        1,
        battingGames > 0 ? totalPlateAppearances / Math.max(1, battingGames * 5) : 0,
      );
      const pitchingWeight = Math.min(
        1,
        pitchingAppearances > 0 ? totalOutsRecorded / Math.max(1, pitchingAppearances * 9) : 0,
      );
      impact01 =
        offenseWeight + pitchingWeight > 0
          ? (offenseWeight * hitterImpact01 + pitchingWeight * pitcherImpact01) /
            (offenseWeight + pitchingWeight)
          : hitterImpact01;
    }

    const baseOverall = overallRatingFromImpact01(impact01);
    const gameRatings = ordered.map((row) => row.output.overallRating);
    const rollingRating = computeRollingRating(gameRatings);
    const recentAverageRating = averageRating(gameRatings.slice(-5));
    const overallRating =
      ordered.length <= 3
        ? rollingRating
        : roundTo2(clamp(baseOverall * 0.6 + rollingRating * 0.4, 0, 10));
    const averageImpactShare = roundTo2(
      clamp(safeAverage(ordered.map((row) => row.impactShare)), 0, 1),
    );
    const missingCoreStats = ordered.some((row) => row.output.confidence < 0.3 && row.plateAppearances > 0);
    const missingRunFields = ordered.some((row) => row.outsRecorded > 0 && row.output.confidence < 0.3);
    const missingDefense = ordered.every((row) => row.defenseRaw === 0 && !row.fielding);
    const leverageKnown = ordered.some((row) => row.game.leverageKnown ?? row.game.isCloseGame !== null);
    const confidence = computeConfidence({
      role,
      plateAppearances: totalPlateAppearances,
      inningsPitched: totalInningsPitched,
      missingCoreStats,
      missingRunFields,
      missingDefense,
      leverageKnown,
    });
    const lastNGamesTrend = buildTrendPoints(
      ordered.map((row) => ({
        gameId: row.game.gameId,
        date: row.game.date,
        rating: row.output.overallRating,
        opponent: row.game.opponent,
        role: row.role,
        impactShare: row.impactShare,
      })),
    );

    const output: BaseballImpactOutput = {
      overallRating,
      offenseRating: roundTo2(clamp(offenseRating, 0, 10)),
      pitchingRating: roundTo2(clamp(pitchingRating, 0, 10)),
      defenseRating: roundTo2(clamp(defenseRating, 0, 10)),
      clutchRating: roundTo2(clamp(clutchRating, 0, 10)),
      impactShare: averageImpactShare,
      role,
      position,
      confidence,
      breakdown: buildBreakdownItems({
        role,
        position,
        offenseRating,
        pitchingRating,
        defenseRating,
        clutchRating,
        impactShare: averageImpactShare,
        confidence,
        usageMultiplier,
      }),
      lastNGamesTrend: lastNGamesTrend.map((entry) => ({
        gameId: entry.gameId,
        rating: entry.rating,
        date: entry.date,
      })),
    };

    const bestGame = [...lastNGamesTrend, ...buildTrendPoints([])]
      .concat(
        ordered.map((row) => ({
          gameId: row.game.gameId,
          rating: row.output.overallRating,
          date: row.game.date,
          opponent: row.game.opponent,
          role: row.role,
          impactShare: row.impactShare,
        })),
      )
      .sort((left, right) => right.rating - left.rating)[0] ?? null;
    const worstGame =
      ordered
        .map((row) => ({
          gameId: row.game.gameId,
          rating: row.output.overallRating,
          date: row.game.date,
          opponent: row.game.opponent,
          role: row.role,
          impactShare: row.impactShare,
        }))
        .sort((left, right) => left.rating - right.rating)[0] ?? null;

    return {
      playerId: head?.playerId ?? "",
      playerName: head?.playerName ?? "",
      teamId: head?.teamId ?? "",
      teamName: head?.teamName ?? head?.teamId ?? "",
      position,
      role,
      gamesPlayed: ordered.length,
      battingGames,
      pitchingAppearances,
      totalPlateAppearances,
      totalInningsPitched: roundTo2(totalInningsPitched),
      totalOutsRecorded,
      averageImpactShare,
      seasonAverageRating: averageRating(gameRatings),
      rollingRating,
      recentAverageRating,
      latestRating: gameRatings[gameRatings.length - 1] ?? null,
      trendDelta: computeTrendDelta(gameRatings),
      bestGame,
      worstGame,
      output,
      games: ordered,
    } satisfies BaseballSeasonPlayerProfile;
  });

  return profiles.sort(
    (left, right) =>
      right.output.overallRating - left.output.overallRating ||
      right.output.confidence - left.output.confidence ||
      right.output.impactShare - left.output.impactShare ||
      right.trendDelta - left.trendDelta,
  );
}

export function buildBaseballLeaderboard(
  profiles: BaseballSeasonPlayerProfile[],
  options?: BaseballLeaderboardOptions,
): BaseballLeaderboardRow[] {
  const scope = options?.scope ?? "OVERALL_PLAYERS";
  const normalizedPosition = options?.position ? normalizeBaseballPosition(options.position) : null;
  const filtered = profiles.filter((profile) => {
    if (options?.teamId && profile.teamId !== options.teamId) {
      return false;
    }
    if (options?.role && profile.role !== options.role) {
      return false;
    }
    if (normalizedPosition && profile.position !== normalizedPosition) {
      return false;
    }

    switch (scope) {
      case "HITTERS":
        return profile.role === "HITTER" || profile.role === "TWO_WAY";
      case "PITCHERS":
        return profile.role === "STARTER" || profile.role === "RELIEVER" || profile.role === "TWO_WAY";
      case "STARTERS":
        return profile.role === "STARTER";
      case "RELIEVERS":
        return profile.role === "RELIEVER";
      case "POSITION":
        return normalizedPosition ? profile.position === normalizedPosition : true;
      case "TEAM_LEADERS":
        return options?.teamId ? profile.teamId === options.teamId : true;
      case "OVERALL_PLAYERS":
      default:
        return true;
    }
  });

  return filtered
    .map((profile) => ({
      playerId: profile.playerId,
      playerName: profile.playerName,
      teamId: profile.teamId,
      team: profile.teamName,
      position: profile.position,
      role: profile.role,
      overallRating: profile.output.overallRating,
      confidence: profile.output.confidence,
      trendDelta: profile.trendDelta,
      impactShare: profile.output.impactShare,
      seasonAverageRating: profile.seasonAverageRating,
      latestRating: profile.latestRating,
      profile,
    }))
    .sort(
      (left, right) =>
        right.overallRating - left.overallRating ||
        right.confidence - left.confidence ||
        right.impactShare - left.impactShare ||
        right.trendDelta - left.trendDelta,
    )
    .slice(0, options?.limit ?? filtered.length);
}

function makeTestBattingLine(partial: Partial<BaseballBattingLine>): BaseballBattingLine {
  return {
    atBats: 0,
    runs: 0,
    hits: 0,
    runsBattedIn: 0,
    homeRuns: 0,
    walks: 0,
    strikeouts: 0,
    doubles: 0,
    triples: 0,
    stolenBases: 0,
    caughtStealing: 0,
    hitByPitch: 0,
    sacrificeFlies: 0,
    plateAppearances: undefined,
    battingAverage: null,
    onBasePct: null,
    sluggingPct: null,
    ops: null,
    ...partial,
  };
}

function makeTestPitchingLine(partial: Partial<BaseballPitchingLine>): BaseballPitchingLine {
  return {
    inningsPitched: 0,
    hitsAllowed: 0,
    runsAllowed: 0,
    earnedRuns: 0,
    walks: 0,
    strikeouts: 0,
    homeRunsAllowed: 0,
    pitches: 0,
    strikes: 0,
    hitBatters: 0,
    appearances: 1,
    gamesStarted: 0,
    era: null,
    whip: null,
    ...partial,
  };
}

function makeTestFieldingLine(partial: Partial<BaseballFieldingLine>): BaseballFieldingLine {
  return {
    putouts: 0,
    assists: 0,
    errors: 0,
    doublePlays: 0,
    passedBalls: 0,
    caughtStealing: 0,
    fieldingPct: null,
    ...partial,
  };
}

export function runBaseballImpactSanityChecks(): Array<{
  name: string;
  passed: boolean;
  details: string;
}> {
  const sharedGame = {
    gameId: "g1",
    date: "2026-03-04",
    finalMargin: 1,
    isCloseGame: true,
    isLateInning: true,
    leverageKnown: true,
  };
  const eliteHitter = buildBaseballSeasonProfiles([
    {
      playerId: "elite-bat",
      playerName: "Elite Bat",
      teamId: "t1",
      teamName: "Team One",
      position: "SS",
      batting: makeTestBattingLine({
        atBats: 5,
        hits: 3,
        homeRuns: 2,
        runsBattedIn: 5,
        runs: 3,
        walks: 1,
      }),
      fielding: makeTestFieldingLine({ putouts: 3, assists: 4 }),
      game: sharedGame,
    },
  ])[0];
  const poorHitter = buildBaseballSeasonProfiles([
    {
      playerId: "poor-bat",
      playerName: "Poor Bat",
      teamId: "t1",
      teamName: "Team One",
      position: "DH",
      batting: makeTestBattingLine({
        atBats: 4,
        hits: 0,
        strikeouts: 3,
      }),
      game: sharedGame,
    },
  ])[0];
  const eliteStarter = buildBaseballSeasonProfiles([
    {
      playerId: "ace",
      playerName: "Ace",
      teamId: "t2",
      teamName: "Team Two",
      position: "P",
      pitching: makeTestPitchingLine({
        inningsPitched: 6,
        runsAllowed: 0,
        earnedRuns: 0,
        strikeouts: 8,
        hitsAllowed: 3,
        walks: 1,
      }),
      game: { ...sharedGame, starterHint: true },
    },
  ])[0];
  const poorReliever = buildBaseballSeasonProfiles([
    {
      playerId: "relief-bad",
      playerName: "Bad Reliever",
      teamId: "t2",
      teamName: "Team Two",
      position: "P",
      pitching: makeTestPitchingLine({
        inningsPitched: 1,
        runsAllowed: 3,
        earnedRuns: 3,
        hitsAllowed: 4,
      }),
      game: sharedGame,
    },
  ])[0];
  const shortstop = buildBaseballSeasonProfiles([
    {
      playerId: "ss",
      playerName: "Shortstop",
      teamId: "t3",
      teamName: "Team Three",
      position: "SS",
      batting: makeTestBattingLine({
        atBats: 4,
        hits: 2,
        runsBattedIn: 2,
      }),
      fielding: makeTestFieldingLine({ putouts: 2, assists: 4 }),
      game: sharedGame,
    },
    {
      playerId: "dh",
      playerName: "Designated Hitter",
      teamId: "t3",
      teamName: "Team Three",
      position: "DH",
      batting: makeTestBattingLine({
        atBats: 4,
        hits: 2,
        runsBattedIn: 2,
      }),
      game: sharedGame,
    },
  ]);
  const catcherVsCorner = buildBaseballSeasonProfiles([
    {
      playerId: "catcher",
      playerName: "Catcher",
      teamId: "t4",
      teamName: "Team Four",
      position: "C",
      batting: makeTestBattingLine({
        atBats: 4,
        hits: 2,
        runsBattedIn: 1,
      }),
      fielding: makeTestFieldingLine({ putouts: 8, assists: 1, caughtStealing: 1 }),
      game: sharedGame,
    },
    {
      playerId: "corner",
      playerName: "Corner",
      teamId: "t4",
      teamName: "Team Four",
      position: "1B",
      batting: makeTestBattingLine({
        atBats: 4,
        hits: 2,
        runsBattedIn: 1,
      }),
      game: sharedGame,
    },
  ]);

  return [
    {
      name: "elite hitter game rates elite",
      passed: (eliteHitter?.latestRating ?? 0) >= 8.5,
      details: `rating=${eliteHitter?.latestRating ?? 0}`,
    },
    {
      name: "0-for-4 hitter rates poorly",
      passed: (poorHitter?.latestRating ?? 10) <= 4.8,
      details: `rating=${poorHitter?.latestRating ?? 0}`,
    },
    {
      name: "6 IP 0 R 8 K starter rates elite",
      passed: (eliteStarter?.latestRating ?? 0) >= 8,
      details: `rating=${eliteStarter?.latestRating ?? 0}`,
    },
    {
      name: "1 IP 3 R reliever rates badly",
      passed: (poorReliever?.latestRating ?? 10) <= 4.5,
      details: `rating=${poorReliever?.latestRating ?? 0}`,
    },
    {
      name: "shortstop edges DH on same bat",
      passed:
        (shortstop.find((row) => row.playerId === "ss")?.output.overallRating ?? 0) >
        (shortstop.find((row) => row.playerId === "dh")?.output.overallRating ?? 0),
      details: `ss=${shortstop.find((row) => row.playerId === "ss")?.output.overallRating ?? 0}, dh=${shortstop.find((row) => row.playerId === "dh")?.output.overallRating ?? 0}`,
    },
    {
      name: "catcher defense boosts similar bat",
      passed:
        (catcherVsCorner.find((row) => row.playerId === "catcher")?.output.overallRating ?? 0) >
        (catcherVsCorner.find((row) => row.playerId === "corner")?.output.overallRating ?? 0),
      details: `c=${catcherVsCorner.find((row) => row.playerId === "catcher")?.output.overallRating ?? 0}, 1b=${catcherVsCorner.find((row) => row.playerId === "corner")?.output.overallRating ?? 0}`,
    },
  ];
}
