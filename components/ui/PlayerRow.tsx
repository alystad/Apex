import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import CrownPinBadge from "@/components/ui/CrownPinBadge";
import FireRingGlow, { isPlayerOnFire } from "@/components/ui/FireRingGlow";
import PlayerRatingGraph from "@/components/ui/PlayerRatingGraph";
import type { LiveGamePlayer } from "@/hooks/useLiveGame";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { getInGameRatingColor } from "@/theme/colors";

type PlayerRowProps = {
  player: LiveGamePlayer;
  teamColor?: string | null;
  teamPrimaryColor?: string | null;
  onPress?: (player: LiveGamePlayer) => void;
  dense?: boolean;
  isHighestRated?: boolean;
  showOutline?: boolean;
};

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

export default function PlayerRow({
  player,
  teamColor,
  teamPrimaryColor,
  onPress,
  dense = true,
  isHighestRated = false,
  showOutline = true,
}: PlayerRowProps) {
  const { tokens: theme, isDark } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          borderRadius: theme.radius.lg,
          borderWidth: showOutline ? theme.borderWidth.normal : 0,
          borderColor: showOutline ? theme.colors.borderSoft : "transparent",
          backgroundColor: theme.colors.surfaceAlt,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: theme.spacing[10],
        },
        rowDense: {
          minHeight: 68,
          paddingHorizontal: theme.spacing[12],
          paddingVertical: theme.spacing[10],
        },
        left: {
          flexDirection: "row",
          alignItems: "center",
          flex: 1,
          minWidth: 0,
          gap: theme.spacing[8],
        },
        avatar: {
          width: 40,
          height: 40,
          borderRadius: theme.radius.pill,
          ...StyleSheet.absoluteFillObject,
          zIndex: 2,
        },
        avatarClip: {
          width: 40,
          height: 40,
          borderRadius: theme.radius.pill,
          overflow: "hidden",
          backgroundColor: isDark ? "rgba(229, 235, 244, 0.16)" : "#d9e4f5",
        },
        avatarGlow: {
          ...StyleSheet.absoluteFillObject,
          opacity: isDark ? 0.52 : 0.46,
          tintColor: "#F4C542",
          transform: [{ scale: 1.12 }],
          zIndex: 1,
        },
        avatarRing: {
          width: 44.5,
          height: 44.5,
          borderRadius: 22.25,
          padding: 2.25,
          alignItems: "center",
          justifyContent: "center",
          // Explicit zIndex so the photo layers above FireRingGlow (zIndex 0)
          // on every platform now that a sibling in this stack sets one.
          zIndex: 2,
        },
        avatarStack: {
          position: "relative",
        },
        nameWrap: {
          flex: 1,
          minWidth: 0,
        },
        name: {
          fontSize: 14,
          lineHeight: 20,
          fontWeight: "700",
          color: theme.colors.textPrimary,
        },
        meta: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "700",
          letterSpacing: 0.2,
          color: theme.colors.textMuted,
        },
        right: {
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing[10],
        },
        ratingPill: {
          minWidth: 44,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.spacing[10],
          paddingVertical: theme.spacing[6],
          alignItems: "center",
        },
        ratingText: {
          fontSize: 12,
          lineHeight: 14,
          fontWeight: "800",
          letterSpacing: 0.2,
          color: "#08111d",
        },
        pressed: {
          opacity: theme.opacity.pressed,
        },
      }),
    [isDark, showOutline, theme],
  );
  const rating = player.inGameRating10;
  const headshotUri = player.headshot || FALLBACK_IMAGE_URI;
  const ratingText = typeof rating === "number" ? rating.toFixed(1) : "-";
  const normalizedTeamRingColor = useMemo(() => {
    if (!teamColor || typeof teamColor !== "string") {
      return theme.colors.borderSoft;
    }
    const normalized = teamColor.startsWith("#") ? teamColor : `#${teamColor}`;
    return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : theme.colors.borderSoft;
  }, [teamColor, theme.colors.borderSoft]);
  const normalizedTeamPrimaryColor = useMemo(() => {
    if (!teamPrimaryColor || typeof teamPrimaryColor !== "string") {
      return isDark ? "rgba(229, 235, 244, 0.16)" : "#d9e4f5";
    }
    const normalized = teamPrimaryColor.startsWith("#")
      ? teamPrimaryColor
      : `#${teamPrimaryColor}`;
    return /^#[0-9A-Fa-f]{6}$/.test(normalized)
      ? normalized
      : isDark
        ? "rgba(229, 235, 244, 0.16)"
        : "#d9e4f5";
  }, [isDark, teamPrimaryColor]);
  const metaText =
    player.sport === "baseball"
      ? player.baseball?.primaryLine ||
        `#${player.jersey || "-"} ${player.position || "-"}`
      : `#${player.jersey || "-"} ${player.position || "-"} | ${player.minutesDisplay} MIN`;

  return (
    <Pressable
      onPress={() => onPress?.(player)}
      style={({ pressed }) => [
        styles.row,
        dense ? styles.rowDense : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.left}>
        <View style={styles.avatarStack}>
          <FireRingGlow
            active={isPlayerOnFire(player)}
            photoDiameter={40}
            visualDiameter={44.5}
            debugLabel="fire-ring:boxscore-row"
          />
          {isHighestRated ? <CrownPinBadge photoDiameter={40} /> : null}
          <View style={[styles.avatarRing, { backgroundColor: normalizedTeamRingColor }]}>
            <View style={[styles.avatarClip, { backgroundColor: normalizedTeamPrimaryColor }]}>
              {isHighestRated ? (
                <Image source={{ uri: headshotUri }} style={styles.avatarGlow} blurRadius={6} />
              ) : null}
              <Image source={{ uri: headshotUri }} style={styles.avatar} />
            </View>
          </View>
        </View>
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
        <PlayerRatingGraph
          points={player.ratingTimelinePoints ?? []}
          showBaseline={false}
          showSubtleAreaFill
        />
        <View style={[styles.ratingPill, { backgroundColor: getInGameRatingColor(rating) }]}>
          <Text style={styles.ratingText}>{ratingText}</Text>
        </View>
      </View>
    </Pressable>
  );
}
