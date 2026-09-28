import { Pressable, StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import PlayerRatingGraph from "@/components/ui/PlayerRatingGraph";
import type { PlayerProfileGameLogEntry } from "@/src/features/basketball/playerApi";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { getInGameRatingColor } from "@/theme/colors";

type PlayerGameLogCardProps = {
  game: PlayerProfileGameLogEntry;
  highlighted?: boolean;
  onPress?: () => void;
};

function formatDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function PlayerGameLogCard({
  game,
  highlighted = false,
  onPress,
}: PlayerGameLogCardProps) {
  const { tokens: theme } = useAppTheme();
  const ratingColor = getInGameRatingColor(game.dynamicRating);
  const styles = StyleSheet.create({
    pressed: {
      opacity: 0.9,
      transform: [{ scale: 0.995 }],
    },
    card: {
      borderColor: highlighted ? theme.colors.accentStrong : theme.colors.border,
      backgroundColor: highlighted ? theme.colors.cardElevated : theme.colors.card,
    },
    shell: {
      gap: theme.spacing[12],
    },
    topRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: theme.spacing[10],
    },
    opponentBlock: {
      flex: 1,
      gap: theme.spacing[4],
    },
    opponentName: {
      fontSize: 18,
      lineHeight: 22,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    meta: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
    scoreRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    resultPill: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[4],
      backgroundColor:
        game.result === "W"
          ? theme.colors.success
          : game.result === "L"
            ? theme.colors.danger
            : theme.colors.surfaceAlt,
    },
    resultText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      color: game.result ? "#08111d" : theme.colors.textPrimary,
    },
    scoreText: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    ratingPill: {
      minWidth: 72,
      borderRadius: 18,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[8],
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: ratingColor,
    },
    ratingLabel: {
      fontSize: 10,
      lineHeight: 12,
      fontWeight: "800",
      color: "#08111d",
      letterSpacing: 0.3,
      textTransform: "uppercase",
    },
    ratingValue: {
      fontSize: 20,
      lineHeight: 22,
      fontWeight: "800",
      color: "#08111d",
    },
    graphBlock: {
      gap: theme.spacing[6],
    },
    graphLabel: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: theme.colors.textSecondary,
    },
    graphFrame: {
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[8],
      minHeight: 52,
      justifyContent: "center",
    },
    graphFallback: {
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    statGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing[8],
    },
    statCell: {
      minWidth: "22%",
      flexGrow: 1,
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[8],
      gap: theme.spacing[2],
    },
    statLabel: {
      fontSize: 10,
      lineHeight: 12,
      fontWeight: "800",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: theme.colors.textMuted,
    },
    statValue: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    footer: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing[8],
    },
    footerText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
  });

  const statRows = [
    { key: "min", label: "MIN", value: game.minutesDisplay },
    { key: "pts", label: "PTS", value: `${game.points}` },
    { key: "reb", label: "REB", value: `${game.rebounds}` },
    { key: "ast", label: "AST", value: `${game.assists}` },
    { key: "stl", label: "STL", value: `${game.steals}` },
    { key: "blk", label: "BLK", value: `${game.blocks}` },
    { key: "to", label: "TO", value: `${game.turnovers}` },
    { key: "fg", label: "FG", value: game.fg },
    { key: "three", label: "3PT", value: game.threePt },
    { key: "ft", label: "FT", value: game.ft },
  ];
  const hasTimeline = game.ratingTimelinePoints.length > 0;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? styles.pressed : null)}>
      <Card style={styles.card}>
        <View style={styles.shell}>
          <View style={styles.topRow}>
            <View style={styles.opponentBlock}>
              <Text style={styles.opponentName}>
                {game.location === "A" ? "@" : "vs"} {game.opponent.name}
              </Text>
              <Text style={styles.meta}>
                {formatDate(game.date)}
                {game.eventNote ? ` • ${game.eventNote}` : ""}
              </Text>
              <View style={styles.scoreRow}>
                <View style={styles.resultPill}>
                  <Text style={styles.resultText}>{game.result || "-"}</Text>
                </View>
                <Text style={styles.scoreText}>{game.finalScore}</Text>
              </View>
            </View>
            <View style={styles.ratingPill}>
              <Text style={styles.ratingLabel}>Rating</Text>
              <Text style={styles.ratingValue}>
                {typeof game.dynamicRating === "number"
                  ? game.dynamicRating.toFixed(1)
                  : "-"}
              </Text>
            </View>
          </View>

          <View style={styles.graphBlock}>
            <Text style={styles.graphLabel}>Game Rating Trend</Text>
            <View style={styles.graphFrame}>
              {hasTimeline ? (
                <PlayerRatingGraph
                  points={game.ratingTimelinePoints}
                  width={260}
                  height={34}
                />
              ) : (
                <Text style={styles.graphFallback}>
                  No saved rating graph is available for this game.
                </Text>
              )}
            </View>
          </View>

          <View style={styles.statGrid}>
            {statRows.map((stat) => (
              <View key={stat.key} style={styles.statCell}>
                <Text style={styles.statLabel}>{stat.label}</Text>
                <Text style={styles.statValue}>{stat.value}</Text>
              </View>
            ))}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              FG% {typeof game.fgPct === "number" ? `${game.fgPct.toFixed(1)}%` : "-"}
            </Text>
            <Text style={styles.footerText}>
              3PT% {typeof game.threePct === "number" ? `${game.threePct.toFixed(1)}%` : "-"}
            </Text>
            <Text style={styles.footerText}>
              FT% {typeof game.ftPct === "number" ? `${game.ftPct.toFixed(1)}%` : "-"}
            </Text>
            {typeof game.plusMinus === "string" && game.plusMinus.trim() ? (
              <Text style={styles.footerText}>+/- {game.plusMinus}</Text>
            ) : null}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}
