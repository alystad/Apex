import {
  buildTrackedBetKey,
  createTrackedBetFromCandidate,
  sanitizeTrackedBetRecord,
  setTrackedBetResultEntry,
  summarizeTrackedBets,
  syncTrackedBetsWithSnapshots,
} from "./trackedBets";

import type {
  TrackedBetCandidate,
  TrackedBetGameSnapshot,
} from "@/src/profile/profileTypes";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createCandidate(
  overrides: Partial<TrackedBetCandidate> = {},
): TrackedBetCandidate {
  return {
    eventId: "event-1",
    mode: "college",
    sportKey: "basketball_ncaab",
    eventLabel: "Away @ Home",
    homeTeam: "Home",
    awayTeam: "Away",
    marketType: "moneyline",
    marketLabel: "Moneyline",
    side: "Home",
    americanOdds: 150,
    source: "in-game-odds",
    ...overrides,
  };
}

function createSnapshot(
  overrides: Partial<TrackedBetGameSnapshot> = {},
): TrackedBetGameSnapshot {
  return {
    mode: "college",
    gameId: "game-1",
    homeTeamName: "Home",
    awayTeamName: "Away",
    homeScore: 75,
    awayScore: 70,
    gameStatus: "final",
    updatedAt: "2026-03-15T12:00:00.000Z",
    ...overrides,
  };
}

export function runTrackedBetDevChecks(): void {
  const sanitized = sanitizeTrackedBetRecord({
    eventId: "event-1",
    mode: "college",
    homeTeam: "Home",
    awayTeam: "Away",
    eventLabel: "Away @ Home",
    marketType: "moneyline",
    marketLabel: "Moneyline",
    side: "Home",
    americanOdds: 150,
    stake: "12.5",
    source: "in-game-odds",
    createdAt: "2026-03-14T00:00:00.000Z",
    updatedAt: "2026-03-14T00:00:00.000Z",
  });
  assert(sanitized, "Tracked bet storage sanitization should keep valid records.");
  assert(
    sanitized.key === buildTrackedBetKey(sanitized),
    "Sanitized tracked bet should recompute a stable key.",
  );
  assert(sanitized.stake === 12.5, "Stake should sanitize numeric strings.");

  const openBet = createTrackedBetFromCandidate(createCandidate());
  const settledWin = setTrackedBetResultEntry([openBet], openBet.key, "win")[0];
  const settledLoss = setTrackedBetResultEntry(
    [createTrackedBetFromCandidate(createCandidate({ eventId: "event-2", side: "Away", americanOdds: -110 }))],
    buildTrackedBetKey({
      eventId: "event-2",
      marketType: "moneyline",
      side: "Away",
      linePoint: undefined,
      americanOdds: -110,
    }),
    "loss",
  )[0];
  const summary = summarizeTrackedBets([openBet, settledWin, settledLoss]);
  assert(summary.totalStaked === 30, "Summary should total staked dollars.");
  assert(summary.openToWin === 15, "Open bet should contribute potential profit.");
  assert(summary.openReturn === 25, "Open bet should contribute full return.");
  assert(summary.settledNet === 5, "Settled win and loss should net correctly.");
  assert(summary.combinedCeiling === 20, "Combined ceiling should add open win and settled net.");

  const moneylineBet = createTrackedBetFromCandidate(createCandidate({ gameId: "game-1" }));
  const settledMoneyline = syncTrackedBetsWithSnapshots(
    [moneylineBet],
    [createSnapshot()],
  )[0];
  assert(
    settledMoneyline.result === "win",
    "Moneyline auto-settlement should pick the winner from the final score.",
  );

  const spreadBet = createTrackedBetFromCandidate(
    createCandidate({
      eventId: "event-3",
      gameId: "game-3",
      marketType: "spread",
      marketLabel: "Spread",
      side: "Away",
      linePoint: 6.5,
      americanOdds: -105,
    }),
  );
  const settledSpread = syncTrackedBetsWithSnapshots(
    [spreadBet],
    [
      createSnapshot({
        gameId: "game-3",
        homeScore: 78,
        awayScore: 74,
      }),
    ],
  )[0];
  assert(
    settledSpread.result === "win",
    "Spread auto-settlement should apply line points to the selected side.",
  );

  const totalBet = createTrackedBetFromCandidate(
    createCandidate({
      eventId: "event-4",
      gameId: "game-4",
      marketType: "total",
      marketLabel: "Total",
      side: "Under",
      linePoint: 145.5,
      americanOdds: -110,
    }),
  );
  const settledTotal = syncTrackedBetsWithSnapshots(
    [totalBet],
    [
      createSnapshot({
        gameId: "game-4",
        homeScore: 71,
        awayScore: 68,
      }),
    ],
  )[0];
  assert(
    settledTotal.result === "win",
    "Total auto-settlement should compare combined score against the total line.",
  );
}

runTrackedBetDevChecks();
