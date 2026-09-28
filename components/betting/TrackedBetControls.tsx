import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from "react-native";

import LiquidGlassButton from "@/components/ui/LiquidGlassButton";
import {
  getTrackedBetFinancials,
  sanitizeTrackedBetStake,
} from "@/src/features/betting/trackedBets";
import type {
  TrackedBetCandidate,
  TrackedBetResult,
  TrackedProEvBet,
} from "@/src/profile/profileTypes";
import { useAppTheme } from "@/src/theme/useAppTheme";

function formatCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function stopPress(event: GestureResponderEvent) {
  event.stopPropagation();
}

export default function TrackedBetControls({
  candidate,
  trackedBet,
  onToggle,
  onStakeChange,
  onResultChange,
}: {
  candidate: TrackedBetCandidate;
  trackedBet?: TrackedProEvBet | null;
  onToggle: (candidate: TrackedBetCandidate) => void;
  onStakeChange: (key: string, stake: number) => void;
  onResultChange: (key: string, result: TrackedBetResult) => void;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          marginTop: theme.spacing[10],
          gap: theme.spacing[8],
        },
        topRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing[10],
          flexWrap: "wrap",
        },
        stakeWrap: {
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing[8],
          flexShrink: 1,
        },
        stakeLabel: {
          ...theme.type.caption,
          color: theme.colors.textSecondary,
        },
        stakeInput: {
          minWidth: 88,
          borderRadius: theme.radius.pill,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.surface,
          color: theme.colors.textPrimary,
          paddingHorizontal: theme.spacing[12],
          paddingVertical: theme.spacing[8],
          fontSize: theme.fontSizes.body,
          fontWeight: "700",
        },
        resultRow: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing[8],
        },
        resultChip: {
          paddingHorizontal: theme.spacing[10],
          paddingVertical: theme.spacing[6],
          borderRadius: theme.radius.pill,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.surface,
        },
        resultChipActive: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.glassStrong,
        },
        resultText: {
          ...theme.type.micro,
          color: theme.colors.textSecondary,
        },
        resultTextActive: {
          color: "#FFFFFF",
        },
        payoutText: {
          ...theme.type.caption,
          color: theme.colors.textSecondary,
        },
      }),
    [theme],
  );
  const [stakeText, setStakeText] = useState(
    trackedBet ? trackedBet.stake.toFixed(2) : sanitizeTrackedBetStake(10).toFixed(2),
  );

  useEffect(() => {
    if (!trackedBet) {
      setStakeText(sanitizeTrackedBetStake(10).toFixed(2));
      return;
    }
    setStakeText(trackedBet.stake.toFixed(2));
  }, [trackedBet]);

  const financials = trackedBet ? getTrackedBetFinancials(trackedBet) : null;
  const payoutText = useMemo(() => {
    if (!trackedBet || !financials) {
      return null;
    }

    const sourceTag =
      trackedBet.result === "open"
        ? ""
        : trackedBet.settlementSource === "auto"
          ? " | Auto settled"
          : trackedBet.settlementSource === "manual"
            ? " | Manual"
            : "";

    if (trackedBet.result === "open") {
      return `To win ${formatCurrency(financials.openPotentialProfit)} | Return ${formatCurrency(financials.openPotentialReturn)}`;
    }
    if (trackedBet.result === "win") {
      return `Won ${formatCurrency(financials.settledNet)} net${sourceTag}`;
    }
    if (trackedBet.result === "loss") {
      return `Lost ${formatCurrency(Math.abs(financials.settledNet))}${sourceTag}`;
    }
    return `Push | ${formatCurrency(financials.settledNet)} net${sourceTag}`;
  }, [financials, trackedBet]);

  const handleToggle = (event: GestureResponderEvent) => {
    stopPress(event);
    onToggle(candidate);
  };

  const handleStakeChange = (value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, "");
    const [whole = "", fraction = ""] = cleaned.split(".");
    const normalized =
      cleaned.includes(".") ? `${whole}.${fraction.slice(0, 2)}` : whole;

    setStakeText(normalized);
    if (!trackedBet) {
      return;
    }

    if (!normalized) {
      onStakeChange(trackedBet.key, 0);
      return;
    }

    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      onStakeChange(trackedBet.key, parsed);
    }
  };

  const commitStake = () => {
    if (!trackedBet) {
      return;
    }
    const nextStake = sanitizeTrackedBetStake(stakeText);
    setStakeText(nextStake.toFixed(2));
    onStakeChange(trackedBet.key, nextStake);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <LiquidGlassButton
          label={trackedBet ? "Taken" : "Take"}
          size="sm"
          tone={trackedBet ? "accent" : "neutral"}
          onPress={handleToggle}
        />
        {trackedBet ? (
          <View style={styles.stakeWrap}>
            <Text style={styles.stakeLabel}>Stake</Text>
            <TextInput
              value={stakeText}
              onChangeText={handleStakeChange}
              onBlur={commitStake}
              onSubmitEditing={commitStake}
              keyboardType="decimal-pad"
              returnKeyType="done"
              style={styles.stakeInput}
              placeholder="10.00"
              placeholderTextColor={theme.colors.textMuted}
            />
          </View>
        ) : null}
      </View>
      {trackedBet ? (
        <>
          <View style={styles.resultRow}>
            {(["open", "win", "loss", "push"] as const).map((result) => {
              const active = trackedBet.result === result;
              return (
                <Pressable
                  key={result}
                  onPress={(event) => {
                    stopPress(event);
                    onResultChange(trackedBet.key, result);
                  }}
                  style={[
                    styles.resultChip,
                    active ? styles.resultChipActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.resultText,
                      active ? styles.resultTextActive : null,
                    ]}
                  >
                    {result === "open"
                      ? "Open"
                      : result === "win"
                        ? "Win"
                        : result === "loss"
                          ? "Loss"
                          : "Push"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {payoutText ? <Text style={styles.payoutText}>{payoutText}</Text> : null}
        </>
      ) : null}
    </View>
  );
}
