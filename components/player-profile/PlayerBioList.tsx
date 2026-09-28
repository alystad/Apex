import { StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import { useAppTheme } from "@/src/theme/useAppTheme";

export type PlayerBioRow = {
  key: string;
  label: string;
  value: string | null | undefined;
};

type PlayerBioListProps = {
  title?: string;
  rows: PlayerBioRow[];
};

export default function PlayerBioList({
  title = "Bio",
  rows,
}: PlayerBioListProps) {
  const { tokens: theme } = useAppTheme();
  const filteredRows = rows.filter((row) => typeof row.value === "string" && row.value.trim().length > 0);
  const styles = StyleSheet.create({
    shell: {
      gap: theme.spacing[12],
    },
    title: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[12],
      paddingVertical: theme.spacing[8],
      borderTopWidth: theme.borderWidth.hairline,
      borderTopColor: theme.colors.borderSoft,
    },
    label: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
    value: {
      flex: 1,
      textAlign: "right",
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
        <Text style={styles.title}>{title}</Text>
        {filteredRows.length === 0 ? (
          <Text style={styles.empty}>No bio data is available yet.</Text>
        ) : (
          filteredRows.map((row, index) => (
            <View
              key={row.key}
              style={[styles.row, index === 0 ? { borderTopWidth: 0, paddingTop: 0 } : null]}
            >
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value}>{row.value}</Text>
            </View>
          ))
        )}
      </View>
    </Card>
  );
}
