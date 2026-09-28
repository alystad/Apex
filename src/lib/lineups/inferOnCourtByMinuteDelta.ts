export type PlayerMinuteInput = {
  playerId: string;
  teamId: string;
  MIN: number;
  name: string;
  starter?: boolean;
  active?: boolean;
};

export type LineupSubstitutionInput = {
  id: string;
  teamId: string;
  elapsedSec: number;
  inPlayerId: string;
  outPlayerId: string;
};

export type LineupSelectionSource =
  | 'seed_previous'
  | 'seed_starter'
  | 'seed_minutes'
  | 'sub_swap'
  | 'delta_swap'
  | 'fallback_minutes';

type TeamMinuteRow = {
  playerId: string;
  name: string;
  prevMIN: number;
  curMIN: number;
  delta: number;
  starter: boolean;
  active: boolean;
};

export type DeltaDebugRow = {
  playerId: string;
  name: string;
  prevMIN: number;
  curMIN: number;
  delta: number;
  source?: LineupSelectionSource;
};

export type SideDebug = {
  selected: DeltaDebugRow[];
  topDeltas: DeltaDebugRow[];
};

export type DebugInfo = {
  home: SideDebug;
  away: SideDebug;
};

function asFinite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function buildRows(
  teamPlayers: PlayerMinuteInput[],
  prevMinutesByPlayerId: Map<string, number>,
): TeamMinuteRow[] {
  return teamPlayers.map((row) => {
    const prev = asFinite(prevMinutesByPlayerId.get(row.playerId) ?? 0);
    const cur = asFinite(row.MIN);
    return {
      playerId: row.playerId,
      name: row.name,
      prevMIN: prev,
      curMIN: cur,
      delta: cur - prev,
      starter: Boolean(row.starter),
      active: row.active !== false,
    };
  });
}

function sortByMinutesDesc(a: TeamMinuteRow, b: TeamMinuteRow): number {
  return b.curMIN - a.curMIN || b.delta - a.delta || a.name.localeCompare(b.name);
}

function sortByDeltaDesc(a: TeamMinuteRow, b: TeamMinuteRow): number {
  return b.delta - a.delta || b.curMIN - a.curMIN || a.name.localeCompare(b.name);
}

function sortByDeltaAsc(a: TeamMinuteRow, b: TeamMinuteRow): number {
  return a.delta - b.delta || a.curMIN - b.curMIN || a.name.localeCompare(b.name);
}

function toDebugRow(row: TeamMinuteRow, source?: LineupSelectionSource): DeltaDebugRow {
  return {
    playerId: row.playerId,
    name: row.name,
    prevMIN: row.prevMIN,
    curMIN: row.curMIN,
    delta: row.delta,
    source,
  };
}

function inferSide(input: {
  teamId: string;
  teamPlayers: PlayerMinuteInput[];
  prevMinutesByPlayerId: Map<string, number>;
  previousOnCourtIds: string[];
  substitutions: LineupSubstitutionInput[];
}): { ids: string[]; selected: DeltaDebugRow[]; topDeltas: DeltaDebugRow[] } {
  const rows = buildRows(input.teamPlayers, input.prevMinutesByPlayerId);
  const rowsById = new Map(rows.map((row) => [row.playerId, row]));
  const activeRows = rows.filter((row) => row.active);
  const rankedByMinutes = [...activeRows].sort(sortByMinutesDesc);
  const rankedByDeltaDesc = [...rows].sort(sortByDeltaDesc);
  const lineupIds: string[] = [];
  const sourceById = new Map<string, LineupSelectionSource>();

  const addToLineup = (playerId: string, source: LineupSelectionSource): void => {
    if (lineupIds.includes(playerId)) {
      if (!sourceById.has(playerId)) {
        sourceById.set(playerId, source);
      }
      return;
    }
    const row = rowsById.get(playerId);
    if (!row || !row.active) {
      return;
    }
    lineupIds.push(playerId);
    sourceById.set(playerId, source);
  };

  const removeFromLineup = (playerId: string): void => {
    const index = lineupIds.indexOf(playerId);
    if (index >= 0) {
      lineupIds.splice(index, 1);
    }
  };

  const getLowestDeltaLineupId = (): string | null => {
    const sorted = lineupIds
      .map((playerId) => rowsById.get(playerId))
      .filter((row): row is TeamMinuteRow => Boolean(row))
      .sort(sortByDeltaAsc);
    return sorted[0]?.playerId ?? null;
  };

  const previousOnCourtValid = input.previousOnCourtIds.filter((playerId) => {
    const row = rowsById.get(playerId);
    return Boolean(row && row.active);
  });
  if (previousOnCourtValid.length === 5) {
    previousOnCourtValid.forEach((playerId) => addToLineup(playerId, 'seed_previous'));
  }

  if (lineupIds.length === 0) {
    rankedByMinutes
      .filter((row) => row.starter)
      .forEach((row) => {
        if (lineupIds.length < 5) {
          addToLineup(row.playerId, 'seed_starter');
        }
      });
    rankedByMinutes.forEach((row) => {
      if (lineupIds.length < 5) {
        addToLineup(row.playerId, 'seed_minutes');
      }
    });
  }

  const substitutions = [...input.substitutions].sort(
    (a, b) => a.elapsedSec - b.elapsedSec || a.id.localeCompare(b.id),
  );
  substitutions.forEach((sub) => {
    if (sub.teamId !== input.teamId) {
      return;
    }
    const inRow = rowsById.get(sub.inPlayerId);
    const outRow = rowsById.get(sub.outPlayerId);
    if (!inRow || !outRow || !inRow.active) {
      return;
    }

    if (lineupIds.includes(outRow.playerId)) {
      removeFromLineup(outRow.playerId);
      addToLineup(inRow.playerId, 'sub_swap');
      return;
    }

    if (!lineupIds.includes(inRow.playerId)) {
      if (lineupIds.length >= 5) {
        const lowestId = getLowestDeltaLineupId();
        if (lowestId) {
          removeFromLineup(lowestId);
        }
      }
      addToLineup(inRow.playerId, 'sub_swap');
    }
  });

  const hasPrevBaseline = rows.some((row) => input.prevMinutesByPlayerId.has(row.playerId));
  if (hasPrevBaseline) {
    const benchPositive = (): TeamMinuteRow[] =>
      activeRows
        .filter((row) => !lineupIds.includes(row.playerId) && row.delta > 0)
        .sort(sortByDeltaDesc);
    let swapped = true;
    while (swapped) {
      swapped = false;
      const candidates = benchPositive();
      if (candidates.length === 0 || lineupIds.length === 0) {
        break;
      }
      for (const inCandidate of candidates) {
        const outId = getLowestDeltaLineupId();
        if (!outId) {
          break;
        }
        const outCandidate = rowsById.get(outId);
        if (!outCandidate) {
          break;
        }
        const swapOnSignal =
          inCandidate.delta > outCandidate.delta + 0.05 ||
          (inCandidate.delta > 0 && outCandidate.delta <= 0);
        if (!swapOnSignal) {
          continue;
        }
        removeFromLineup(outCandidate.playerId);
        addToLineup(inCandidate.playerId, 'delta_swap');
        swapped = true;
        break;
      }
    }
  }

  if (lineupIds.length > 5) {
    const trimmed = [...lineupIds]
      .map((playerId) => rowsById.get(playerId))
      .filter((row): row is TeamMinuteRow => Boolean(row))
      .sort(sortByDeltaDesc)
      .slice(0, 5)
      .map((row) => row.playerId);
    lineupIds.splice(0, lineupIds.length, ...trimmed);
  }

  rankedByMinutes.forEach((row) => {
    if (lineupIds.length < 5) {
      addToLineup(row.playerId, 'fallback_minutes');
    }
  });

  const selectedRows = lineupIds
    .map((playerId) => {
      const row = rowsById.get(playerId);
      if (!row) {
        return null;
      }
      return toDebugRow(row, sourceById.get(playerId));
    })
    .filter((row): row is DeltaDebugRow => Boolean(row))
    .sort((a, b) => b.delta - a.delta || b.curMIN - a.curMIN);
  const topDeltas = rankedByDeltaDesc.slice(0, 8).map((row) => toDebugRow(row));

  return {
    ids: lineupIds.slice(0, 5),
    selected: selectedRows,
    topDeltas,
  };
}

export function inferOnCourtByMinuteDelta(input: {
  currentPlayers: PlayerMinuteInput[];
  prevMinutesByPlayerId: Map<string, number>;
  homeTeamId: string;
  awayTeamId: string;
  previousOnCourtByTeamId?: Map<string, string[]>;
  substitutions?: LineupSubstitutionInput[];
}): { homeOnCourtIds: string[]; awayOnCourtIds: string[]; debug: DebugInfo } {
  const byTeam = new Map<string, PlayerMinuteInput[]>();
  for (const player of input.currentPlayers) {
    const arr = byTeam.get(player.teamId) ?? [];
    arr.push(player);
    byTeam.set(player.teamId, arr);
  }

  const home = inferSide({
    teamId: input.homeTeamId,
    teamPlayers: byTeam.get(input.homeTeamId) ?? [],
    prevMinutesByPlayerId: input.prevMinutesByPlayerId,
    previousOnCourtIds: input.previousOnCourtByTeamId?.get(input.homeTeamId) ?? [],
    substitutions: input.substitutions?.filter((sub) => sub.teamId === input.homeTeamId) ?? [],
  });
  const away = inferSide({
    teamId: input.awayTeamId,
    teamPlayers: byTeam.get(input.awayTeamId) ?? [],
    prevMinutesByPlayerId: input.prevMinutesByPlayerId,
    previousOnCourtIds: input.previousOnCourtByTeamId?.get(input.awayTeamId) ?? [],
    substitutions: input.substitutions?.filter((sub) => sub.teamId === input.awayTeamId) ?? [],
  });

  return {
    homeOnCourtIds: Array.from(new Set(home.ids)).slice(0, 5),
    awayOnCourtIds: Array.from(new Set(away.ids)).slice(0, 5),
    debug: {
      home: { selected: home.selected, topDeltas: home.topDeltas },
      away: { selected: away.selected, topDeltas: away.topDeltas },
    },
  };
}
