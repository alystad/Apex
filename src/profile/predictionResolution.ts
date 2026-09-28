import type { LiveGameData, LiveGameTeam } from "@/hooks/useLiveGame";
import type {
  GamePrediction,
  PredictionGameSnapshot,
  PredictionGameStatus,
  PredictionResult,
} from "@/src/profile/profileTypes";

type LiveGameSummaryPayload = {
  header?: {
    competitions?: Array<{
      date?: string;
      status?: {
        type?: {
          state?: string;
          description?: string;
          detail?: string;
          shortDetail?: string;
        };
      };
      competitors?: Array<{
        homeAway?: "home" | "away";
        score?: string | number;
        team?: {
          id?: string;
          displayName?: string;
          shortDisplayName?: string;
        };
      }>;
    }>;
  };
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

export function normalizePredictionGameStatus({
  rawState,
  detail,
  startDate,
}: {
  rawState?: string | null;
  detail?: string | null;
  startDate?: string | null;
}): PredictionGameStatus {
  const state = `${normalizeText(rawState)} ${normalizeText(detail)}`.toLowerCase();

  if (
    state.includes("post") ||
    state.includes("final") ||
    state.includes("complete")
  ) {
    return "final";
  }

  if (
    state.includes("in") ||
    state.includes("live") ||
    state.includes("progress")
  ) {
    return "live";
  }

  if (startDate) {
    const start = new Date(startDate);
    if (!Number.isNaN(start.getTime()) && start.getTime() <= Date.now()) {
      return "live";
    }
  }

  return "pre";
}

export function deriveWinnerTeamId({
  homeTeamId,
  awayTeamId,
  homeScore,
  awayScore,
  gameStatus,
}: {
  homeTeamId: string;
  awayTeamId: string;
  homeScore?: number | null;
  awayScore?: number | null;
  gameStatus: PredictionGameStatus;
}): string | undefined {
  if (gameStatus !== "final") {
    return undefined;
  }
  if (
    typeof homeScore !== "number" ||
    !Number.isFinite(homeScore) ||
    typeof awayScore !== "number" ||
    !Number.isFinite(awayScore) ||
    homeScore === awayScore
  ) {
    return undefined;
  }
  return homeScore > awayScore ? homeTeamId : awayTeamId;
}

function resolvePredictionResult(
  pickedTeamId: string,
  winnerTeamId: string | undefined,
  gameStatus: PredictionGameStatus,
): PredictionResult {
  if (gameStatus !== "final" || !winnerTeamId) {
    return "pending";
  }
  return pickedTeamId === winnerTeamId ? "correct" : "incorrect";
}

function derivePickedTeamName(
  snapshot: PredictionGameSnapshot,
  pickedTeamId: string,
): string {
  if (pickedTeamId === snapshot.homeTeamId) {
    return snapshot.homeTeamName;
  }
  if (pickedTeamId === snapshot.awayTeamId) {
    return snapshot.awayTeamName;
  }
  return pickedTeamId;
}

export function createPredictionFromSnapshot(
  snapshot: PredictionGameSnapshot,
  pickedTeamId: string,
  existing?: GamePrediction | null,
): GamePrediction | null {
  if (
    pickedTeamId !== snapshot.homeTeamId &&
    pickedTeamId !== snapshot.awayTeamId
  ) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const actualWinnerTeamId = snapshot.actualWinnerTeamId;

  return {
    mode: snapshot.mode,
    gameId: snapshot.gameId,
    pickedTeamId,
    pickedTeamName: derivePickedTeamName(snapshot, pickedTeamId),
    homeTeamId: snapshot.homeTeamId,
    awayTeamId: snapshot.awayTeamId,
    homeTeamName: snapshot.homeTeamName,
    awayTeamName: snapshot.awayTeamName,
    gameDate: snapshot.gameDate,
    conference: snapshot.conference,
    gameStatus: snapshot.gameStatus,
    actualWinnerTeamId,
    result: resolvePredictionResult(
      pickedTeamId,
      actualWinnerTeamId,
      snapshot.gameStatus,
    ),
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

export function syncPredictionWithSnapshot(
  prediction: GamePrediction,
  snapshot: PredictionGameSnapshot,
): GamePrediction {
  const actualWinnerTeamId = snapshot.actualWinnerTeamId;

  return {
    ...prediction,
    pickedTeamName: derivePickedTeamName(snapshot, prediction.pickedTeamId),
    homeTeamId: snapshot.homeTeamId,
    awayTeamId: snapshot.awayTeamId,
    homeTeamName: snapshot.homeTeamName,
    awayTeamName: snapshot.awayTeamName,
    gameDate: snapshot.gameDate,
    conference: snapshot.conference ?? prediction.conference,
    gameStatus: snapshot.gameStatus,
    actualWinnerTeamId,
    result: resolvePredictionResult(
      prediction.pickedTeamId,
      actualWinnerTeamId,
      snapshot.gameStatus,
    ),
    updatedAt: new Date().toISOString(),
  };
}

export function arePredictionsEqual(
  left: GamePrediction,
  right: GamePrediction,
): boolean {
  return (
    left.mode === right.mode &&
    left.gameId === right.gameId &&
    left.pickedTeamId === right.pickedTeamId &&
    left.pickedTeamName === right.pickedTeamName &&
    left.homeTeamId === right.homeTeamId &&
    left.awayTeamId === right.awayTeamId &&
    left.homeTeamName === right.homeTeamName &&
    left.awayTeamName === right.awayTeamName &&
    left.gameDate === right.gameDate &&
    left.conference === right.conference &&
    left.gameStatus === right.gameStatus &&
    left.actualWinnerTeamId === right.actualWinnerTeamId &&
    left.result === right.result
  );
}

function pickTeamName(team: LiveGameTeam | undefined): string {
  return team?.shortDisplayName || team?.displayName || "Team";
}

export function buildPredictionSnapshotFromLiveGame(
  data: LiveGameData | null,
): PredictionGameSnapshot | null {
  if (!data) {
    return null;
  }

  const homeTeam = data.teams.find((team) => team.homeAway === "home");
  const awayTeam = data.teams.find((team) => team.homeAway === "away");
  if (!homeTeam || !awayTeam) {
    return null;
  }

  const gameStatus = normalizePredictionGameStatus({
    rawState: data.status.state,
    detail:
      data.status.shortDetail || data.status.detail || data.status.description,
    startDate: data.meta.startDateTime,
  });
  const homeScore = parseScore(homeTeam.score);
  const awayScore = parseScore(awayTeam.score);

  return {
    mode: data.mode,
    gameId: data.eventId,
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    homeTeamName: pickTeamName(homeTeam),
    awayTeamName: pickTeamName(awayTeam),
    gameDate: data.meta.startDateTime || new Date().toISOString(),
    gameStatus,
    actualWinnerTeamId: deriveWinnerTeamId({
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      homeScore,
      awayScore,
      gameStatus,
    }),
  };
}

export function buildPredictionSnapshotFromSummaryPayload(
  mode: GamePrediction["mode"],
  gameId: string,
  payload: unknown,
): PredictionGameSnapshot | null {
  const competition = (payload as LiveGameSummaryPayload)?.header?.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const home = competitors.find((row) => row.homeAway === "home");
  const away = competitors.find((row) => row.homeAway === "away");
  const homeTeamId = normalizeText(home?.team?.id);
  const awayTeamId = normalizeText(away?.team?.id);
  if (!homeTeamId || !awayTeamId) {
    return null;
  }

  const gameStatus = normalizePredictionGameStatus({
    rawState: competition?.status?.type?.state,
    detail:
      competition?.status?.type?.shortDetail ||
      competition?.status?.type?.detail ||
      competition?.status?.type?.description,
    startDate: competition?.date,
  });
  const homeScore = parseScore(home?.score);
  const awayScore = parseScore(away?.score);

  return {
    mode,
    gameId,
    homeTeamId,
    awayTeamId,
    homeTeamName:
      normalizeText(home?.team?.shortDisplayName) ||
      normalizeText(home?.team?.displayName) ||
      "Home",
    awayTeamName:
      normalizeText(away?.team?.shortDisplayName) ||
      normalizeText(away?.team?.displayName) ||
      "Away",
    gameDate: normalizeText(competition?.date) || new Date().toISOString(),
    gameStatus,
    actualWinnerTeamId: deriveWinnerTeamId({
      homeTeamId,
      awayTeamId,
      homeScore,
      awayScore,
      gameStatus,
    }),
  };
}
