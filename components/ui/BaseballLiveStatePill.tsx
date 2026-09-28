import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import BaseOccupancyDiamond from "@/components/ui/BaseOccupancyDiamond";
import type { BaseballGameSituation } from "@/src/features/baseball/baseballTypes";
import { useAppTheme } from "@/src/theme/useAppTheme";

type BaseballLiveStatePillProps = {
  situation?: BaseballGameSituation | null;
  compact?: boolean;
};

function buildCountLabel(situation?: BaseballGameSituation | null): string {
  if (!situation) {
    return "";
  }
  const parts = [
    typeof situation.outs === "number" ? `${situation.outs} out${situation.outs === 1 ? "" : "s"}` : "",
    typeof situation.balls === "number" && typeof situation.strikes === "number"
      ? `${situation.balls}-${situation.strikes}`
      : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

export default function BaseballLiveStatePill({
  situation,
  compact = false,
}: BaseballLiveStatePillProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          minHeight: compact ? 28 : 34,
          borderRadius: theme.radius.pill,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.glassStrong,
          flexDirection: "row",
          alignItems: "center",
          gap: compact ? theme.spacing[6] : theme.spacing[8],
          paddingLeft: compact ? theme.spacing[8] : theme.spacing[10],
          paddingRight: compact ? theme.spacing[8] : theme.spacing[10],
          paddingVertical: compact ? theme.spacing[4] : theme.spacing[6],
        },
        copy: {
          flex: 1,
          minWidth: 0,
        },
        label: {
          fontSize: compact ? 11 : 12,
          lineHeight: compact ? 14 : 16,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
        meta: {
          fontSize: 10,
          lineHeight: 12,
          fontWeight: "700",
          color: theme.colors.textMuted,
        },
      }),
    [compact, theme],
  );

  if (!situation) {
    return null;
  }

  const countLabel = buildCountLabel(situation);

  return (
    <View style={styles.wrap}>
      <BaseOccupancyDiamond bases={situation.bases} size={compact ? 24 : 28} />
      <View style={styles.copy}>
        <Text style={styles.label} numberOfLines={1}>
          {situation.label}
        </Text>
        {countLabel ? (
          <Text style={styles.meta} numberOfLines={1}>
            {countLabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
