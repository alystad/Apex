import type { TextStyle } from "react-native";

import { tokens } from "@/src/theme/tokens";

type TypeScale = Record<string, TextStyle>;

export const typography: TypeScale = {
  display: {
    fontSize: 38,
    lineHeight: 42,
    fontWeight: "800",
    color: tokens.colors.textPrimary,
  },
  title: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "800",
    color: tokens.colors.textPrimary,
  },
  section: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "800",
    color: tokens.colors.textPrimary,
  },
  subtitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    color: tokens.colors.textPrimary,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: tokens.colors.textPrimary,
  },
  meta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: tokens.colors.textMuted,
  },
  micro: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    color: tokens.colors.textMuted,
    letterSpacing: 0.28,
  },
};
