import {
  inferOnCourtByMinuteDelta,
  type LineupSubstitutionInput,
  type PlayerMinuteInput,
} from './inferOnCourtByMinuteDelta';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function mkPlayer(
  playerId: string,
  teamId: string,
  MIN: number,
  options?: { starter?: boolean; active?: boolean },
): PlayerMinuteInput {
  return {
    playerId,
    teamId,
    MIN,
    name: playerId,
    starter: options?.starter ?? false,
    active: options?.active ?? true,
  };
}

function inferHome(input: {
  players: PlayerMinuteInput[];
  prev: Map<string, number>;
  previousOnCourt?: string[];
  substitutions?: LineupSubstitutionInput[];
}): ReturnType<typeof inferOnCourtByMinuteDelta> {
  return inferOnCourtByMinuteDelta({
    currentPlayers: input.players,
    prevMinutesByPlayerId: input.prev,
    homeTeamId: 'home',
    awayTeamId: 'away',
    previousOnCourtByTeamId: new Map<string, string[]>(
      input.previousOnCourt ? [['home', input.previousOnCourt]] : [],
    ),
    substitutions: input.substitutions ?? [],
  });
}

export function runInferOnCourtByMinuteDeltaDevChecks(): void {
  const away = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => mkPlayer(id, 'away', 8, { starter: true }));

  {
    const home = [
      mkPlayer('h1', 'home', 10),
      mkPlayer('h2', 'home', 11),
      mkPlayer('h3', 'home', 12),
      mkPlayer('h4', 'home', 9),
      mkPlayer('h5', 'home', 8),
      mkPlayer('h6', 'home', 5),
    ];
    const prev = new Map<string, number>([
      ['h1', 9],
      ['h2', 10],
      ['h3', 11],
      ['h4', 8],
      ['h5', 7],
      ['h6', 5],
    ]);
    const out = inferHome({ players: [...home, ...away], prev, previousOnCourt: ['h1', 'h2', 'h3', 'h4', 'h5'] });
    assert(out.debug.home.topDeltas.some((row) => row.prevMIN > 0), 'Previous-minute baseline should be non-zero when provided.');
  }

  {
    const home = [
      mkPlayer('h1', 'home', 3, { starter: true }),
      mkPlayer('h2', 'home', 3, { starter: true }),
      mkPlayer('h3', 'home', 2, { starter: true }),
      mkPlayer('h4', 'home', 2, { starter: true }),
      mkPlayer('h5', 'home', 1, { starter: true }),
      mkPlayer('h6', 'home', 12, { starter: false }),
    ];
    const out = inferHome({ players: [...home, ...away], prev: new Map() });
    const lineup = new Set(out.homeOnCourtIds);
    assert(['h1', 'h2', 'h3', 'h4', 'h5'].every((id) => lineup.has(id)), 'Initial seed should prefer starters.');
    assert(!lineup.has('h6'), 'Bench high-minutes player should not replace a full starter seed.');
  }

  {
    const home = [
      mkPlayer('h1', 'home', 8, { starter: true }),
      mkPlayer('h2', 'home', 8, { starter: true }),
      mkPlayer('h3', 'home', 8, { starter: true }),
      mkPlayer('h4', 'home', 8, { starter: true }),
      mkPlayer('h5', 'home', 8, { starter: true }),
      mkPlayer('h6', 'home', 7),
    ];
    const prev = new Map<string, number>([
      ['h1', 8],
      ['h2', 8],
      ['h3', 8],
      ['h4', 8],
      ['h5', 8],
      ['h6', 6],
    ]);
    const out = inferHome({ players: [...home, ...away], prev, previousOnCourt: ['h1', 'h2', 'h3', 'h4', 'h5'] });
    assert(out.homeOnCourtIds.includes('h6'), 'Positive bench minute delta should swap into lineup.');
  }

  {
    const home = [
      mkPlayer('h1', 'home', 9, { starter: true }),
      mkPlayer('h2', 'home', 9, { starter: true }),
      mkPlayer('h3', 'home', 9, { starter: true }),
      mkPlayer('h4', 'home', 9, { starter: true }),
      mkPlayer('h5', 'home', 9, { starter: true }),
      mkPlayer('h6', 'home', 2),
    ];
    const out = inferHome({
      players: [...home, ...away],
      prev: new Map<string, number>([
        ['h1', 9],
        ['h2', 9],
        ['h3', 9],
        ['h4', 9],
        ['h5', 9],
        ['h6', 2],
      ]),
      previousOnCourt: ['h1', 'h2', 'h3', 'h4', 'h5'],
      substitutions: [
        {
          id: 'sub-1',
          teamId: 'home',
          elapsedSec: 100,
          inPlayerId: 'h6',
          outPlayerId: 'h3',
        },
      ],
    });
    assert(out.homeOnCourtIds.includes('h6') && !out.homeOnCourtIds.includes('h3'), 'Substitution IN/OUT should be applied deterministically.');
  }

  {
    const home = [
      mkPlayer('h1', 'home', 6, { starter: true }),
      mkPlayer('h2', 'home', 5, { starter: true }),
      mkPlayer('h3', 'home', 4),
      mkPlayer('h4', 'home', 3),
      mkPlayer('h5', 'home', 2),
      mkPlayer('h6', 'home', 1),
      mkPlayer('h7', 'home', 0.5),
    ];
    const out = inferHome({
      players: [...home, ...away],
      prev: new Map<string, number>([['h1', 6]]),
      previousOnCourt: ['missing-1', 'missing-2'],
    });
    assert(out.homeOnCourtIds.length === 5, 'Fallback should always fill lineup to 5 when roster depth allows.');
    assert(new Set(out.homeOnCourtIds).size === out.homeOnCourtIds.length, 'Lineup should contain unique player IDs.');
  }
}
