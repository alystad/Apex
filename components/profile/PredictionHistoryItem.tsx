import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import Pill from "@/components/ui/Pill";
import type { GamePrediction } from "@/src/profile/profileTypes";
import { useAppTheme } from "@/src/theme/useAppTheme";

type PredictionHistoryItemProps = {
  prediction: GamePrediction;
};

function formatPredictionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function toneForResult(
  result: GamePrediction["result"],
): "success" | "danger" | "warning" {
  if (result === "correct") {
    return "success";
  }
  if (result === "incorrect") {
    return "danger";
  }
  return "warning";
}

function labelForResult(prediction: GamePrediction): string {
  if (prediction.result === "correct") {
    return "Correct";
  }
  if (prediction.result === "incorrect") {
    return "Incorrect";
  }
  return prediction.gameStatus === "live" ? "Locked" : "Pending";
}

export default function PredictionHistoryItem({
  prediction,
}: PredictionHistoryItemProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        topRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: theme.spacing[8],
          marginBottom: theme.spacing[8],
        },
        date: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "800",
          letterSpacing: 0.3,
          textTransform: "uppercase",
          color: theme.colors.textMuted,
        },
        teams: {
          fontSize: 15,
          lineHeight: 20,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
        metaRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: theme.spacing[8],
          marginTop: theme.spacing[6],
        },
        metaWrap: {
          flex: 1,
          gap: theme.spacing[2],
        },
        metaLabel: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "800",
          letterSpacing: 0.2,
          textTransform: "uppercase",
          color: theme.colors.textMuted,
        },
        metaValue: {
          fontSize: 13,
          lineHeight: 18,
          fontWeight: "700",
          color: theme.colors.textSecondary,
        },
      }),
    [theme],
  );

  return (
    <Card>
      <View style={styles.topRow}>
        <Text style={styles.date}>{formatPredictionDate(prediction.gameDate)}</Text>
        <Pill
          label={labelForResult(prediction)}
          tone={toneForResult(prediction.result)}
        />
      </View>

      <Text style={styles.teams} numberOfLines={2}>
        {prediction.awayTeamName} at {prediction.homeTeamName}
      </Text>

      <View style={styles.metaRow}>
        <View style={styles.metaWrap}>
          <Text style={styles.metaLabel}>Your Pick</Text>
          <Text style={styles.metaValue}>{prediction.pickedTeamName}</Text>
        </View>
        <View style={styles.metaWrap}>
          <Text style={styles.metaLabel}>Winner</Text>
          <Text style={styles.metaValue}>
            {prediction.actualWinnerTeamId
              ? prediction.actualWinnerTeamId === prediction.homeTeamId
                ? prediction.homeTeamName
                : prediction.awayTeamName
              : prediction.gameStatus === "live"
                ? "In progress"
                : "TBD"}
          </Text>
        </View>
      </View>
    </Card>
  );
}
