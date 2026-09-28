export type TeamSeasonStats = {
  pointsFor: number;
  pointsAgainst: number;
  possessions?: number | null;
  fga?: number | null;
  orb?: number | null;
  tov?: number | null;
  fta?: number | null;
};

export type LiveGameStats = {
  teamPoints: number;
  oppPoints: number;
  teamPossessions?: number | null;
  fga?: number | null;
  orb?: number | null;
  tov?: number | null;
  fta?: number | null;
  last5TeamPoints?: number | null;
  last5OppPoints?: number | null;
  last5TeamPossessions?: number | null;
};

function safePossessions(possessions?: number | null, stats?: { fga?: number | null; orb?: number | null; tov?: number | null; fta?: number | null }): number {
  if (typeof possessions === "number" && Number.isFinite(possessions) && possessions > 0) {
    return possessions;
  }
  const fga = stats?.fga ?? 0;
  const orb = stats?.orb ?? 0;
  const tov = stats?.tov ?? 0;
  const fta = stats?.fta ?? 0;
  const estimate = fga - orb + tov + 0.44 * fta;
  return estimate > 0 ? estimate : 1;
}

export function computeSeasonPowerRating(stats: TeamSeasonStats): number {
  const poss = safePossessions(stats.possessions, stats);
  const ortg = (stats.pointsFor / poss) * 100;
  const drtg = (stats.pointsAgainst / poss) * 100;
  return Number(((ortg - drtg + 100) / 20).toFixed(3));
}

export function computeLiveRating(stats: LiveGameStats, seasonPower: number | null) {
  const poss = safePossessions(stats.teamPossessions, stats);
  const gameNetRtg = ((stats.teamPoints - stats.oppPoints) / poss) * 100;
  const last5Poss = safePossessions(stats.last5TeamPossessions, {
    fga: stats.last5TeamPossessions ?? null,
  });
  const last5NetRtg =
    stats.last5TeamPoints != null && stats.last5OppPoints != null
      ? ((stats.last5TeamPoints - stats.last5OppPoints) / last5Poss) * 100
      : null;

  const baseline = seasonPower ?? 5;
  const liveRating = Number((baseline + gameNetRtg / 25 + (last5NetRtg ?? 0) / 40).toFixed(3));

  return {
    gameNetRtg: Number(gameNetRtg.toFixed(3)),
    last5NetRtg: last5NetRtg == null ? null : Number(last5NetRtg.toFixed(3)),
    liveRating,
  };
}