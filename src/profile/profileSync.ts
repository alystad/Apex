import { fetchLiveGamePayload } from "@/src/features/basketball/api";
import {
  buildPredictionSnapshotFromSummaryPayload,
} from "@/src/profile/predictionResolution";
import type {
  GamePrediction,
  PredictionGameSnapshot,
} from "@/src/profile/profileTypes";

export async function refreshPredictionSnapshots(
  predictions: GamePrediction[],
): Promise<PredictionGameSnapshot[]> {
  const uniqueGameIds = [
    ...new Set(
      predictions.map((prediction) => `${prediction.mode}:${prediction.gameId}`),
    ),
  ];

  const settled = await Promise.allSettled(
    uniqueGameIds.map(async (key) => {
      const [mode, gameId] = key.split(":");
      const resolvedMode = mode === "nba" ? "nba" : "college";
      const payload = await fetchLiveGamePayload(resolvedMode, gameId);
      return buildPredictionSnapshotFromSummaryPayload(
        resolvedMode,
        gameId,
        payload,
      );
    }),
  );

  return settled
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<PredictionGameSnapshot | null> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .filter((snapshot): snapshot is PredictionGameSnapshot => snapshot !== null);
}
