import type {
  GamePrediction,
  PredictionInsight,
  PredictionStats,
} from "@/src/profile/profileTypes";

function safeDateValue(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortPredictionsNewestFirst(
  predictions: GamePrediction[],
): GamePrediction[] {
  return [...predictions].sort((left, right) => {
    const dateDiff = safeDateValue(right.gameDate) - safeDateValue(left.gameDate);
    if (dateDiff !== 0) {
      return dateDiff;
    }
    return safeDateValue(right.updatedAt) - safeDateValue(left.updatedAt);
  });
}

export function calculatePredictionStats(
  predictions: GamePrediction[],
): PredictionStats {
  const resolvedPredictions = [...predictions]
    .filter((prediction) => prediction.result !== "pending")
    .sort((left, right) => {
      const dateDiff = safeDateValue(left.gameDate) - safeDateValue(right.gameDate);
      if (dateDiff !== 0) {
        return dateDiff;
      }
      return safeDateValue(left.updatedAt) - safeDateValue(right.updatedAt);
    });

  const correct = predictions.filter((prediction) => prediction.result === "correct").length;
  const incorrect = predictions.filter((prediction) => prediction.result === "incorrect").length;
  const pending = predictions.filter((prediction) => prediction.result === "pending").length;

  let runningStreak = 0;
  let bestStreak = 0;
  resolvedPredictions.forEach((prediction) => {
    if (prediction.result === "correct") {
      runningStreak += 1;
      if (runningStreak > bestStreak) {
        bestStreak = runningStreak;
      }
      return;
    }
    runningStreak = 0;
  });

  let currentStreak = 0;
  for (let index = resolvedPredictions.length - 1; index >= 0; index -= 1) {
    if (resolvedPredictions[index].result !== "correct") {
      break;
    }
    currentStreak += 1;
  }

  const homeCorrect = predictions.filter(
    (prediction) =>
      prediction.pickedTeamId === prediction.homeTeamId &&
      prediction.result === "correct",
  ).length;
  const homeIncorrect = predictions.filter(
    (prediction) =>
      prediction.pickedTeamId === prediction.homeTeamId &&
      prediction.result === "incorrect",
  ).length;
  const awayCorrect = predictions.filter(
    (prediction) =>
      prediction.pickedTeamId === prediction.awayTeamId &&
      prediction.result === "correct",
  ).length;
  const awayIncorrect = predictions.filter(
    (prediction) =>
      prediction.pickedTeamId === prediction.awayTeamId &&
      prediction.result === "incorrect",
  ).length;

  const resolvedCount = correct + incorrect;

  return {
    total: predictions.length,
    correct,
    incorrect,
    pending,
    winPct: resolvedCount > 0 ? (correct / resolvedCount) * 100 : 0,
    currentStreak,
    bestStreak,
    homeCorrect,
    homeIncorrect,
    awayCorrect,
    awayIncorrect,
  };
}

export function calculatePredictionInsights(
  predictions: GamePrediction[],
): PredictionInsight {
  const teamCounts = new Map<string, { name: string; count: number }>();
  const conferenceCounts = new Map<string, number>();

  predictions.forEach((prediction) => {
    const teamName = prediction.pickedTeamName || "Team";
    const existingTeam = teamCounts.get(prediction.pickedTeamId);
    teamCounts.set(prediction.pickedTeamId, {
      name: teamName,
      count: (existingTeam?.count ?? 0) + 1,
    });

    if (prediction.conference) {
      conferenceCounts.set(
        prediction.conference,
        (conferenceCounts.get(prediction.conference) ?? 0) + 1,
      );
    }
  });

  const mostPickedTeamName =
    [...teamCounts.values()].sort((left, right) => right.count - left.count)[0]?.name ??
    null;
  const mostPickedConference =
    [...conferenceCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
    null;

  return {
    mostPickedTeamName,
    mostPickedConference,
  };
}

