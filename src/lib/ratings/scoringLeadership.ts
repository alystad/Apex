export type ScoringLeadershipInput = {
  playerPoints: number;
  teammatePoints: number[];
  fga: number;
  fta: number;
  tov: number;
  points: number;
  bonusCap?: number;
  shareBase?: number;
  shareScale?: number;
  gapScale?: number;
  tsBaseline?: number;
  tsScale?: number;
  tovBaseline?: number;
  tovScale?: number;
  shareWeight?: number;
  gapWeight?: number;
};

export type ScoringLeadershipResult = {
  multiplier: number;
  bonusRaw: number;
  shareNorm: number;
  gapNorm: number;
  ineffSeverity: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeScoringLeadershipMultiplier(
  input: ScoringLeadershipInput,
): ScoringLeadershipResult {
  const teamPointsTotal =
    Math.max(0, input.playerPoints) +
    input.teammatePoints.reduce((sum, value) => sum + Math.max(0, value), 0);
  const safeTeamPoints = Math.max(1, teamPointsTotal);
  const pointsShare = Math.max(0, input.playerPoints) / safeTeamPoints;
  const nextTeammatePoints = input.teammatePoints.length
    ? Math.max(...input.teammatePoints.map((value) => Math.max(0, value)))
    : 0;
  const pointsGap = Math.max(0, input.playerPoints - nextTeammatePoints);

  const shareNorm = clamp(
    (pointsShare - (input.shareBase ?? 0.18)) / (input.shareScale ?? 0.22),
    0,
    1,
  );
  const gapNorm = clamp(pointsGap / (input.gapScale ?? 12), 0, 1);

  const tsDen = 2 * (Math.max(0, input.fga) + 0.44 * Math.max(0, input.fta));
  const tsPct = tsDen > 0 ? Math.max(0, input.points) / tsDen : input.tsBaseline ?? 0.52;
  const ineffNorm = clamp(
    ((input.tsBaseline ?? 0.52) - tsPct) / (input.tsScale ?? 0.22),
    0,
    1,
  );
  const tovNorm = clamp(
    (Math.max(0, input.tov) - (input.tovBaseline ?? 3)) / (input.tovScale ?? 4),
    0,
    1,
  );
  const ineffSeverity = clamp(0.7 * ineffNorm + 0.3 * tovNorm, 0, 1);

  const bonusRaw = Math.min(
    input.bonusCap ?? 0.2,
    (input.shareWeight ?? 0.12) * shareNorm + (input.gapWeight ?? 0.08) * gapNorm,
  );
  const multiplier = clamp(1 + bonusRaw * (1 - ineffSeverity), 1, 1 + (input.bonusCap ?? 0.2));

  return {
    multiplier,
    bonusRaw,
    shareNorm,
    gapNorm,
    ineffSeverity,
  };
}
