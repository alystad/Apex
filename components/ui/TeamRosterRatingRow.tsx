import { Image, StyleSheet, Text, View } from "react-native";

import PlayerRatingGraph from "@/components/ui/PlayerRatingGraph";
import type { TeamPlayerStats } from "@/src/features/cbb/teamApi";
import { tokens } from "@/src/theme/tokens";
import { typography } from "@/src/theme/typography";
import { getInGameRatingColor } from "@/theme/colors";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

type TeamRosterRatingRowProps = {
  player: TeamPlayerStats;
};

export default function TeamRosterRatingRow({ player }: TeamRosterRatingRowProps) {
  const rating = player.seasonRating10;
  const ratingText = typeof rating === "number" ? rating.toFixed(1) : "-";
  const metaText =
    player.sport === "baseball"
      ? player.baseball?.primaryLine || `${player.position || "-"} • ${player.games} G`
      : `#${player.jersey || "-"} ${player.position || "-"} • ${player.games} GP`;

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Image source={{ uri: player.headshot || FALLBACK_IMAGE_URI }} style={styles.avatar} />
        <View style={styles.nameWrap}>
          <Text numberOfLines={1} style={styles.name}>
            {player.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {metaText}
          </Text>
        </View>
      </View>

      <View style={styles.right}>
        <PlayerRatingGraph points={player.ratingTimelinePoints ?? []} />
        <View style={[styles.ratingPill, { backgroundColor: getInGameRatingColor(rating) }]}>
          <Text style={styles.ratingText}>{ratingText}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderRadius: tokens.radius.md,
    borderWidth: tokens.borderWidth.normal,
    borderColor: tokens.colors.borderSoft,
    backgroundColor: tokens.colors.surfaceAlt,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacing[8],
    minHeight: 64,
    paddingHorizontal: tokens.spacing[8],
    paddingVertical: tokens.spacing[8],
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    gap: tokens.spacing[8],
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: tokens.radius.pill,
    backgroundColor: "#dbe5f8",
  },
  nameWrap: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    ...typography.body,
    color: tokens.colors.textPrimary,
    fontWeight: "700",
  },
  meta: {
    ...typography.micro,
    color: tokens.colors.textMuted,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing[8],
  },
  ratingPill: {
    minWidth: 38,
    borderRadius: tokens.radius.pill,
    paddingHorizontal: tokens.spacing[8],
    paddingVertical: tokens.spacing[4],
    alignItems: "center",
  },
  ratingText: {
    ...typography.micro,
    color: "#08111d",
    fontWeight: "800",
  },
});
