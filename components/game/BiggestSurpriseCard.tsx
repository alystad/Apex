import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import type { LiveGamePlayer } from "@/hooks/useLiveGame";
import type { SurprisePerformance } from "@/src/features/recap/recapStats";
import { useAppTheme } from "@/src/theme/useAppTheme";

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const PHOTO_DIAMETER = 40;

export type BiggestSurpriseCardProps = {
  entries: SurprisePerformance[];
  onPlayerPress: (player: LiveGamePlayer) => void;
};

/**
 * "Another thing your model knows": the game's biggest overperformer and
 * underperformer relative to their OWN season rating — a deterministic
 * computation (computeBiggestSurprise), not AI prose, so it sits alongside
 * Biggest Moments/Notable Performances rather than the AI recap block above.
 */
export default function BiggestSurpriseCard({ entries, onPlayerPress }: BiggestSurpriseCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (entries.length === 0) {
    return null;
  }

  return (
    <Card>
      <SectionHeader title="Biggest Surprise" />
      <View style={styles.rowList}>
        {entries.map((entry) => {
          const isOver = entry.kind === "overperformer";
          return (
            <Pressable
              key={entry.player.id}
              accessibilityRole="button"
              accessibilityLabel={`${isOver ? "Biggest overperformer" : "Biggest underperformer"}: ${entry.detail}`}
              onPress={() => onPlayerPress(entry.player)}
              style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
            >
              <Image
                source={{ uri: entry.player.headshot || FALLBACK_IMAGE_URI }}
                style={styles.photo}
              />
              <View style={styles.body}>
                <View style={styles.labelRow}>
                  <FontAwesome
                    name={isOver ? "arrow-up" : "arrow-down"}
                    size={10}
                    color={isOver ? theme.colors.success : theme.colors.danger}
                  />
                  <Text
                    style={[
                      styles.label,
                      { color: isOver ? theme.colors.success : theme.colors.danger },
                    ]}
                  >
                    {isOver ? "Overperformer" : "Underperformer"}
                  </Text>
                </View>
                <Text style={styles.detail} numberOfLines={2}>
                  {entry.detail}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    rowList: {
      marginTop: theme.spacing[10],
      gap: theme.spacing[10],
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
    },
    pressed: {
      opacity: 0.85,
    },
    photo: {
      width: PHOTO_DIAMETER,
      height: PHOTO_DIAMETER,
      borderRadius: PHOTO_DIAMETER / 2,
      backgroundColor: theme.colors.surfaceAlt,
    },
    body: {
      flex: 1,
      minWidth: 0,
      gap: theme.spacing[2],
    },
    labelRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[4],
    },
    label: {
      fontSize: 10,
      lineHeight: 13,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    detail: {
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "700",
      color: theme.colors.textPrimary,
    },
  });
}
