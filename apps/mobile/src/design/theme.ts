import { colors } from "@/theme/colors";

export const appTheme = {
  accent: colors.accent,
  textPrimary: colors.text,
  textMuted: colors.textMuted,
  surface: colors.cardSoft,
  danger: colors.downColor,
  onAccent: "#00142a",
  onDanger: "#fff2f2",
} as const;

export type AppTheme = typeof appTheme;
