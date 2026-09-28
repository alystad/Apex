import { darkTheme } from "@/src/theme/colors";

export const colors = {
  background: darkTheme.background,
  surface: darkTheme.surface,
  card: darkTheme.card,
  cardSoft: darkTheme.cardElevated,
  text: darkTheme.textPrimary,
  textMuted: darkTheme.textMuted,
  accent: darkTheme.accentStrong,
  success: darkTheme.success,
  upColor: "#4fd38e",
  downColor: "#ef6b6b",
  ratingHigh: "#4fd38e",
  ratingMid: "#f5c86a",
  ratingOrange: "#ff8f1f",
  ratingLow: "#ef6b6b",
};

export type AppColors = typeof colors;

export function getInGameRatingColor(rating: number | null | undefined): string {
  if (typeof rating !== "number" || !Number.isFinite(rating)) {
    return "#70819d";
  }
  if (rating < 4) {
    return colors.ratingLow;
  }
  if (rating < 6) {
    return colors.ratingOrange;
  }
  if (rating < 8) {
    return colors.ratingMid;
  }
  return colors.ratingHigh;
}
