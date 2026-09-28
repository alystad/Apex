import { useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import type { LiveGameData, LiveGameTeam } from "@/hooks/useLiveGame";
import {
  useGameInsights,
  type GameInsightsPhase,
} from "@/src/features/recap/useGameInsights";
import { useAppTheme } from "@/src/theme/useAppTheme";

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function teamShortLabel(team: LiveGameTeam | undefined): string {
  return team?.abbreviation || team?.shortDisplayName || team?.displayName || "Team";
}

export type GameInsightsCardProps = {
  data: LiveGameData;
  phase: GameInsightsPhase;
};

/**
 * Insights for the Live and Recap states of the story tab. Visually mirrors
 * the Preview tab's Insights card (per-team header + bulleted list) so the
 * section reads as the same thing across all three states — but it's a
 * separate implementation on separate generation logic, and the Preview
 * version is untouched.
 */
export default function GameInsightsCard({ data, phase }: GameInsightsCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { insights, loading, unavailable } = useGameInsights(data, phase);

  const teams = data.teams ?? [];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[0];
  const home = teams.find((team) => team.homeAway === "home") ?? teams[1];

  const groups = [
    { team: away, list: insights.away },
    { team: home, list: insights.home },
  ];
  const hasAny = insights.away.length > 0 || insights.home.length > 0;

  // Nothing to show and nothing to say about it — don't leave an empty card.
  if (!loading && !unavailable && !hasAny) {
    return null;
  }

  return (
    <Card>
      <SectionHeader title="Insights" />
      {loading && !hasAny ? (
        <Text style={styles.mutedText}>
          {phase === "live" ? "Reading the game…" : "Generating insights…"}
        </Text>
      ) : unavailable && !hasAny ? (
        <Text style={styles.mutedText}>Insights unavailable</Text>
      ) : (
        <View style={styles.groups}>
          {groups.map(({ team, list }, groupIndex) => (
            <View key={team?.id ?? groupIndex} style={styles.teamBlock}>
              <View style={styles.teamHeader}>
                <Image
                  source={{ uri: team?.logo || FALLBACK_IMAGE_URI }}
                  style={styles.teamLogo}
                />
                <Text style={styles.teamLabel}>{teamShortLabel(team)}</Text>
              </View>
              {list.length === 0 ? (
                <Text style={styles.mutedText}>No insights available.</Text>
              ) : (
                list.map((text, index) => (
                  <View key={index} style={styles.row}>
                    <View style={styles.bullet} />
                    <Text style={styles.text}>{text}</Text>
                  </View>
                ))
              )}
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    mutedText: {
      marginTop: theme.spacing[10],
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
    groups: {
      marginTop: theme.spacing[10],
      gap: theme.spacing[14],
    },
    teamBlock: {
      gap: theme.spacing[6],
    },
    teamHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    teamLogo: {
      width: 20,
      height: 20,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
    },
    teamLabel: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing[8],
      paddingVertical: theme.spacing[2],
    },
    bullet: {
      width: 5,
      height: 5,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.accent,
      marginTop: 7,
    },
    text: {
      flex: 1,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: "500",
      color: theme.colors.textSecondary,
    },
  });
}
