import { StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import type { PlayerProfileStatDatum } from "@/src/features/basketball/playerApi";
import { useAppTheme } from "@/src/theme/useAppTheme";

type PlayerStatTableProps = {
  title: string;
  subtitle?: string;
  rows: PlayerProfileStatDatum[];
};

export default function PlayerStatTable({
  title,
  subtitle,
  rows,
}: PlayerStatTableProps) {
  const { tokens: theme } = useAppTheme();
  const filteredRows = rows.filter(
    (row) => row.displayValue !== "-" && row.displayValue !== "" && row.displayValue !== "0",
  );
  const styles = StyleSheet.create({
    shell: {
      gap: theme.spacing[12],
    },
    header: {
      gap: theme.spacing[4],
    },
    title: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    subtitle: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: theme.spacing[6],
      borderTopWidth: theme.borderWidth.hairline,
      borderTopColor: theme.colors.borderSoft,
    },
    rowLabel: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
    rowValue: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    empty: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
  });

  return (
    <Card>
      <View style={styles.shell}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {filteredRows.length === 0 ? (
          <Text style={styles.empty}>No data available for this section.</Text>
        ) : (
          filteredRows.map((row, index) => (
            <View
              key={row.key}
              style={[styles.row, index === 0 ? { borderTopWidth: 0, paddingTop: 0 } : null]}
            >
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowValue}>{row.displayValue}</Text>
            </View>
          ))
        )}
      </View>
    </Card>
  );
}
