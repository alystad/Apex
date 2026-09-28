import { darkTheme } from "@/src/theme/colors";

export const tokens = {
  colors: {
    bgApp: darkTheme.background,
    bgSurface: darkTheme.surface,
    bgCard: darkTheme.card,
    bgCardSoft: darkTheme.cardElevated,
    border: darkTheme.border,
    borderSoft: darkTheme.borderSoft,
    textPrimary: darkTheme.textPrimary,
    textSecondary: darkTheme.textSecondary,
    textTertiary: darkTheme.textMuted,
    accentGreen: "#00d95f",
    accentBlue: darkTheme.accentStrong,
    success: darkTheme.success,
    warning: darkTheme.warning,
    danger: darkTheme.danger,
    statusLive: {
      bg: "#132419",
      fg: "#89f2bd",
    },
    statusFinal: {
      bg: "#171717",
      fg: darkTheme.textPrimary,
    },
    statusScheduled: {
      bg: "#1a1610",
      fg: "#f1dc94",
    },
  },
  spacing: {
    0: 0,
    2: 2,
    4: 4,
    6: 6,
    8: 8,
    10: 10,
    12: 12,
    14: 14,
    16: 16,
    20: 20,
    24: 24,
    28: 28,
    32: 32,
  },
  radius: {
    sm: 10,
    md: 14,
    lg: 18,
    xl: 24,
    pill: 999,
  },
  type: {
    title: {
      fontSize: 30,
      lineHeight: 36,
      fontWeight: "800",
    },
    subtitle: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "700",
    },
    body: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "600",
    },
    caption: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
    },
  },
  shadows: {
    card: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.24,
      shadowRadius: 18,
      elevation: 6,
    },
    floating: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.32,
      shadowRadius: 24,
      elevation: 10,
    },
  },
  opacity: {
    disabled: 0.45,
    pressed: 0.86,
  },
} as const;

export type Tokens = typeof tokens;
