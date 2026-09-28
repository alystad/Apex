import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import type { TeamGame } from "@/src/features/cbb/teamApi";
import {
  deriveHomeAway,
  formatGameDate,
  formatGameTime,
} from "@/src/features/cbb/teamSchedule";
import { useAppTheme } from "@/src/theme/useAppTheme";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

type UpcomingGameCardProps = {
  game: TeamGame;
  teamId: string;
  onPress: (gameId: string) => void;
};

export default function UpcomingGameCard({
  game,
  teamId,
  onPress,
}: UpcomingGameCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          borderRadius: theme.radius.md,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.surfaceAlt,
          paddingHorizontal: theme.spacing[12],
          paddingVertical: theme.spacing[12],
          gap: theme.spacing[8],
        },
        topRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: theme.spacing[8],
        },
        opponentWrap: {
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing[10],
          flex: 1,
          minWidth: 0,
        },
        logo: {
          width: 28,
          height: 28,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.surface,
        },
        opponentTextWrap: {
          flex: 1,
          minWidth: 0,
          gap: theme.spacing[2],
        },
        opponentName: {
          fontSize: 15,
          lineHeight: 20,
          fontWeight: "800",
          color: theme.colors.textPrimary,
        },
        subline: {
          fontSize: 12,
          lineHeight: 16,
          fontWeight: "700",
          color: theme.colors.textSecondary,
        },
        badge: {
          minHeight: 24,
          paddingHorizontal: theme.spacing[10],
          borderRadius: theme.radius.pill,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          alignItems: "center",
          justifyContent: "center",
        },
        badgeText: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "800",
          color: theme.colors.textMuted,
        },
        metaRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: theme.spacing[8],
        },
        meta: {
          fontSize: 12,
          lineHeight: 16,
          fontWeight: "700",
          color: theme.colors.textSecondary,
        },
        pressed: {
          opacity: 0.85,
        },
      }),
    [theme],
  );

  const venue = deriveHomeAway(game, teamId);

  return (
    <Pressable
      onPress={() => onPress(game.gameId)}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={styles.topRow}>
        <View style={styles.opponentWrap}>
          <Image
            source={{ uri: game.opponentLogo || FALLBACK_IMAGE_URI }}
            style={styles.logo}
          />
          <View style={styles.opponentTextWrap}>
            <Text style={styles.opponentName} numberOfLines={1}>
              {game.opponent}
            </Text>
            <Text style={styles.subline}>
              {venue.matchupPrefix} {game.opponent}
            </Text>
          </View>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{venue.label}</Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>{formatGameDate(game)}</Text>
        <Text style={styles.meta}>{formatGameTime(game)}</Text>
      </View>
    </Pressable>
  );
}
