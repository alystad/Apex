import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import FireRingGlow, { isPlayerOnFire } from "@/components/ui/FireRingGlow";
import TopPerformerCrown from "@/components/ui/TopPerformerCrown";
import type { LiveGamePlayer } from "@/hooks/useLiveGame";
import { useAppTheme } from "@/src/theme/useAppTheme";

type AppThemeTokens = ReturnType<typeof useAppTheme>["tokens"];

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const PHOTO_DIAMETER = 44;

/**
 * "Key stat line" for a finished game: points always leads, then the two
 * highest non-zero secondary stats. Mirrors the leaderboard's top-3-stats
 * convention (see buildRecentStatEntries in TopPlayerRow) so a player's line
 * reads the same wherever it appears.
 */
export function buildKeyStatLine(player: LiveGamePlayer): string {
  const secondary: Array<{ label: string; value: number }> = [
    { label: "reb", value: player.rebounds ?? 0 },
    { label: "ast", value: player.assists ?? 0 },
    { label: "stl", value: player.steals ?? 0 },
    { label: "blk", value: player.blocks ?? 0 },
  ];
  const top = secondary
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2);
  return [`${player.points ?? 0} pts`, ...top.map((entry) => `${entry.value} ${entry.label}`)].join(
    " · ",
  );
}

export type KingOfCourtCardProps = {
  player: LiveGamePlayer;
  /**
   * "banner" is the slim live-Court strip (crown + title + name·rating).
   * "detailed" adds the headshot and key stat line for the Recap tab.
   */
  variant?: "banner" | "detailed";
  /** Title above the name. Defaults to "King of the Court". */
  title?: string;
  onPress?: (player: LiveGamePlayer) => void;
};

/**
 * Top-rated player callout, shared by the live Court tab's banner and the
 * Recap tab's card so the crown treatment and gold styling stay identical.
 */
export default function KingOfCourtCard({
  player,
  variant = "banner",
  title = "King of the Court",
  onPress,
}: KingOfCourtCardProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const detailed = variant === "detailed";
  const ratingText =
    typeof player.inGameRating10 === "number" ? player.inGameRating10.toFixed(1) : null;

  const body = (
    <>
      {detailed ? (
        <View style={styles.photoWrap}>
          <FireRingGlow
            active={isPlayerOnFire(player)}
            photoDiameter={PHOTO_DIAMETER}
            debugLabel="fire-ring:king-of-court-card"
          />
          <Image
            source={{ uri: player.headshot || FALLBACK_IMAGE_URI }}
            style={styles.photo}
          />
        </View>
      ) : null}
      <TopPerformerCrown size={detailed ? 24 : 20} />
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.name} numberOfLines={1}>
          {player.shortName || player.name}
          {!detailed && ratingText ? ` · ${ratingText}` : ""}
        </Text>
        {detailed ? (
          <Text style={styles.statLine} numberOfLines={1}>
            {buildKeyStatLine(player)}
          </Text>
        ) : null}
      </View>
      {detailed && ratingText ? (
        <View style={styles.ratingPill}>
          <Text style={styles.ratingValue}>{ratingText}</Text>
        </View>
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={styles.banner}>{body}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${player.name}`}
      onPress={() => onPress(player)}
      style={({ pressed }) => [styles.banner, pressed ? styles.pressed : null]}
    >
      {body}
    </Pressable>
  );
}

function createStyles(theme: AppThemeTokens) {
  return StyleSheet.create({
    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[10],
      paddingHorizontal: theme.spacing[14],
      paddingVertical: theme.spacing[10],
      backgroundColor: "rgba(255,196,0,0.1)",
      borderRadius: theme.radius.md,
      borderWidth: theme.borderWidth.normal,
      borderColor: "rgba(255,196,0,0.35)",
    },
    pressed: {
      opacity: 0.85,
    },
    photoWrap: {
      position: "relative",
      width: PHOTO_DIAMETER,
      height: PHOTO_DIAMETER,
      alignItems: "center",
      justifyContent: "center",
    },
    photo: {
      width: PHOTO_DIAMETER,
      height: PHOTO_DIAMETER,
      borderRadius: PHOTO_DIAMETER / 2,
      backgroundColor: theme.colors.surfaceAlt,
      zIndex: 2,
    },
    content: {
      flex: 1,
      gap: theme.spacing[2],
      minWidth: 0,
    },
    title: {
      fontSize: 10,
      lineHeight: 13,
      fontWeight: "800",
      color: "rgba(255,196,0,0.9)",
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    name: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    statLine: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textMuted,
    },
    ratingPill: {
      minWidth: 40,
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[4],
      borderRadius: theme.radius.pill,
      backgroundColor: "rgba(255,196,0,0.9)",
      alignItems: "center",
      justifyContent: "center",
    },
    ratingValue: {
      fontSize: 15,
      lineHeight: 19,
      fontWeight: "800",
      color: "#0b1220",
    },
  });
}
