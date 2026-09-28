import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import Pill from "@/components/ui/Pill";
import PrimaryButton from "@/components/ui/PrimaryButton";
import SectionHeader from "@/components/ui/SectionHeader";
import type {
  GamePrediction,
  PredictionGameSnapshot,
} from "@/src/profile/profileTypes";
import { useAppTheme } from "@/src/theme/useAppTheme";

type PredictionPickerCardProps = {
  snapshot: PredictionGameSnapshot;
  prediction?: GamePrediction | null;
  onSavePrediction: (pickedTeamId: string) => void;
};

function formatGameTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PredictionPickerCard({
  snapshot,
  prediction,
  onSavePrediction,
}: PredictionPickerCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        subtitleWrap: {
          gap: theme.spacing[6],
          marginBottom: theme.spacing[12],
        },
        subtitle: {
          fontSize: 12,
          lineHeight: 17,
          fontWeight: "600",
          color: theme.colors.textSecondary,
        },
        pickRow: {
          flexDirection: "row",
          gap: theme.spacing[12],
        },
        optionCard: {
          flex: 1,
          borderRadius: theme.radius.lg,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.surfaceAlt,
          paddingHorizontal: theme.spacing[16],
          paddingVertical: theme.spacing[16],
          minHeight: 112,
          gap: theme.spacing[8],
          justifyContent: "space-between",
          position: "relative",
          overflow: "hidden",
        },
        optionSelected: {
          borderColor: theme.colors.accentStrong,
          backgroundColor: theme.colors.cardElevated,
          ...theme.shadows.glow,
        },
        optionLocked: {
          opacity: 0.78,
        },
        optionGlow: {
          position: "absolute",
          top: -32,
          left: -12,
          right: -12,
          height: 72,
          borderRadius: 999,
          backgroundColor: theme.colors.edgeHighlight,
          opacity: 0.08,
        },
        optionLabel: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "800",
          letterSpacing: 0.3,
          textTransform: "uppercase",
          color: theme.colors.textMuted,
        },
        optionValue: {
          fontSize: 18,
          lineHeight: 22,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
        optionMeta: {
          fontSize: 12,
          lineHeight: 16,
          fontWeight: "600",
          color: theme.colors.textMuted,
        },
        selectedMark: {
          position: "absolute",
          top: theme.spacing[12],
          right: theme.spacing[12],
        },
        footerWrap: {
          marginTop: theme.spacing[14],
          gap: theme.spacing[10],
        },
        footerText: {
          fontSize: 12,
          lineHeight: 16,
          fontWeight: "600",
          color: theme.colors.textMuted,
        },
        resultRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing[8],
          marginTop: theme.spacing[4],
        },
        resultText: {
          fontSize: 13,
          lineHeight: 18,
          fontWeight: "700",
          color: theme.colors.textSecondary,
          flex: 1,
        },
      }),
    [theme],
  );
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(
    prediction?.pickedTeamId ?? null,
  );

  useEffect(() => {
    setSelectedTeamId(prediction?.pickedTeamId ?? null);
  }, [prediction?.pickedTeamId]);

  const canEdit = snapshot.gameStatus === "pre";
  const hasSavedPick = prediction?.pickedTeamId != null;
  const hasSelection = selectedTeamId != null;
  const hasPendingChanges = selectedTeamId !== prediction?.pickedTeamId;

  const buttonLabel = !canEdit
    ? "Pick Locked"
    : hasSavedPick
      ? hasPendingChanges
        ? "Update Pick"
        : "Pick Saved"
      : "Save Pick";

  const onCommit = () => {
    if (!canEdit || !selectedTeamId) {
      return;
    }
    onSavePrediction(selectedTeamId);
  };

  const winnerName =
    snapshot.actualWinnerTeamId === snapshot.homeTeamId
      ? snapshot.homeTeamName
      : snapshot.actualWinnerTeamId === snapshot.awayTeamId
        ? snapshot.awayTeamName
        : null;

  return (
    <Card elevated>
      <SectionHeader
        title="Who Will Win?"
        subtitle="Lock your side before tipoff."
        right={
          <Pill
            label={
              snapshot.gameStatus === "pre"
                ? "Open"
                : snapshot.gameStatus === "live"
                  ? "Locked"
                  : "Final"
            }
            tone={
              snapshot.gameStatus === "pre"
                ? "warning"
                : snapshot.gameStatus === "live"
                  ? "live"
                  : prediction?.result === "correct"
                    ? "success"
                    : prediction?.result === "incorrect"
                      ? "danger"
                      : "neutral"
            }
          />
        }
      />

      <View style={styles.subtitleWrap}>
        <Text style={styles.subtitle}>Choose the side you trust.</Text>
        <Text style={styles.subtitle}>{formatGameTime(snapshot.gameDate)}</Text>
      </View>

      <View style={styles.pickRow}>
        {[
          {
            teamId: snapshot.awayTeamId,
            label: "Away",
            teamName: snapshot.awayTeamName,
          },
          {
            teamId: snapshot.homeTeamId,
            label: "Home",
            teamName: snapshot.homeTeamName,
          },
        ].map((option) => {
          const selected = selectedTeamId === option.teamId;
          return (
            <Pressable
              key={option.teamId}
              disabled={!canEdit}
              onPress={() => setSelectedTeamId(option.teamId)}
              style={[
                styles.optionCard,
                selected ? styles.optionSelected : null,
                !canEdit ? styles.optionLocked : null,
              ]}
            >
              <View pointerEvents="none" style={styles.optionGlow} />
              {selected ? (
                <View style={styles.selectedMark}>
                  <FontAwesome
                    name="check-circle"
                    size={18}
                    color={theme.colors.accentStrong}
                  />
                </View>
              ) : null}
              <Text style={styles.optionLabel}>{option.label}</Text>
              <Text style={styles.optionValue}>{option.teamName}</Text>
              <Text style={styles.optionMeta}>
                {prediction?.pickedTeamId === option.teamId ? "Current pick" : "Tap to pick"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footerWrap}>
        <PrimaryButton
          label={buttonLabel}
          onPress={onCommit}
          disabled={!canEdit || !hasSelection || !hasPendingChanges}
        />
        {prediction?.pickedTeamName ? (
          <Text style={styles.footerText}>
            Saved pick: {prediction.pickedTeamName}
          </Text>
        ) : (
          <Text style={styles.footerText}>
            Picks can be updated until the game begins.
          </Text>
        )}
        {!canEdit ? (
          <View style={styles.resultRow}>
            {prediction?.result ? (
              <Pill
                label={
                  prediction.result === "pending"
                    ? "Pending"
                    : prediction.result === "correct"
                      ? "Correct"
                      : "Incorrect"
                }
                tone={
                  prediction.result === "correct"
                    ? "success"
                    : prediction.result === "incorrect"
                      ? "danger"
                      : "warning"
                }
              />
            ) : null}
            <Text style={styles.resultText}>
              {snapshot.gameStatus === "live"
                ? "Your pick is locked until the final result is available."
                : winnerName
                  ? `Winner: ${winnerName}`
                  : "Final result unavailable."}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}
