import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/src/theme/useAppTheme";

type StatRowProps = {
  label: string;
  away: number;
  home: number;
  format?: (value: number) => string;
  lowerIsBetter?: boolean;
};

export default function StatRow({
  label,
  away,
  home,
  format = (value) => `${value}`,
  lowerIsBetter = false,
}: StatRowProps) {
  const { tokens: theme, isDark } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          gap: theme.spacing[10],
        },
        top: {
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing[8],
        },
        valueWrap: {
          minWidth: 62,
          borderRadius: theme.radius.pill,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.glass,
          paddingHorizontal: theme.spacing[10],
          paddingVertical: theme.spacing[6],
        },
        valueRight: {
          alignItems: "flex-end",
        },
        value: {
          fontSize: 14,
          lineHeight: 18,
          fontWeight: "700",
          color: theme.colors.textPrimary,
        },
        label: {
          flex: 1,
          textAlign: "center",
          fontSize: 12,
          lineHeight: 16,
          fontWeight: "600",
          color: theme.colors.textSecondary,
        },
        bars: {
          flexDirection: "row",
          gap: theme.spacing[10],
        },
        barAway: {
          height: 8,
          borderRadius: theme.radius.pill,
          backgroundColor: isDark ? "rgba(240, 244, 250, 0.9)" : "#a8b9d3",
        },
        barHome: {
          height: 8,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.accentStrong,
        },
        leading: {
          color: theme.colors.success,
        },
      }),
    [isDark, theme],
  );
  const safeAway = Number.isFinite(away) ? away : 0;
  const safeHome = Number.isFinite(home) ? home : 0;
  const total = Math.max(1, safeAway + safeHome);
  const awayPct = Math.max(6, Math.min(94, (safeAway / total) * 100));
  const homePct = Math.max(6, Math.min(94, (safeHome / total) * 100));
  const awayLead = lowerIsBetter ? safeAway < safeHome : safeAway > safeHome;
  const homeLead = lowerIsBetter ? safeHome < safeAway : safeHome > safeAway;

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <View style={styles.valueWrap}>
          <Text style={[styles.value, awayLead ? styles.leading : null]}>
            {format(safeAway)}
          </Text>
        </View>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.valueWrap, styles.valueRight]}>
          <Text style={[styles.value, homeLead ? styles.leading : null]}>
            {format(safeHome)}
          </Text>
        </View>
      </View>
      <View style={styles.bars}>
        <View style={[styles.barAway, { width: `${awayPct}%` }]} />
        <View style={[styles.barHome, { width: `${homePct}%` }]} />
      </View>
    </View>
  );
}
