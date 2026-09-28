import type { TextStyle } from "react-native";

import type { LiveGameTeam } from "@/hooks/useLiveGame";
import type { ThemeTokens } from "@/src/theme/tokens";

export const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

// Matches the Stats tab's SectionHeader title (14px / 800 / +0.2 tracking) so
// every Preview section header renders at the same size/weight as Stats.
export function previewSectionTitleStyle(theme: ThemeTokens): TextStyle {
  return {
    fontSize: 14,
    lineHeight: 17,
    fontWeight: "800",
    color: theme.colors.textPrimary,
    letterSpacing: 0.2,
  };
}

export function normalizeImageUri(value: string | undefined): string {
  if (typeof value !== "string" || !value.trim()) {
    return FALLBACK_IMAGE_URI;
  }
  return value.trim();
}

/** Minimal shape the preview section placeholders need from a team. */
export type PreviewTeam = Pick<
  LiveGameTeam,
  "id" | "abbreviation" | "displayName" | "shortDisplayName" | "logo" | "color"
>;

export function teamShortLabel(team: PreviewTeam | undefined): string {
  if (!team) {
    return "—";
  }
  return team.abbreviation || team.shortDisplayName || team.displayName || "—";
}
