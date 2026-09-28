import {
  getPeriodTimingForMode,
  parsePeriodClockToElapsedSeconds,
  type LiveGameData,
  type LiveGamePlayer,
} from "@/hooks/useLiveGame";
import type { GameMode } from "@/src/mode/gameModeTypes";
import type { LineupSubstitutionInput } from "@/src/lib/lineups/inferOnCourtByMinuteDelta";
import { periodShortLabel } from "@/components/game/PointDifferentialChart";

/**
 * Everything the Court tab's history scrubber needs, precomputed ONCE when a
 * completed game's data loads (or changes) rather than on every drag tick —
 * sorting plays/substitutions and grouping rating/momentum points by player
 * are all O(n log n)/O(n) passes over the whole game, cheap once but not
 * something a 60fps drag gesture should redo per frame.
 */
export type CourtHistoryIndex = {
  /** Elapsed game seconds at the final play — the slider's right edge. */
  totalDurationSec: number;
  /** Quarter/half + OT markers for the slider's tick labels. */
  periodMarkers: Array<{ label: string; elapsedSec: number }>;
  /** Chronological (by elapsedSec) plays, each carrying the score/clock/period as of that instant. */
  sortedPlays: Array<{
    elapsedSec: number;
    period: string;
    clock: string;
    homeScore: number;
    awayScore: number;
  }>;
  startersByTeam: Map<string, string[]>;
  substitutionsByTeam: Map<string, LineupSubstitutionInput[]>;
  ratingPointsByPlayerId: Map<string, Array<{ tSec: number; rating: number }>>;
  momentumPointsByPlayerId: Map<string, Array<{ tSec: number; momentum: number }>>;
};

export type CourtHistorySnapshot = {
  elapsedSec: number;
  period: string;
  clock: string;
  homeScore: number;
  awayScore: number;
  /** Player IDs on court for each team at this instant. */
  onCourtPlayerIdsByTeam: Map<string, Set<string>>;
  ratingByPlayerId: Map<string, number | null>;
  momentumByPlayerId: Map<string, number | null>;
};

function interpolateAtTime(
  points: Array<{ tSec: number; value: number }>,
  elapsedSec: number,
): number | null {
  if (points.length === 0) {
    return null;
  }
  if (elapsedSec <= points[0].tSec) {
    return points[0].value;
  }
  const last = points[points.length - 1];
  if (elapsedSec >= last.tSec) {
    return last.value;
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (elapsedSec >= a.tSec && elapsedSec <= b.tSec) {
      if (b.tSec === a.tSec) {
        return b.value;
      }
      const ratio = (elapsedSec - a.tSec) / (b.tSec - a.tSec);
      return a.value + (b.value - a.value) * ratio;
    }
  }
  return last.value;
}

/** 0-based period index for a given elapsed-seconds mark (regulation, then OT). */
function periodIndexForElapsedSec(elapsedSec: number, mode: GameMode): number {
  const timing = getPeriodTimingForMode(mode);
  const regulationDuration = timing.regulationPeriods * timing.regulationPeriodSeconds;
  if (elapsedSec < regulationDuration) {
    return Math.floor(elapsedSec / timing.regulationPeriodSeconds);
  }
  const otElapsed = elapsedSec - regulationDuration;
  return timing.regulationPeriods + Math.floor(otElapsed / Math.max(1, timing.overtimeSeconds));
}

export function buildCourtHistoryIndex(data: LiveGameData): CourtHistoryIndex {
  const timing = getPeriodTimingForMode(data.mode);

  const sortedPlays = (data.plays ?? [])
    .map((play) => {
      const elapsedSec = parsePeriodClockToElapsedSeconds(play.period, play.clock, timing);
      if (elapsedSec === null) {
        return null;
      }
      return {
        elapsedSec,
        period: play.period,
        clock: play.clock,
        homeScore: Number.parseInt(play.homeScore, 10) || 0,
        awayScore: Number.parseInt(play.awayScore, 10) || 0,
      };
    })
    .filter((play): play is CourtHistoryIndex["sortedPlays"][number] => play !== null)
    .sort((a, b) => a.elapsedSec - b.elapsedSec);

  const lastPlayElapsedSec = sortedPlays.at(-1)?.elapsedSec ?? 0;
  const regulationDuration = timing.regulationPeriods * timing.regulationPeriodSeconds;
  const totalDurationSec = Math.max(regulationDuration, lastPlayElapsedSec);

  const highestPeriodIndex = periodIndexForElapsedSec(Math.max(0, totalDurationSec - 1), data.mode);
  const periodMarkers: CourtHistoryIndex["periodMarkers"] = [];
  for (let index = 0; index <= highestPeriodIndex; index += 1) {
    const elapsedSec =
      index < timing.regulationPeriods
        ? index * timing.regulationPeriodSeconds
        : regulationDuration + (index - timing.regulationPeriods) * timing.overtimeSeconds;
    periodMarkers.push({ label: periodShortLabel(index, timing.regulationPeriods), elapsedSec });
  }

  const startersByTeam = new Map<string, string[]>();
  const ratingPointsByPlayerId = new Map<string, Array<{ tSec: number; rating: number }>>();
  const momentumPointsByPlayerId = new Map<string, Array<{ tSec: number; momentum: number }>>();
  Object.entries(data.playersByTeam ?? {}).forEach(([teamId, players]) => {
    startersByTeam.set(
      teamId,
      players.filter((player) => player.starter).map((player) => player.id),
    );
    players.forEach((player) => {
      const ratingPoints = (player.ratingTimelinePoints ?? [])
        .map((point) => ({ tSec: point.tSec, rating: point.rating }))
        .sort((a, b) => a.tSec - b.tSec);
      ratingPointsByPlayerId.set(player.id, ratingPoints);
      const momentumPoints = (player.momentumTimelinePoints ?? [])
        .map((point) => ({ tSec: point.tSec, momentum: point.momentum }))
        .sort((a, b) => a.tSec - b.tSec);
      momentumPointsByPlayerId.set(player.id, momentumPoints);
    });
  });

  const substitutionsByTeam = new Map<string, LineupSubstitutionInput[]>();
  (data.lineupSubstitutions ?? [])
    .slice()
    .sort((a, b) => a.elapsedSec - b.elapsedSec || a.id.localeCompare(b.id))
    .forEach((sub) => {
      const list = substitutionsByTeam.get(sub.teamId) ?? [];
      list.push(sub);
      substitutionsByTeam.set(sub.teamId, list);
    });

  return {
    totalDurationSec,
    periodMarkers,
    sortedPlays,
    startersByTeam,
    substitutionsByTeam,
    ratingPointsByPlayerId,
    momentumPointsByPlayerId,
  };
}

/** Cheap per-frame lookup against a precomputed CourtHistoryIndex. */
export function sampleCourtHistory(index: CourtHistoryIndex, elapsedSec: number): CourtHistorySnapshot {
  const clampedElapsedSec = Math.max(0, Math.min(index.totalDurationSec, elapsedSec));

  // Most recent play at or before this instant — its score/period/clock ARE
  // the game state at this instant (state only changes when a play happens).
  let currentPlay = index.sortedPlays[0] ?? null;
  for (const play of index.sortedPlays) {
    if (play.elapsedSec > clampedElapsedSec) {
      break;
    }
    currentPlay = play;
  }

  const onCourtPlayerIdsByTeam = new Map<string, Set<string>>();
  index.startersByTeam.forEach((starterIds, teamId) => {
    const onCourt = new Set(starterIds);
    const subs = index.substitutionsByTeam.get(teamId) ?? [];
    for (const sub of subs) {
      if (sub.elapsedSec > clampedElapsedSec) {
        break;
      }
      onCourt.delete(sub.outPlayerId);
      onCourt.add(sub.inPlayerId);
    }
    onCourtPlayerIdsByTeam.set(teamId, onCourt);
  });

  const ratingByPlayerId = new Map<string, number | null>();
  index.ratingPointsByPlayerId.forEach((points, playerId) => {
    ratingByPlayerId.set(playerId, interpolateAtTime(points.map((p) => ({ tSec: p.tSec, value: p.rating })), clampedElapsedSec));
  });
  const momentumByPlayerId = new Map<string, number | null>();
  index.momentumPointsByPlayerId.forEach((points, playerId) => {
    momentumByPlayerId.set(
      playerId,
      interpolateAtTime(points.map((p) => ({ tSec: p.tSec, value: p.momentum })), clampedElapsedSec),
    );
  });

  return {
    elapsedSec: clampedElapsedSec,
    period: currentPlay?.period ?? "",
    clock: currentPlay?.clock ?? "",
    homeScore: currentPlay?.homeScore ?? 0,
    awayScore: currentPlay?.awayScore ?? 0,
    onCourtPlayerIdsByTeam,
    ratingByPlayerId,
    momentumByPlayerId,
  };
}

/**
 * Projects a full `playersByTeam` map onto a historical instant: each player
 * comes back with `onCourt`/`inGameRating10`/`momentum` overridden to what
 * they were AT THAT MOMENT, so it can be handed straight to CourtOverlay /
 * CourtLineupDock / the leaderboard exactly like the live `playersByTeam`
 * they already render — no changes needed in any of those components, since
 * they all just read those same three fields off whatever player objects
 * they're given.
 */
export function projectPlayersAtSnapshot(
  playersByTeam: Record<string, LiveGamePlayer[]>,
  snapshot: CourtHistorySnapshot,
): Record<string, LiveGamePlayer[]> {
  const result: Record<string, LiveGamePlayer[]> = {};
  Object.entries(playersByTeam).forEach(([teamId, players]) => {
    const onCourtIds = snapshot.onCourtPlayerIdsByTeam.get(teamId) ?? new Set<string>();
    result[teamId] = players.map((player) => ({
      ...player,
      onCourt: onCourtIds.has(player.id),
      inGameRating10: snapshot.ratingByPlayerId.get(player.id) ?? null,
      momentum: snapshot.momentumByPlayerId.get(player.id) ?? null,
    }));
  });
  return result;
}
