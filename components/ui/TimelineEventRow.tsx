import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { LiveGamePlay } from "@/hooks/useLiveGame";
import { useAppTheme } from "@/src/theme/useAppTheme";

type TimelineEventRowProps = {
  play: LiveGamePlay;
};

export default function TimelineEventRow({ play }: TimelineEventRowProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          borderRadius: theme.radius.lg,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.surfaceAlt,
          paddingHorizontal: theme.spacing[14],
          paddingVertical: theme.spacing[12],
          flexDirection: "row",
          gap: theme.spacing[12],
        },
        timeCol: {
          width: 62,
          gap: theme.spacing[6],
        },
        time: {
          alignSelf: "flex-start",
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "800",
          letterSpacing: 0.2,
          color: theme.colors.accentStrong,
          paddingHorizontal: theme.spacing[8],
          paddingVertical: theme.spacing[4],
          borderRadius: theme.radius.pill,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.edgeHighlight,
          backgroundColor: theme.colors.glass,
        },
        clock: {
          fontSize: 12,
          lineHeight: 16,
          fontWeight: "600",
          color: theme.colors.textMuted,
        },
        contentCol: {
          flex: 1,
          gap: theme.spacing[6],
        },
        text: {
          fontSize: 14,
          lineHeight: 20,
          fontWeight: "700",
          color: theme.colors.textPrimary,
        },
        score: {
          fontSize: 12,
          lineHeight: 16,
          fontWeight: "700",
          color: theme.colors.textSecondary,
        },
      }),
    [theme],
  );

  return (
    <View style={styles.row}>
      <View style={styles.timeCol}>
        <Text style={styles.time}>{play.period}</Text>
        <Text style={styles.clock}>{play.clock}</Text>
      </View>
      <View style={styles.contentCol}>
        <Text style={styles.text}>{play.text}</Text>
        <Text style={styles.score}>
          {play.awayScore} - {play.homeScore}
        </Text>
      </View>
    </View>
  );
}
