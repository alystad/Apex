import type { LiveGameData, LiveGamePlayer, LiveGameTeam } from "@/hooks/useLiveGame";

function parseScore(value: string | undefined): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Parses a "made-attempted" stat string (e.g. "5-9") into its made count. */
function parseMade(value: string | undefined): number {
  const made = Number.parseInt((value ?? "").split("-")[0]?.trim() ?? "", 10);
  return Number.isFinite(made) ? made : 0;
}

function teamName(team: LiveGameTeam | undefined): string {
  return team?.shortDisplayName || team?.displayName || team?.abbreviation || "";
}

// ---------------------------------------------------------------------------
// 1. Competitiveness — lead changes and ties
// ---------------------------------------------------------------------------

export type GameCompetitiveness = {
  leadChanges: number;
  ties: number;
};

/**
 * Walks the scoring progression counting how often the lead actually flipped
 * sides and how often the game was level. A tie is counted once per time the
 * score becomes level (not once per play while it stays level), and a lead
 * change requires the leader to switch from one side to the other — going
 * ahead → tied → ahead again for the same team is a tie, not a lead change.
 */
export function computeCompetitiveness(data: LiveGameData | null): GameCompetitiveness {
  const empty = { leadChanges: 0, ties: 0 };
  if (!data) {
    return empty;
  }

  // Prefer the score-margin series (already ordered and deduped); fall back to
  // scoring plays when it isn't populated.
  const progression: Array<{ away: number; home: number }> = (data.scoreMargin ?? []).length
    ? data.scoreMargin.map((point) => ({ away: point.awayScore, home: point.homeScore }))
    : [...(data.plays ?? [])]
        .filter((play) => play.scoringPlay)
        .map((play) => ({
          away: parseScore(play.awayScore),
          home: parseScore(play.homeScore),
        }))
        .sort((a, b) => a.away + a.home - (b.away + b.home));

  if (progression.length === 0) {
    return empty;
  }

  let leadChanges = 0;
  let ties = 0;
  // "Who was ahead last time the game was NOT level" — comparing against this
  // rather than the immediately previous state is what keeps
  // ahead → tied → ahead-again from counting as a lead change.
  let lastLeader: "away" | "home" | null = null;
  let wasTied = false;

  for (const { away, home } of progression) {
    if (away === home) {
      if (!wasTied) {
        ties += 1;
        wasTied = true;
      }
      continue;
    }
    wasTied = false;
    const leader: "away" | "home" = home > away ? "home" : "away";
    if (lastLeader && leader !== lastLeader) {
      leadChanges += 1;
    }
    lastLeader = leader;
  }

  return { leadChanges, ties };
}

// ---------------------------------------------------------------------------
// 2. Notable individual stat lines
// ---------------------------------------------------------------------------

export type NotableStatLine = {
  player: LiveGamePlayer;
  /** e.g. "14 pts, 15 reb". */
  statLine: string;
  /** e.g. "Double-double". */
  badge: string;
};

function countDoubleDigit(player: LiveGamePlayer): number {
  return [player.points, player.rebounds, player.assists, player.steals, player.blocks].filter(
    (value) => (value ?? 0) >= 10,
  ).length;
}

/**
 * Player achievements worth calling out beyond raw scoring: triple-doubles,
 * double-doubles, near triple-doubles, hot shooting nights, and outlier
 * rebounding/defensive games. One entry per player (best qualifying badge),
 * ordered by how notable the achievement is.
 */
export function buildNotableStatLines(data: LiveGameData | null): NotableStatLine[] {
  if (!data) {
    return [];
  }
  const players = Object.values(data.playersByTeam ?? {}).flat();
  const entries: Array<NotableStatLine & { rank: number }> = [];

  for (const player of players) {
    if (player.didNotPlay) {
      continue;
    }
    const points = player.points ?? 0;
    const rebounds = player.rebounds ?? 0;
    const assists = player.assists ?? 0;
    const steals = player.steals ?? 0;
    const blocks = player.blocks ?? 0;
    const threes = parseMade(player.threePt);
    const doubleDigits = countDoubleDigit(player);

    // Highest-ranking qualifying badge only, so one player never occupies
    // several rows of a short list.
    let badge: string | null = null;
    let rank = 0;
    const parts: string[] = [`${points} pts`];

    // Badge text is deliberately short. These render in a narrow uppercase
    // pill next to the stat line, and anything longer than ~11 characters
    // ellipsized mid-word there ("NEAR TRIPLE-D…").
    if (doubleDigits >= 3) {
      badge = "Triple-Dbl";
      rank = 5;
    } else if (
      doubleDigits === 2 &&
      [points, rebounds, assists, steals, blocks].filter((value) => (value ?? 0) >= 8).length >= 3
    ) {
      badge = "Near T-Dbl";
      rank = 4;
    } else if (doubleDigits >= 2) {
      badge = "Double-Dbl";
      rank = 3;
    } else if (threes >= 5) {
      badge = `${threes} Threes`;
      rank = 2;
    } else if (rebounds >= 12) {
      badge = "Boards";
      rank = 1;
    } else if (steals + blocks >= 5) {
      badge = "Defense";
      rank = 1;
    }

    if (!badge) {
      continue;
    }

    // Fill out the stat line with whichever secondary categories are actually
    // meaningful for this particular achievement.
    if (rebounds >= 5) parts.push(`${rebounds} reb`);
    if (assists >= 5) parts.push(`${assists} ast`);
    if (steals >= 3) parts.push(`${steals} stl`);
    if (blocks >= 3) parts.push(`${blocks} blk`);
    if (threes >= 5) parts.push(`${threes} 3pm`);

    entries.push({
      player,
      statLine: parts.join(", "),
      badge,
      rank,
    });
  }

  return entries
    .sort((a, b) => b.rank - a.rank || (b.player.points ?? 0) - (a.player.points ?? 0))
    .slice(0, 4)
    .map(({ player, statLine, badge }) => ({ player, statLine, badge }));
}

// ---------------------------------------------------------------------------
// 3. Bench vs. starters scoring
// ---------------------------------------------------------------------------

export type BenchScoringSplit = {
  teamId: string;
  teamName: string;
  benchPoints: number;
  starterPoints: number;
};

export type BenchScoringComparison = {
  splits: BenchScoringSplit[];
  /** Ready-to-render line, e.g. "Dallas' bench outscored Toronto's 28-12". */
  summary: string | null;
};

export function computeBenchScoring(data: LiveGameData | null): BenchScoringComparison {
  if (!data) {
    return { splits: [], summary: null };
  }
  const splits: BenchScoringSplit[] = (data.teams ?? []).map((team) => {
    const roster = data.playersByTeam?.[team.id] ?? [];
    let benchPoints = 0;
    let starterPoints = 0;
    for (const player of roster) {
      const points = player.points ?? 0;
      if (player.starter) {
        starterPoints += points;
      } else {
        benchPoints += points;
      }
    }
    return { teamId: team.id, teamName: teamName(team), benchPoints, starterPoints };
  });

  if (splits.length < 2) {
    return { splits, summary: null };
  }

  const [first, second] = [...splits].sort((a, b) => b.benchPoints - a.benchPoints);
  const summary =
    first.benchPoints === second.benchPoints
      ? `Benches matched each other, ${first.benchPoints}-${second.benchPoints}`
      : `${first.teamName}'s bench outscored ${second.teamName}'s, ${first.benchPoints}-${second.benchPoints}`;

  return { splits, summary };
}

// ---------------------------------------------------------------------------
// 4. "How it was won" tag
// ---------------------------------------------------------------------------

export type HowItWasWonTag = {
  /** Badge text, e.g. "Won on the boards". */
  label: string;
  /** Supporting detail, e.g. "DAL 48 – TOR 33". */
  detail: string;
};

type WinCategory = {
  label: string;
  /** Per-team value; higher is better for the winner. */
  valueFor: (team: LiveGameTeam, data: LiveGameData) => number | null;
  /** Minimum edge before the category is considered decisive. */
  minEdge: number;
  /** Scales raw edges onto a comparable "how decisive" scale across categories. */
  weight: number;
};

const WIN_CATEGORIES: WinCategory[] = [
  {
    label: "Won on the boards",
    valueFor: (team) => Number.parseInt(team.totals?.rebounds ?? "", 10) || null,
    minEdge: 6,
    weight: 1,
  },
  {
    label: "Won from three",
    valueFor: (team) => parseMade(team.totals?.threePt) || null,
    minEdge: 4,
    weight: 2,
  },
  {
    label: "Won at the free-throw line",
    valueFor: (team) => parseMade(team.totals?.ft) || null,
    minEdge: 6,
    weight: 1.4,
  },
  {
    label: "Won with ball movement",
    valueFor: (team) => Number.parseInt(team.totals?.assists ?? "", 10) || null,
    minEdge: 6,
    weight: 1.2,
  },
  {
    label: "Won off the bench",
    valueFor: (team) => Number.parseInt(team.totals?.benchPoints ?? "", 10) || null,
    minEdge: 10,
    weight: 0.9,
  },
  {
    label: "Won on turnovers",
    // Fewer turnovers is better, so invert into an "edge" the same direction
    // as every other category.
    valueFor: (team) => {
      const value = Number.parseInt(team.totals?.turnovers ?? "", 10);
      return Number.isFinite(value) ? -value : null;
    },
    minEdge: 6,
    weight: 1.1,
  },
];

/**
 * Single badge naming whatever the winning team's largest statistical edge
 * was. Categories are normalized by weight so a 5-three edge can outrank a
 * 7-rebound one; returns null when the game was a tie or no category cleared
 * its threshold (i.e. it genuinely wasn't won in any one obvious way).
 */
export function computeHowItWasWon(data: LiveGameData | null): HowItWasWonTag | null {
  if (!data) {
    return null;
  }
  const teams = data.teams ?? [];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];
  if (!away || !home) {
    return null;
  }
  const awayScore = parseScore(away.score);
  const homeScore = parseScore(home.score);
  if (awayScore === homeScore) {
    return null;
  }
  const winner = awayScore > homeScore ? away : home;
  const loser = awayScore > homeScore ? home : away;

  let best: { category: WinCategory; edge: number; winnerValue: number; loserValue: number } | null =
    null;

  for (const category of WIN_CATEGORIES) {
    const winnerValue = category.valueFor(winner, data);
    const loserValue = category.valueFor(loser, data);
    if (winnerValue === null || loserValue === null) {
      continue;
    }
    const edge = winnerValue - loserValue;
    if (edge < category.minEdge) {
      continue;
    }
    const scaled = edge * category.weight;
    if (!best || scaled > best.edge * best.category.weight) {
      best = { category, edge, winnerValue, loserValue };
    }
  }

  if (!best) {
    return null;
  }

  // Turnovers were negated for comparison — flip back for display.
  const isTurnovers = best.category.label === "Won on turnovers";
  const winnerDisplay = isTurnovers ? -best.winnerValue : best.winnerValue;
  const loserDisplay = isTurnovers ? -best.loserValue : best.loserValue;

  return {
    label: best.category.label,
    detail: `${winner.abbreviation || teamName(winner)} ${winnerDisplay} – ${loser.abbreviation || teamName(loser)} ${loserDisplay}`,
  };
}

// ---------------------------------------------------------------------------
// 5. Per-quarter scoring, used as input to the AI quarter narrative
// ---------------------------------------------------------------------------

export type QuarterScoring = {
  /** "Q1".."Q4" / "1H","2H", plus OT labels. */
  label: string;
  awayPoints: number;
  homePoints: number;
};

export function buildQuarterScoring(
  data: LiveGameData | null,
  periodLabels: string[],
): QuarterScoring[] {
  if (!data) {
    return [];
  }
  const teams = data.teams ?? [];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];
  if (!away || !home) {
    return [];
  }
  return periodLabels.map((label, index) => ({
    label,
    awayPoints: parseScore(away.linescores?.[index]),
    homePoints: parseScore(home.linescores?.[index]),
  }));
}

// ---------------------------------------------------------------------------
// 6. Biggest Surprise — final in-game rating vs. season rating
// ---------------------------------------------------------------------------

export type SurprisePerformance = {
  player: LiveGamePlayer;
  kind: "overperformer" | "underperformer";
  /** Signed final-vs-season delta, e.g. +2.1 or -1.8. */
  delta: number;
  /** e.g. "Caitlin Clark finished +2.1 above season average." */
  detail: string;
};

// Below this delta magnitude a game is closer to normal night-to-night
// fluctuation than an actual surprise — skip the section rather than
// surface something that reads as noise.
const MIN_SURPRISE_DELTA = 0.5;

function formatSurpriseDetail(playerName: string, delta: number): string {
  const magnitude = Math.abs(delta).toFixed(1);
  // "Below" already carries the negative sign — a leading "-" too would read
  // as a double negative ("-1.8 below"), so only the overperformer case gets
  // an explicit "+".
  return delta >= 0
    ? `${playerName} finished +${magnitude} above season average.`
    : `${playerName} finished ${magnitude} below season average.`;
}

/**
 * The game's biggest overperformer and underperformer relative to their OWN
 * season rating — the only "how does this compare to their normal level"
 * signal already available (no per-game history is tracked, just the season
 * aggregate), so this deliberately compares final in-game rating against
 * season rating rather than framing itself as "vs. their last N games."
 * Requires BOTH a played game (`!didNotPlay`) and a known season rating —
 * players with no season baseline can't have a "surprise" relative to one.
 */
export function computeBiggestSurprise(data: LiveGameData | null): SurprisePerformance[] {
  if (!data) {
    return [];
  }
  const players = Object.values(data.playersByTeam ?? {}).flat();
  const eligible = players
    .filter((player) => !player.didNotPlay)
    .map((player) => {
      if (
        typeof player.inGameRating10 !== "number" ||
        typeof player.seasonRating10 !== "number"
      ) {
        return null;
      }
      return {
        player,
        delta: Number((player.inGameRating10 - player.seasonRating10).toFixed(1)),
      };
    })
    .filter((entry): entry is { player: LiveGamePlayer; delta: number } => entry !== null);

  if (eligible.length === 0) {
    return [];
  }

  const overperformer = eligible.reduce((best, entry) => (entry.delta > best.delta ? entry : best));
  const underperformer = eligible.reduce((worst, entry) => (entry.delta < worst.delta ? entry : worst));

  const results: SurprisePerformance[] = [];
  if (overperformer.delta >= MIN_SURPRISE_DELTA) {
    const name = overperformer.player.shortName || overperformer.player.name;
    results.push({
      player: overperformer.player,
      kind: "overperformer",
      delta: overperformer.delta,
      detail: formatSurpriseDetail(name, overperformer.delta),
    });
  }
  // Different players by construction whenever both qualify (one is the max
  // delta, the other the min), except in the degenerate single-player-game
  // case — guard anyway so the card never shows the same person twice.
  if (
    underperformer.delta <= -MIN_SURPRISE_DELTA &&
    underperformer.player.id !== overperformer.player.id
  ) {
    const name = underperformer.player.shortName || underperformer.player.name;
    results.push({
      player: underperformer.player,
      kind: "underperformer",
      delta: underperformer.delta,
      detail: formatSurpriseDetail(name, underperformer.delta),
    });
  }
  return results;
}
