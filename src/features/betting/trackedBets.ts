import type { LiveGameData } from "@/hooks/useLiveGame";
import type { LiveGameListItem } from "@/src/features/basketball/api";
import type { GameMode } from "@/src/mode/gameModeTypes";
import { normalizePredictionGameStatus } from "@/src/profile/predictionResolution";
import type {
  PredictionGameStatus,
  TrackedBetCandidate,
  TrackedBetGameSnapshot,
  TrackedBetMarketType,
  TrackedBetResult,
  TrackedBetSettlementSource,
  TrackedProEvBet,
} from "@/src/profile/profileTypes";

import type { ComputedMarketRow } from "./proEv";
import type { TopMarketEvItem } from "./types";

export const DEFAULT_TRACKED_BET_STAKE = 10;

const NCAA_SPORT_KEY = "basketball_ncaab";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeNameKey(value: unknown): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/\bst\./g, "st")
    .replace(/\buniversity\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roundToCents(value: number): number {
  return Number(value.toFixed(2));
}

function sanitizeLinePoint(value: unknown): number | undefined {
  const parsed = parseOptionalNumber(value);
  return typeof parsed === "number" ? Number(parsed.toFixed(1)) : undefined;
}

export function sanitizeTrackedBetStake(value: unknown): number {
  const parsed = parseOptionalNumber(value);
  if (typeof parsed !== "number") {
    return 0;
  }
  return roundToCents(Math.max(0, parsed));
}

function sanitizeAmericanOdds(value: unknown): number {
  const parsed = parseOptionalNumber(value);
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed === 0) {
    return 0;
  }
  return Math.trunc(parsed);
}

export function americanOddsToDecimalOdds(americanOdds: number): number {
  if (!Number.isFinite(americanOdds) || americanOdds === 0) {
    return 0;
  }
  if (americanOdds > 0) {
    return 1 + americanOdds / 100;
  }
  return 1 + 100 / Math.abs(americanOdds);
}

export function inferTrackedBetMode(
  sportKey: string | undefined,
  fallback: GameMode = "college",
): GameMode {
  if (sportKey === "basketball_nba") {
    return "nba";
  }
  if (sportKey === NCAA_SPORT_KEY) {
    return "college";
  }
  return fallback;
}

export function normalizeTrackedBetMarketType(
  value: string | undefined,
): TrackedBetMarketType | null {
  const key = normalizeText(value).toLowerCase();
  if (key === "moneyline" || key === "h2h") {
    return "moneyline";
  }
  if (key === "spread" || key === "spreads") {
    return "spread";
  }
  if (key === "total" || key === "totals") {
    return "total";
  }
  return null;
}

function normalizeOutcomeKey(value: string): string {
  return normalizeNameKey(value);
}

function buildFallbackEventId(
  homeTeam: string,
  awayTeam: string,
  marketType: TrackedBetMarketType,
): string {
  return [normalizeNameKey(awayTeam), normalizeNameKey(homeTeam), marketType]
    .filter(Boolean)
    .join(":");
}

export function buildTrackedBetKey(
  input: Pick<
    TrackedBetCandidate | TrackedProEvBet,
    "eventId" | "marketType" | "side" | "linePoint" | "americanOdds"
  >,
): string {
  return [
    normalizeText(input.eventId).toLowerCase(),
    input.marketType,
    normalizeOutcomeKey(input.side),
    typeof input.linePoint === "number" ? input.linePoint.toFixed(1) : "na",
    sanitizeAmericanOdds(input.americanOdds),
  ].join("::");
}

function normalizeCandidate(candidate: TrackedBetCandidate): TrackedBetCandidate {
  const homeTeam = normalizeText(candidate.homeTeam) || "Home";
  const awayTeam = normalizeText(candidate.awayTeam) || "Away";
  const marketLabel = normalizeText(candidate.marketLabel);
  const marketType =
    normalizeTrackedBetMarketType(candidate.marketType) ?? candidate.marketType;
  const eventId =
    normalizeText(candidate.eventId) ||
    buildFallbackEventId(homeTeam, awayTeam, marketType);

  return {
    eventId,
    gameId: normalizeText(candidate.gameId) || undefined,
    mode: candidate.mode,
    sportKey: normalizeText(candidate.sportKey) || undefined,
    eventLabel:
      normalizeText(candidate.eventLabel) || `${awayTeam} @ ${homeTeam}`,
    homeTeam,
    awayTeam,
    marketType,
    marketLabel:
      marketLabel ||
      (marketType === "moneyline"
        ? "Moneyline"
        : marketType === "spread"
          ? "Spread"
          : "Total"),
    side: normalizeText(candidate.side),
    linePoint: sanitizeLinePoint(candidate.linePoint),
    americanOdds: sanitizeAmericanOdds(candidate.americanOdds),
    source: candidate.source,
  };
}

export function sanitizeTrackedBetRecord(value: unknown): TrackedProEvBet | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<TrackedProEvBet>;
  const marketType =
    normalizeTrackedBetMarketType(
      typeof raw.marketType === "string" ? raw.marketType : undefined,
    ) ??
    normalizeTrackedBetMarketType(
      typeof raw.marketLabel === "string" ? raw.marketLabel : undefined,
    );
  const mode =
    raw.mode === "college" || raw.mode === "nba" || raw.mode === "baseball"
      ? raw.mode
      : null;
  const side = normalizeText(raw.side);

  if (!marketType || !mode || !side) {
    return null;
  }

  const candidate = normalizeCandidate({
    eventId: normalizeText(raw.eventId),
    gameId: normalizeText(raw.gameId) || undefined,
    mode,
    sportKey: normalizeText(raw.sportKey) || undefined,
    eventLabel: normalizeText(raw.eventLabel),
    homeTeam: normalizeText(raw.homeTeam),
    awayTeam: normalizeText(raw.awayTeam),
    marketType,
    marketLabel: normalizeText(raw.marketLabel),
    side,
    linePoint: raw.linePoint,
    americanOdds: raw.americanOdds ?? 0,
    source:
      raw.source === "live-games-pro-ev" ? "live-games-pro-ev" : "in-game-odds",
  });

  if (!candidate.eventId || !candidate.side || candidate.americanOdds === 0) {
    return null;
  }

  const createdAt = normalizeText(raw.createdAt) || new Date().toISOString();
  const updatedAt = normalizeText(raw.updatedAt) || createdAt;
  const result: TrackedBetResult =
    raw.result === "win" || raw.result === "loss" || raw.result === "push"
      ? raw.result
      : "open";
  const settlementSource: TrackedBetSettlementSource | undefined =
    raw.settlementSource === "auto" || raw.settlementSource === "manual"
      ? raw.settlementSource
      : undefined;

  return {
    key: buildTrackedBetKey(candidate),
    ...candidate,
    stake:
      sanitizeTrackedBetStake(raw.stake) || DEFAULT_TRACKED_BET_STAKE,
    status: result === "open" ? "open" : "settled",
    result,
    createdAt,
    updatedAt,
    settledAt:
      result === "open"
        ? undefined
        : normalizeText(raw.settledAt) || updatedAt,
    settlementSource:
      result === "open" ? settlementSource : settlementSource ?? "manual",
  };
}

export function createTrackedBetFromCandidate(
  candidate: TrackedBetCandidate,
): TrackedProEvBet {
  const normalized = normalizeCandidate(candidate);
  const nowIso = new Date().toISOString();

  return {
    key: buildTrackedBetKey(normalized),
    ...normalized,
    stake: DEFAULT_TRACKED_BET_STAKE,
    status: "open",
    result: "open",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function toggleTrackedBetEntry(
  bets: TrackedProEvBet[],
  candidate: TrackedBetCandidate,
): TrackedProEvBet[] {
  const normalized = normalizeCandidate(candidate);
  const key = buildTrackedBetKey(normalized);
  const existing = bets.some((bet) => bet.key === key);

  if (existing) {
    return bets.filter((bet) => bet.key !== key);
  }

  return [createTrackedBetFromCandidate(normalized), ...bets];
}

export function updateTrackedBetStakeEntry(
  bets: TrackedProEvBet[],
  key: string,
  stake: number,
): TrackedProEvBet[] {
  const nextStake = sanitizeTrackedBetStake(stake);
  let changed = false;
  const next = bets.map((bet) => {
    if (bet.key !== key || bet.stake === nextStake) {
      return bet;
    }
    changed = true;
    return {
      ...bet,
      stake: nextStake,
      updatedAt: new Date().toISOString(),
    };
  });
  return changed ? next : bets;
}

export function setTrackedBetResultEntry(
  bets: TrackedProEvBet[],
  key: string,
  result: TrackedBetResult,
  settlementSource: TrackedBetSettlementSource = "manual",
): TrackedProEvBet[] {
  let changed = false;
  const next = bets.map((bet) => {
    if (bet.key !== key) {
      return bet;
    }

    const nextStatus = result === "open" ? "open" : "settled";
    if (
      bet.result === result &&
      bet.status === nextStatus &&
      bet.settlementSource === settlementSource
    ) {
      return bet;
    }

    changed = true;
    const nowIso = new Date().toISOString();
    const nextBet: TrackedProEvBet = {
      ...bet,
      status: nextStatus,
      result,
      updatedAt: nowIso,
      settledAt: result === "open" ? undefined : nowIso,
      settlementSource,
    };
    return nextBet;
  });

  return changed ? next : bets;
}

function resolveSelectedSide(
  bet: TrackedProEvBet,
  snapshot: TrackedBetGameSnapshot,
): "home" | "away" | null {
  const sideKey = normalizeNameKey(bet.side);
  const homeKey = normalizeNameKey(snapshot.homeTeamName);
  const awayKey = normalizeNameKey(snapshot.awayTeamName);

  if (!sideKey || !homeKey || !awayKey) {
    return null;
  }
  if (
    sideKey === homeKey ||
    sideKey.includes(homeKey) ||
    homeKey.includes(sideKey)
  ) {
    return "home";
  }
  if (
    sideKey === awayKey ||
    sideKey.includes(awayKey) ||
    awayKey.includes(sideKey)
  ) {
    return "away";
  }
  return null;
}

function resolveTrackedBetOutcome(
  bet: TrackedProEvBet,
  snapshot: TrackedBetGameSnapshot,
): Exclude<TrackedBetResult, "open"> | null {
  if (snapshot.gameStatus !== "final") {
    return null;
  }

  const homeScore = snapshot.homeScore;
  const awayScore = snapshot.awayScore;
  if (
    typeof homeScore !== "number" ||
    !Number.isFinite(homeScore) ||
    typeof awayScore !== "number" ||
    !Number.isFinite(awayScore)
  ) {
    return null;
  }

  if (bet.marketType === "total") {
    if (typeof bet.linePoint !== "number") {
      return null;
    }
    const total = homeScore + awayScore;
    const outcomeKey = normalizeNameKey(bet.side);
    if (outcomeKey.includes("over")) {
      if (total > bet.linePoint) return "win";
      if (total < bet.linePoint) return "loss";
      return "push";
    }
    if (outcomeKey.includes("under")) {
      if (total < bet.linePoint) return "win";
      if (total > bet.linePoint) return "loss";
      return "push";
    }
    return null;
  }

  const selectedSide = resolveSelectedSide(bet, snapshot);
  if (!selectedSide) {
    return null;
  }

  const selectedScore = selectedSide === "home" ? homeScore : awayScore;
  const opponentScore = selectedSide === "home" ? awayScore : homeScore;

  if (bet.marketType === "moneyline") {
    if (selectedScore > opponentScore) return "win";
    if (selectedScore < opponentScore) return "loss";
    return "push";
  }

  if (bet.marketType === "spread") {
    if (typeof bet.linePoint !== "number") {
      return null;
    }
    const spreadScore = selectedScore + bet.linePoint;
    if (spreadScore > opponentScore) return "win";
    if (spreadScore < opponentScore) return "loss";
    return "push";
  }

  return null;
}

function buildSnapshotTeamKey(snapshot: TrackedBetGameSnapshot): string {
  return [
    snapshot.mode,
    normalizeNameKey(snapshot.awayTeamName),
    normalizeNameKey(snapshot.homeTeamName),
  ].join("::");
}

function buildBetTeamKey(bet: TrackedProEvBet): string {
  return [
    bet.mode,
    normalizeNameKey(bet.awayTeam),
    normalizeNameKey(bet.homeTeam),
  ].join("::");
}

export function syncTrackedBetsWithSnapshots(
  bets: TrackedProEvBet[],
  snapshots: TrackedBetGameSnapshot[],
): TrackedProEvBet[] {
  if (bets.length === 0 || snapshots.length === 0) {
    return bets;
  }

  const byGameId = new Map<string, TrackedBetGameSnapshot>();
  const byTeams = new Map<string, TrackedBetGameSnapshot>();
  snapshots.forEach((snapshot) => {
    byGameId.set(`${snapshot.mode}:${snapshot.gameId}`, snapshot);
    byTeams.set(buildSnapshotTeamKey(snapshot), snapshot);
  });

  let changed = false;
  const next = bets.map((bet) => {
    const matchedSnapshot =
      (bet.gameId ? byGameId.get(`${bet.mode}:${bet.gameId}`) : undefined) ??
      byTeams.get(buildBetTeamKey(bet));

    if (!matchedSnapshot) {
      return bet;
    }

    let nextBet = bet;
    if (!bet.gameId || bet.gameId !== matchedSnapshot.gameId) {
      nextBet = {
        ...nextBet,
        gameId: matchedSnapshot.gameId,
        updatedAt: matchedSnapshot.updatedAt,
      };
      changed = true;
    }

    if (nextBet.settlementSource === "manual" && nextBet.result !== "open") {
      return nextBet;
    }

    const resolved = resolveTrackedBetOutcome(nextBet, matchedSnapshot);
    if (!resolved) {
      return nextBet;
    }

    if (
      nextBet.status === "settled" &&
      nextBet.result === resolved &&
      nextBet.settlementSource === "auto"
    ) {
      return nextBet;
    }

    changed = true;
    const nextAutoBet: TrackedProEvBet = {
      ...nextBet,
      status: "settled",
      result: resolved,
      updatedAt: matchedSnapshot.updatedAt,
      settledAt: matchedSnapshot.updatedAt,
      settlementSource: "auto",
    };
    return nextAutoBet;
  });

  return changed ? next : bets;
}

export function getTrackedBetFinancials(bet: TrackedProEvBet) {
  const stake = sanitizeTrackedBetStake(bet.stake);
  const decimalOdds = americanOddsToDecimalOdds(bet.americanOdds);
  const potentialReturn =
    decimalOdds > 0 ? roundToCents(stake * decimalOdds) : 0;
  const potentialProfit =
    decimalOdds > 0 ? roundToCents(stake * (decimalOdds - 1)) : 0;

  let settledNet = 0;
  if (bet.result === "win") {
    settledNet = potentialProfit;
  } else if (bet.result === "loss") {
    settledNet = roundToCents(-stake);
  } else if (bet.result === "push") {
    settledNet = 0;
  }

  return {
    stake,
    decimalOdds,
    openPotentialReturn: bet.result === "open" ? potentialReturn : 0,
    openPotentialProfit: bet.result === "open" ? potentialProfit : 0,
    settledNet: roundToCents(settledNet),
  };
}

export function summarizeTrackedBets(bets: TrackedProEvBet[]) {
  return bets.reduce(
    (summary, bet) => {
      const financials = getTrackedBetFinancials(bet);
      summary.totalStaked = roundToCents(summary.totalStaked + financials.stake);
      summary.openToWin = roundToCents(
        summary.openToWin + financials.openPotentialProfit,
      );
      summary.openReturn = roundToCents(
        summary.openReturn + financials.openPotentialReturn,
      );
      summary.settledNet = roundToCents(
        summary.settledNet + financials.settledNet,
      );
      summary.combinedCeiling = roundToCents(
        summary.settledNet + summary.openToWin,
      );
      return summary;
    },
    {
      totalStaked: 0,
      openToWin: 0,
      openReturn: 0,
      settledNet: 0,
      combinedCeiling: 0,
    },
  );
}

export function buildTrackedBetGameSnapshotFromListItem(
  mode: GameMode,
  game: LiveGameListItem,
): TrackedBetGameSnapshot {
  return {
    mode,
    gameId: game.gameId,
    homeTeamName: game.home.name,
    awayTeamName: game.away.name,
    homeScore: parseScore(game.home.score),
    awayScore: parseScore(game.away.score),
    gameStatus: normalizePredictionGameStatus({
      detail: game.statusDetail ?? game.statusText,
      rawState: game.isLive ? "live" : game.statusText,
    }),
    updatedAt: new Date().toISOString(),
  };
}

export function buildTrackedBetGameSnapshotFromLiveGame(
  data: LiveGameData | null,
): TrackedBetGameSnapshot | null {
  if (!data) {
    return null;
  }

  const homeTeam = data.teams.find((team) => team.homeAway === "home");
  const awayTeam = data.teams.find((team) => team.homeAway === "away");
  if (!homeTeam || !awayTeam) {
    return null;
  }

  return {
    mode: data.mode,
    gameId: data.eventId,
    homeTeamName: homeTeam.displayName || homeTeam.shortDisplayName || "Home",
    awayTeamName: awayTeam.displayName || awayTeam.shortDisplayName || "Away",
    homeScore: parseScore(homeTeam.score),
    awayScore: parseScore(awayTeam.score),
    gameStatus: normalizePredictionGameStatus({
      rawState: data.status.state,
      detail:
        data.status.shortDetail || data.status.detail || data.status.description,
      startDate: data.meta.startDateTime,
    }),
    updatedAt: new Date().toISOString(),
  };
}

export function buildTrackedBetCandidateFromComputedMarketRow(
  row: ComputedMarketRow,
  context: {
    eventId?: string;
    gameId?: string;
    mode: GameMode;
    sportKey?: string;
    eventLabel: string;
    homeTeam: string;
    awayTeam: string;
  },
): TrackedBetCandidate | null {
  const marketType = normalizeTrackedBetMarketType(row.market);
  if (!marketType) {
    return null;
  }

  const americanOdds = sanitizeAmericanOdds(row.price);
  if (americanOdds === 0) {
    return null;
  }

  return normalizeCandidate({
    eventId:
      context.eventId ||
      buildFallbackEventId(context.homeTeam, context.awayTeam, marketType),
    gameId: context.gameId,
    mode: context.mode,
    sportKey: context.sportKey ?? NCAA_SPORT_KEY,
    eventLabel: context.eventLabel,
    homeTeam: context.homeTeam,
    awayTeam: context.awayTeam,
    marketType,
    marketLabel: row.market,
    side: row.side,
    linePoint: row.point,
    americanOdds,
    source: "in-game-odds",
  });
}

export function buildTrackedBetCandidateFromTopMarketEv(
  row: TopMarketEvItem,
  options?: {
    gameId?: string;
    mode?: GameMode;
    fallbackMode?: GameMode;
  },
): TrackedBetCandidate | null {
  const marketType = normalizeTrackedBetMarketType(row.marketLabel);
  if (!marketType) {
    return null;
  }

  const americanOdds = sanitizeAmericanOdds(row.offeredOdds);
  if (americanOdds === 0) {
    return null;
  }

  const homeTeam = normalizeText(row.homeTeam) || "Home";
  const awayTeam = normalizeText(row.awayTeam) || "Away";

  return normalizeCandidate({
    eventId:
      normalizeText(row.eventId) ||
      buildFallbackEventId(homeTeam, awayTeam, marketType),
    gameId: options?.gameId,
    mode:
      options?.mode ??
      inferTrackedBetMode(row.sportKey, options?.fallbackMode ?? "college"),
    sportKey: normalizeText(row.sportKey) || undefined,
    eventLabel: normalizeText(row.event) || `${awayTeam} @ ${homeTeam}`,
    homeTeam,
    awayTeam,
    marketType,
    marketLabel: row.marketLabel,
    side: row.side,
    linePoint: row.linePoint,
    americanOdds,
    source: "live-games-pro-ev",
  });
}

export function isTrackedBetSnapshotFinal(
  snapshot: TrackedBetGameSnapshot | null | undefined,
): snapshot is TrackedBetGameSnapshot & { gameStatus: PredictionGameStatus } {
  return Boolean(snapshot && snapshot.gameStatus === "final");
}
