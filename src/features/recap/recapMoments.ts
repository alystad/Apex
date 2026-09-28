import type { LiveGameData, LiveGamePlay, LiveGameScoreMarginPoint } from "@/hooks/useLiveGame";

/**
 * A "biggest moment" of a finished game, condensed from the play-by-play.
 * `playId` is what the Recap tab hands to `requestPlayHighlight` so tapping a
 * moment scrolls the Plays tab to that exact play and flashes it.
 */
export type RecapMoment = {
  kind: "run" | "largest-lead" | "decider";
  /** Short bold label, e.g. "14-0 run". */
  label: string;
  /** Supporting line, e.g. "PHX, 8:55-4:20 Q3". */
  detail: string;
  /** Play to scroll to / highlight on the Plays tab. May be null if unmatched. */
  playId: string | null;
};

function parseScore(value: string | undefined): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function teamAbbrById(data: LiveGameData, teamId: string | null | undefined): string {
  if (!teamId) {
    return "";
  }
  const team = data.teams.find((entry) => entry.id === teamId);
  return team?.abbreviation || team?.shortDisplayName || "";
}

function sideAbbr(data: LiveGameData, side: "away" | "home"): string {
  const team =
    data.teams.find((entry) => entry.homeAway === side) ??
    (side === "away" ? data.teams[0] : data.teams[1]);
  return team?.abbreviation || team?.shortDisplayName || side.toUpperCase();
}

/**
 * Largest single-team scoring run in the game: the longest stretch of
 * consecutive scoring plays where only one side's score advances. Returns the
 * play that CLOSED the run, so tapping it lands on the run's final basket.
 */
function findBiggestRun(data: LiveGameData): RecapMoment | null {
  const scoringPlays = data.plays.filter((play) => play.scoringPlay);
  if (scoringPlays.length < 2) {
    return null;
  }
  // Plays arrive newest-first from the feed in some modes; sort oldest-first
  // by score total so the run walk below is chronological regardless.
  const ordered = [...scoringPlays].sort(
    (a, b) =>
      parseScore(a.awayScore) + parseScore(a.homeScore) -
      (parseScore(b.awayScore) + parseScore(b.homeScore)),
  );

  let best: { points: number; side: "away" | "home"; start: LiveGamePlay; end: LiveGamePlay } | null =
    null;
  let runSide: "away" | "home" | null = null;
  let runPoints = 0;
  let runStart: LiveGamePlay | null = null;

  for (let index = 1; index < ordered.length; index += 1) {
    const prev = ordered[index - 1];
    const play = ordered[index];
    const awayDelta = parseScore(play.awayScore) - parseScore(prev.awayScore);
    const homeDelta = parseScore(play.homeScore) - parseScore(prev.homeScore);
    const side: "away" | "home" | null =
      awayDelta > 0 && homeDelta === 0 ? "away" : homeDelta > 0 && awayDelta === 0 ? "home" : null;
    const delta = side === "away" ? awayDelta : side === "home" ? homeDelta : 0;

    if (!side) {
      runSide = null;
      runPoints = 0;
      runStart = null;
      continue;
    }
    if (side !== runSide) {
      runSide = side;
      runPoints = delta;
      runStart = prev;
    } else {
      runPoints += delta;
    }
    if (runStart && (!best || runPoints > best.points)) {
      best = { points: runPoints, side, start: runStart, end: play };
    }
  }

  if (!best || best.points < 6) {
    return null;
  }

  const abbr = sideAbbr(data, best.side);
  const startLabel = `${best.start.clock || ""} ${best.start.period || ""}`.trim();
  const endLabel = `${best.end.clock || ""} ${best.end.period || ""}`.trim();
  return {
    kind: "run",
    label: `${best.points}-0 run`,
    detail: [abbr, [startLabel, endLabel].filter(Boolean).join(" – ")].filter(Boolean).join(", "),
    playId: best.end.id,
  };
}

/** Largest lead either side held, taken from the score-margin series. */
function findLargestLead(data: LiveGameData): RecapMoment | null {
  const series: LiveGameScoreMarginPoint[] = data.scoreMargin ?? [];
  if (series.length === 0) {
    return null;
  }
  let peak = series[0];
  for (const point of series) {
    if (Math.abs(point.margin) > Math.abs(peak.margin)) {
      peak = point;
    }
  }
  if (Math.abs(peak.margin) < 2) {
    return null;
  }
  // Positive margin = home leading (matches PointDifferentialChart's
  // home-on-top convention).
  const abbr = sideAbbr(data, peak.margin > 0 ? "home" : "away");
  const matching = data.plays.find(
    (play) =>
      parseScore(play.awayScore) === peak.awayScore &&
      parseScore(play.homeScore) === peak.homeScore,
  );
  return {
    kind: "largest-lead",
    label: `${Math.abs(peak.margin)}-point lead`,
    detail: [abbr, matching ? `${matching.clock} ${matching.period}`.trim() : ""]
      .filter(Boolean)
      .join(", "),
    playId: matching?.id ?? null,
  };
}

/**
 * The play that sealed it: the last scoring play that moved the game to its
 * final margin or beyond — i.e. the basket after which the trailing side never
 * drew level again.
 */
function findDecider(data: LiveGameData): RecapMoment | null {
  const scoringPlays = data.plays.filter((play) => play.scoringPlay);
  if (scoringPlays.length === 0) {
    return null;
  }
  const ordered = [...scoringPlays].sort(
    (a, b) =>
      parseScore(a.awayScore) + parseScore(a.homeScore) -
      (parseScore(b.awayScore) + parseScore(b.homeScore)),
  );
  const last = ordered[ordered.length - 1];
  const finalAway = parseScore(last.awayScore);
  const finalHome = parseScore(last.homeScore);
  const winnerIsHome = finalHome > finalAway;

  // Walk back to the last point at which the eventual winner was NOT ahead;
  // the play right after that is where they took the lead for good.
  let sealIndex = 0;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const away = parseScore(ordered[index].awayScore);
    const home = parseScore(ordered[index].homeScore);
    const winnerAhead = winnerIsHome ? home > away : away > home;
    if (!winnerAhead) {
      sealIndex = Math.min(index + 1, ordered.length - 1);
      break;
    }
  }
  const seal = ordered[sealIndex];
  if (!seal) {
    return null;
  }
  const abbr = teamAbbrById(data, seal.teamId) || sideAbbr(data, winnerIsHome ? "home" : "away");
  return {
    kind: "decider",
    label: "Lead for good",
    detail: [abbr, `${seal.clock || ""} ${seal.period || ""}`.trim()].filter(Boolean).join(", "),
    playId: seal.id,
  };
}

export type BuildRecapMomentsOptions = {
  /**
   * Whether to include the "lead for good" moment. Only meaningful once a
   * game is final — mid-game there is no eventual winner yet, so computing it
   * would just label whoever happens to be ahead right now as having sealed
   * it. Defaults to true (the Recap case); the Live state passes false.
   */
  includeDecider?: boolean;
};

/**
 * The biggest moments of a game, in narrative order (biggest run, largest
 * lead, and — once final — the play that sealed it). Entries that can't be
 * derived from the available play data are simply omitted, so this returns a
 * sensible partial list for a game still in progress.
 */
export function buildRecapMoments(
  data: LiveGameData | null,
  options: BuildRecapMomentsOptions = {},
): RecapMoment[] {
  const { includeDecider = true } = options;
  if (!data || (data.plays?.length ?? 0) === 0) {
    return [];
  }
  return [
    findBiggestRun(data),
    findLargestLead(data),
    includeDecider ? findDecider(data) : null,
  ].filter((moment): moment is RecapMoment => moment !== null);
}
