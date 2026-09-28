import type { LiveGameData, LiveGamePlay, LiveGamePlayer } from "@/hooks/useLiveGame";

/**
 * Detects "highlight-worthy" clusters of plays for the narrated Highlights
 * reel on the Live and Recap states of the story tab.
 *
 * This reuses the same underlying signals the Biggest Moments and Notable
 * Performances sections already key off — scoring runs, lead changes,
 * clutch-context plays and standout individual stretches — but groups
 * CONSECUTIVE related plays into one moment rather than emitting a row per
 * play, so each entry can be narrated as a single beat of the game.
 *
 * Detection here is fully deterministic and offline; the AI is only asked to
 * put prose around clusters this file has already identified (see
 * useHighlightReel). That keeps the model from inventing moments that never
 * happened.
 */

export type HighlightKind = "run" | "lead-change" | "player-surge" | "clutch";

export type HighlightCluster = {
  /** Stable across polls so an already-narrated cluster is never re-narrated. */
  id: string;
  kind: HighlightKind;
  period: string;
  /** Clock at the START of the cluster — where the moment begins. */
  clock: string;
  /** Chronological index of the cluster's first play, for ordering. */
  order: number;
  /** Every play in the cluster; the first is the scroll-to anchor. */
  playIds: string[];
  /** Raw factual description handed to the model to narrate. Never shown raw. */
  facts: string;
  /**
   * Which team this moment belongs to, for the two-column team timeline in
   * HighlightsCard — null only in the rare case neither a scoring side nor a
   * named player could be resolved (the card falls back to whichever side is
   * "up" at render time in that case).
   */
  teamId: string | null;
};

type OrderedPlay = LiveGamePlay & {
  periodRank: number;
  clockRemaining: number;
  chronoIndex: number;
};

function parseClockRemaining(clock: string): number {
  const match = (clock ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return 0;
  }
  const minutes = Number.parseInt(match[1], 10);
  const seconds = Number.parseInt(match[2], 10);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return 0;
  }
  return minutes * 60 + seconds;
}

function parsePeriodRank(period: string): number {
  const upper = (period ?? "").toUpperCase();
  const otMatch = upper.match(/OT\s*(\d+)?/);
  if (otMatch) {
    const otNumber = otMatch[1] ? Number.parseInt(otMatch[1], 10) : 1;
    return 100 + (Number.isFinite(otNumber) ? otNumber : 1);
  }
  const numMatch = upper.match(/(\d+)/);
  if (numMatch) {
    const parsed = Number.parseInt(numMatch[1], 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseScore(value: string | undefined): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Chronological ordering: period ascending, then clock DESCENDING within a
 * period (clocks count down). Mirrors the Plays tab's own ordering, inverted
 * to oldest-first.
 */
function orderPlaysChronologically(plays: LiveGamePlay[]): OrderedPlay[] {
  return [...plays]
    .map((play) => ({
      ...play,
      periodRank: parsePeriodRank(play.period),
      clockRemaining: parseClockRemaining(play.clock),
      chronoIndex: 0,
    }))
    .sort((a, b) => {
      if (a.periodRank !== b.periodRank) {
        return a.periodRank - b.periodRank;
      }
      return b.clockRemaining - a.clockRemaining;
    })
    .map((play, index) => ({ ...play, chronoIndex: index }));
}

function teamAbbr(data: LiveGameData, teamId: string | null | undefined): string {
  if (!teamId) {
    return "";
  }
  const team = data.teams?.find((entry) => entry.id === teamId);
  return team?.abbreviation || team?.shortDisplayName || "";
}

function sideAbbr(data: LiveGameData, side: "away" | "home"): string {
  const team =
    data.teams?.find((entry) => entry.homeAway === side) ??
    (side === "away" ? data.teams?.[0] : data.teams?.[1]);
  return team?.abbreviation || team?.shortDisplayName || side.toUpperCase();
}

function teamIdForSide(data: LiveGameData, side: "away" | "home"): string | null {
  const team =
    data.teams?.find((entry) => entry.homeAway === side) ??
    (side === "away" ? data.teams?.[0] : data.teams?.[1]);
  return team?.id ?? null;
}

/**
 * Which side scored on a given scoring play, by comparing it against the
 * PRECEDING scoring play's score line — same delta logic the run-detection
 * loop below uses inline, extracted so clutch clusters (which don't already
 * walk consecutive pairs) can resolve a team without a named player.
 */
function scoringSideAt(scoringPlays: OrderedPlay[], index: number): "away" | "home" | null {
  const play = scoringPlays[index];
  const prev = scoringPlays[index - 1];
  const awayDelta = parseScore(play.awayScore) - parseScore(prev?.awayScore);
  const homeDelta = parseScore(play.homeScore) - parseScore(prev?.homeScore);
  if (awayDelta > 0 && homeDelta === 0) {
    return "away";
  }
  if (homeDelta > 0 && awayDelta === 0) {
    return "home";
  }
  return null;
}

/** Finds the player a play's text refers to, so player-level clusters can name them. */
function findPlayerInText(text: string, players: LiveGamePlayer[]): LiveGamePlayer | null {
  const lower = (text ?? "").toLowerCase();
  if (!lower) {
    return null;
  }
  // Prefer the longest matching name so "J. Smith" doesn't win over "Jordan Smith".
  let best: LiveGamePlayer | null = null;
  for (const player of players) {
    const candidates = [player.name, player.shortName, player.lastName].filter(
      (value): value is string => Boolean(value && value.length >= 3),
    );
    for (const candidate of candidates) {
      if (lower.includes(candidate.toLowerCase())) {
        if (!best || candidate.length > (best.name?.length ?? 0)) {
          best = player;
        }
        break;
      }
    }
  }
  return best;
}

// Minimum points for a one-sided stretch to count as a "run" worth narrating.
const MIN_RUN_POINTS = 7;
// A player scoring at least this much inside one cluster window is a surge.
const MIN_PLAYER_SURGE_POINTS = 5;
// Clutch = final two minutes of the last regulation period or any overtime,
// with the game within one possession.
const CLUTCH_CLOCK_SECONDS = 120;
const CLUTCH_MARGIN = 3;
// Cap on how many plays one cluster may span, so a moment stays a moment.
const MAX_CLUSTER_PLAYS = 4;

/**
 * Walks the play-by-play once and emits every highlight-worthy cluster, in
 * chronological order.
 */
export function buildHighlightClusters(data: LiveGameData | null): HighlightCluster[] {
  if (!data || (data.plays?.length ?? 0) === 0) {
    return [];
  }

  const ordered = orderPlaysChronologically(data.plays);
  const scoringPlays = ordered.filter((play) => play.scoringPlay);
  if (scoringPlays.length < 2) {
    return [];
  }

  const players = Object.values(data.playersByTeam ?? {}).flat();
  const lastRegulationPeriod = Math.max(
    ...ordered.map((play) => play.periodRank).filter((rank) => rank < 100),
    0,
  );

  const clusters: HighlightCluster[] = [];
  const seenIds = new Set<string>();
  const pushCluster = (cluster: HighlightCluster) => {
    if (cluster.playIds.length === 0 || seenIds.has(cluster.id)) {
      return;
    }
    seenIds.add(cluster.id);
    clusters.push(cluster);
  };

  // ---- Runs and lead changes -------------------------------------------
  let runSide: "away" | "home" | null = null;
  let runPoints = 0;
  let runPlays: OrderedPlay[] = [];
  let previousLeader: "away" | "home" | null = null;

  const flushRun = () => {
    if (runSide && runPoints >= MIN_RUN_POINTS && runPlays.length > 0) {
      const window = runPlays.slice(0, MAX_CLUSTER_PLAYS);
      const first = window[0];
      const abbr = sideAbbr(data, runSide);
      pushCluster({
        id: `run:${first.id}`,
        kind: "run",
        period: first.period,
        clock: first.clock,
        order: first.chronoIndex,
        playIds: window.map((play) => play.id),
        facts:
          `${abbr} went on a ${runPoints}-0 run over ${runPlays.length} scoring plays, ` +
          `from ${first.clock} ${first.period} to ${runPlays[runPlays.length - 1].clock} ${runPlays[runPlays.length - 1].period}. ` +
          `Plays: ${window.map((play) => play.text).filter(Boolean).join(" | ")}`,
        teamId: teamIdForSide(data, runSide),
      });
    }
    runSide = null;
    runPoints = 0;
    runPlays = [];
  };

  for (let index = 1; index < scoringPlays.length; index += 1) {
    const prev = scoringPlays[index - 1];
    const play = scoringPlays[index];
    const awayDelta = parseScore(play.awayScore) - parseScore(prev.awayScore);
    const homeDelta = parseScore(play.homeScore) - parseScore(prev.homeScore);
    const side: "away" | "home" | null =
      awayDelta > 0 && homeDelta === 0 ? "away" : homeDelta > 0 && awayDelta === 0 ? "home" : null;
    const delta = side === "away" ? awayDelta : side === "home" ? homeDelta : 0;

    // Lead change detection, independent of run tracking.
    const away = parseScore(play.awayScore);
    const home = parseScore(play.homeScore);
    if (away !== home) {
      const leader: "away" | "home" = home > away ? "home" : "away";
      if (previousLeader && leader !== previousLeader) {
        pushCluster({
          id: `lead:${play.id}`,
          kind: "lead-change",
          period: play.period,
          clock: play.clock,
          order: play.chronoIndex,
          playIds: [play.id],
          facts:
            `${sideAbbr(data, leader)} took the lead ${Math.max(away, home)}-${Math.min(away, home)} ` +
            `at ${play.clock} ${play.period}. Play: ${play.text}`,
          teamId: teamIdForSide(data, leader),
        });
      }
      previousLeader = leader;
    }

    if (!side) {
      flushRun();
      continue;
    }
    if (side !== runSide) {
      flushRun();
      runSide = side;
      runPoints = delta;
      // Only the scoring side's OWN plays belong to the run. Seeding this
      // with `prev` (the opponent's preceding basket) both mislabelled the
      // run's start time and put the other team's play in its play list.
      runPlays = [play];
    } else {
      runPoints += delta;
      runPlays.push(play);
    }
  }
  flushRun();

  // ---- Player surges ----------------------------------------------------
  // Slide a short window over consecutive scoring plays; if one player owns
  // enough of the scoring inside it, that's a surge worth narrating.
  //
  // The window advances one play at a time, so a single hot stretch is seen
  // from several starting offsets and would emit near-duplicate clusters for
  // the same run of baskets. Tracking which plays are already inside an
  // emitted surge for that player keeps only the first (longest) view of it.
  const playsClaimedBySurge = new Map<string, Set<string>>();
  for (let index = 0; index < scoringPlays.length; index += 1) {
    const window = scoringPlays.slice(index, index + MAX_CLUSTER_PLAYS);
    if (window.length < 2) {
      break;
    }
    // Window must stay within one period to read as a single moment.
    if (window.some((play) => play.periodRank !== window[0].periodRank)) {
      continue;
    }

    const byPlayer = new Map<string, { player: LiveGamePlayer; plays: OrderedPlay[]; points: number }>();
    for (let offset = 0; offset < window.length; offset += 1) {
      const play = window[offset];
      const player = findPlayerInText(play.text, players);
      if (!player) {
        continue;
      }
      const prev = scoringPlays[index + offset - 1];
      const points = prev
        ? Math.max(
            parseScore(play.awayScore) - parseScore(prev.awayScore),
            parseScore(play.homeScore) - parseScore(prev.homeScore),
          )
        : 0;
      const entry = byPlayer.get(player.id) ?? { player, plays: [], points: 0 };
      entry.plays.push(play);
      entry.points += Math.max(0, points);
      byPlayer.set(player.id, entry);
    }

    for (const entry of byPlayer.values()) {
      if (entry.plays.length < 2 || entry.points < MIN_PLAYER_SURGE_POINTS) {
        continue;
      }
      const claimed = playsClaimedBySurge.get(entry.player.id) ?? new Set<string>();
      // Any overlap with a surge already emitted for this player means this is
      // the same hot stretch seen from a later offset — skip it.
      if (entry.plays.some((play) => claimed.has(play.id))) {
        continue;
      }
      entry.plays.forEach((play) => claimed.add(play.id));
      playsClaimedBySurge.set(entry.player.id, claimed);

      const first = entry.plays[0];
      pushCluster({
        id: `surge:${entry.player.id}:${first.id}`,
        kind: "player-surge",
        period: first.period,
        clock: first.clock,
        order: first.chronoIndex,
        playIds: entry.plays.map((play) => play.id),
        facts:
          `${entry.player.name} (${teamAbbr(data, entry.player.teamId)}) scored ${entry.points} points ` +
          `across ${entry.plays.length} straight possessions starting ${first.clock} ${first.period}. ` +
          `Plays: ${entry.plays.map((play) => play.text).filter(Boolean).join(" | ")}`,
        teamId: entry.player.teamId ?? null,
      });
    }
  }

  // ---- Clutch plays -----------------------------------------------------
  for (let clutchIndex = 0; clutchIndex < scoringPlays.length; clutchIndex += 1) {
    const play = scoringPlays[clutchIndex];
    const isLatePeriod = play.periodRank >= lastRegulationPeriod && lastRegulationPeriod > 0;
    if (!isLatePeriod || play.clockRemaining > CLUTCH_CLOCK_SECONDS) {
      continue;
    }
    const margin = Math.abs(parseScore(play.awayScore) - parseScore(play.homeScore));
    if (margin > CLUTCH_MARGIN) {
      continue;
    }
    const player = findPlayerInText(play.text, players);
    // No named player in the play text — fall back to whichever side's score
    // actually moved on this play, same signal the run detector above uses.
    const side = player ? null : scoringSideAt(scoringPlays, clutchIndex);
    pushCluster({
      id: `clutch:${play.id}`,
      kind: "clutch",
      period: play.period,
      clock: play.clock,
      order: play.chronoIndex,
      playIds: [play.id],
      facts:
        `Clutch moment with ${play.clock} left in ${play.period}, margin ${margin}: ${play.text}` +
        (player ? ` (${player.name})` : ""),
      teamId: player?.teamId ?? (side ? teamIdForSide(data, side) : null),
    });
  }

  // A late go-ahead basket satisfies BOTH the lead-change and clutch rules,
  // which would put two entries on the same play at the same timestamp. Keep
  // one per anchor play, preferring the more specific framing.
  const KIND_PRIORITY: Record<HighlightKind, number> = {
    clutch: 4,
    "lead-change": 3,
    run: 2,
    "player-surge": 1,
  };
  const byAnchor = new Map<string, HighlightCluster>();
  for (const cluster of clusters) {
    const anchor = cluster.playIds[0];
    const existing = byAnchor.get(anchor);
    // Multi-play clusters (a run, a surge) describe a stretch rather than a
    // single beat, so they never lose their anchor to a single-play cluster.
    if (!existing) {
      byAnchor.set(anchor, cluster);
      continue;
    }
    const existingSpan = existing.playIds.length;
    const nextSpan = cluster.playIds.length;
    if (nextSpan > existingSpan) {
      byAnchor.set(anchor, cluster);
    } else if (nextSpan === existingSpan && KIND_PRIORITY[cluster.kind] > KIND_PRIORITY[existing.kind]) {
      byAnchor.set(anchor, cluster);
    }
  }

  return [...byAnchor.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
