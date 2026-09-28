import type {
  BaseballBattingLine,
  BaseballFieldingLine,
  BaseballPitchingLine,
  BaseballRatingBreakdownItem,
  BaseballRatingResult,
} from "@/src/features/baseball/baseballTypes";
import { computeBaseballGameImpacts } from "@/src/ratings/baseball/BaseballRankingEngine";

export type BaseballRatingEngineInput = {
  batting?: BaseballBattingLine | null;
  pitching?: BaseballPitchingLine | null;
  fielding?: BaseballFieldingLine | null;
  previousRating?: number | null;
  playerId?: string;
  playerName?: string;
  teamId?: string;
  teamName?: string;
  position?: string | null;
  gameId?: string;
  date?: string;
  opponent?: string;
  finalMargin?: number | null;
  starterHint?: boolean | null;
};

function round(value: number): number {
  return Number(value.toFixed(2));
}

function toLegacyBreakdown(
  items: Array<{ label: string; value: number; detail?: string }>,
): BaseballRatingBreakdownItem[] {
  return items
    .filter((item) => Number.isFinite(item.value))
    .map((item) => ({
      key: item.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      label: item.label,
      value: round(item.value),
      displayValue: `${item.value >= 0 ? "+" : ""}${round(item.value).toFixed(2)}`,
      positive: item.value >= 0,
    }));
}

export function computeBaseballRating(
  input: BaseballRatingEngineInput,
): BaseballRatingResult {
  const result = computeBaseballGameImpacts([
    {
      playerId: input.playerId ?? "player",
      playerName: input.playerName ?? "Player",
      teamId: input.teamId ?? "team",
      teamName: input.teamName ?? "Team",
      position: input.position ?? (input.pitching ? "P" : "DH"),
      batting: input.batting ?? null,
      pitching: input.pitching ?? null,
      fielding: input.fielding ?? null,
      game: {
        gameId: input.gameId ?? "single-game",
        date: input.date ?? new Date().toISOString(),
        opponent: input.opponent,
        finalMargin: input.finalMargin ?? null,
        isCloseGame:
          typeof input.finalMargin === "number"
            ? Math.abs(input.finalMargin) <= 2
            : null,
        leverageKnown: typeof input.finalMargin === "number",
        starterHint: input.starterHint ?? null,
      },
    },
  ])[0];

  const rating = result?.output.overallRating ?? 5;
  const previousRating =
    typeof input.previousRating === "number" && Number.isFinite(input.previousRating)
      ? input.previousRating
      : null;

  return {
    rating,
    delta: previousRating === null ? null : round(rating - previousRating),
    breakdown: toLegacyBreakdown(
      result?.output.breakdown.map((item) => ({
        label: item.label,
        value: item.value,
        detail: item.detail,
      })) ?? [],
    ),
  };
}
