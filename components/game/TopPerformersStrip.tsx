import { useMemo } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { buildKeyStatLine } from "@/components/game/KingOfCourtCard";
import Card from "@/components/ui/Card";
import FireRingGlow, { isPlayerOnFire } from "@/components/ui/FireRingGlow";
import SectionHeader from "@/components/ui/SectionHeader";
import type { LiveGameData, LiveGamePlayer } from "@/hooks/useLiveGame";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { useInGamePlayerModal } from "@/src/ui/inGamePlayerModalContext";

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const PERFORMER_PHOTO = 48;
const DEFAULT_COUNT = 4;

function normalizeHexColor(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const normalized = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : fallback;
}

/**
 * Top performers across BOTH teams, ranked by rating with points as the
 * tiebreak. Works identically for a finished game and a live one — the only
 * difference is that the underlying player stats are still moving.
 */
export function selectTopPerformers(
  data: LiveGameData | null,
  count: number = DEFAULT_COUNT,
): LiveGamePlayer[] {
  if (!data) {
    return [];
  }
  return Object.values(data.playersByTeam ?? {})
    .flat()
    .filter((player) => typeof player.inGameRating10 === "number" && !player.didNotPlay)
    .sort((left, right) => {
      const ratingDiff = (right.inGameRating10 ?? 0) - (left.inGameRating10 ?? 0);
      return ratingDiff !== 0 ? ratingDiff : (right.points ?? 0) - (left.points ?? 0);
    })
    .slice(0, count);
}

export type TopPerformersStripProps = {
  players: LiveGamePlayer[];
  /** Used only to resolve each player's team color for the photo ring. */
  data: LiveGameData;
  /** "Top Performers" when final, "Top Performers So Far" while live. */
  title?: string;
};

/**
 * Horizontal strip of player cards (photo, key stat line, rating), shared by
 * the Recap and Live states of the story tab. Tapping a card opens that
 * player's detail modal.
 */
export default function TopPerformersStrip({
  players,
  data,
  title = "Top Performers",
}: TopPerformersStripProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { openPlayerModal } = useInGamePlayerModal();

  if (players.length === 0) {
    return null;
  }

  return (
    <Card>
      <SectionHeader title={title} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {players.map((player) => {
          const teamColor = normalizeHexColor(
            data.teams?.find((team) => team.id === player.teamId)?.color,
            theme.colors.accent,
          );
          return (
            <Pressable
              key={player.id}
              accessibilityRole="button"
              accessibilityLabel={`${player.name}, open player details`}
              onPress={() => openPlayerModal(player)}
              style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
            >
              <View style={styles.photoWrap}>
                <FireRingGlow
                  active={isPlayerOnFire(player)}
                  photoDiameter={PERFORMER_PHOTO}
                  debugLabel="fire-ring:top-performers-strip"
                />
                <Image
                  source={{ uri: player.headshot || FALLBACK_IMAGE_URI }}
                  style={[styles.photo, { borderColor: teamColor }]}
                />
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {player.shortName || player.name}
              </Text>
              <Text style={styles.stat} numberOfLines={1}>
                {buildKeyStatLine(player)}
              </Text>
              {typeof player.inGameRating10 === "number" ? (
                <Text style={styles.rating}>{player.inGameRating10.toFixed(1)}</Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </Card>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    strip: {
      marginTop: theme.spacing[10],
      gap: theme.spacing[10],
      paddingRight: theme.spacing[4],
    },
    card: {
      width: 104,
      alignItems: "center",
      gap: theme.spacing[4],
      paddingVertical: theme.spacing[10],
      paddingHorizontal: theme.spacing[8],
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
    },
    pressed: {
      opacity: 0.85,
    },
    photoWrap: {
      position: "relative",
      width: PERFORMER_PHOTO,
      height: PERFORMER_PHOTO,
      alignItems: "center",
      justifyContent: "center",
    },
    photo: {
      width: PERFORMER_PHOTO,
      height: PERFORMER_PHOTO,
      borderRadius: PERFORMER_PHOTO / 2,
      borderWidth: 2,
      backgroundColor: theme.colors.bg,
      zIndex: 2,
    },
    name: {
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "800",
      color: theme.colors.textPrimary,
      textAlign: "center",
    },
    stat: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "600",
      color: theme.colors.textMuted,
      textAlign: "center",
    },
    rating: {
      marginTop: theme.spacing[2],
      fontSize: 15,
      lineHeight: 19,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
  });
}
