import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { PlayerProfileData } from "@/src/features/basketball/playerApi";
import { useAppTheme } from "@/src/theme/useAppTheme";
import {
  Animated,
  getStickyHeaderCollapsedHeight,
  getStickyHeaderHeight,
  STICKY_HEADER_DEFAULT_COLLAPSE_RANGE,
  STICKY_HEADER_EXPANDED_BOTTOM_PADDING,
  STICKY_HEADER_TOP_PADDING,
  useStickyHeaderMotion,
} from "@/src/ui/stickyHeaderMotion";
import { getInGameRatingColor } from "@/theme/colors";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const PLAYER_HEADER_EXPANDED_SECTION_HEIGHT = 118;

export function getPlayerProfileHeaderExpandedHeight(insetTop: number): number {
  return getStickyHeaderHeight({
    insetTop,
    expandedSectionHeight: PLAYER_HEADER_EXPANDED_SECTION_HEIGHT,
    expandedBottomPadding: STICKY_HEADER_EXPANDED_BOTTOM_PADDING,
  });
}

export function getPlayerProfileHeaderCollapsedHeight(insetTop: number): number {
  return getStickyHeaderCollapsedHeight({
    insetTop,
  });
}

type PlayerProfileHeaderProps = {
  scrollY: SharedValue<number>;
  profile: PlayerProfileData;
  currentRating: number | null;
  seasonAverageRating: number | null;
  quickSummary: string;
  onBack: () => void;
  onOpenTeam?: () => void;
  onOpenGame?: () => void;
};

function formatRating(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(1);
}

export default function PlayerProfileHeader({
  scrollY,
  profile,
  currentRating,
  seasonAverageRating,
  quickSummary,
  onBack,
  onOpenTeam,
  onOpenGame,
}: PlayerProfileHeaderProps) {
  const { tokens: theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const expandedHeight = getPlayerProfileHeaderExpandedHeight(insets.top);
  const collapsedHeight = getPlayerProfileHeaderCollapsedHeight(insets.top);
  const ratingColor = getInGameRatingColor(currentRating);
  const seasonColor = getInGameRatingColor(seasonAverageRating);
  const {
    expandedStyle,
    compactStyle,
    headerHeightStyle,
    barStyle,
    bottomPaddingStyle,
  } = useStickyHeaderMotion({
    scrollY,
    expandedHeight,
    collapsedHeight,
    collapseRange: STICKY_HEADER_DEFAULT_COLLAPSE_RANGE,
    expandedBottomPadding: STICKY_HEADER_EXPANDED_BOTTOM_PADDING,
  });

  const styles = StyleSheet.create({
    wrap: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 30,
      backgroundColor: theme.colors.bg,
      borderBottomWidth: theme.borderWidth.normal,
      borderBottomColor: theme.colors.border,
      paddingHorizontal: theme.spacing[12],
      overflow: "hidden",
    },
    navRow: {
      position: "relative",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      height: 48,
      marginBottom: 8,
    },
    iconBtn: {
      width: 38,
      height: 38,
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    iconSpacer: {
      width: 38,
      height: 38,
    },
    compactCenter: {
      position: "absolute",
      left: 46,
      right: 46,
      alignItems: "center",
      justifyContent: "center",
    },
    compactRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
      paddingHorizontal: theme.spacing[8],
    },
    compactAvatar: {
      width: 26,
      height: 26,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
    },
    compactCopy: {
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minWidth: 0,
    },
    compactName: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    compactMeta: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
    compactRating: {
      minWidth: 42,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing[8],
      paddingVertical: theme.spacing[4],
      alignItems: "center",
      justifyContent: "center",
    },
    compactRatingText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      color: "#08111d",
    },
    expanded: {
      minHeight: PLAYER_HEADER_EXPANDED_SECTION_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[12],
    },
    avatarWrap: {
      width: 84,
      alignItems: "center",
      justifyContent: "center",
    },
    heroAvatar: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: theme.colors.surfaceAlt,
    },
    copyWrap: {
      flex: 1,
      gap: theme.spacing[6],
      minWidth: 0,
    },
    name: {
      fontSize: 26,
      lineHeight: 30,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    metaLine: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      columnGap: theme.spacing[6],
      rowGap: theme.spacing[4],
    },
    metaText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
    teamRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[6],
      alignSelf: "flex-start",
    },
    teamLogo: {
      width: 18,
      height: 18,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
    },
    teamText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    quickSummary: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.accent,
    },
    ratingColumn: {
      width: 86,
      alignItems: "flex-end",
      gap: theme.spacing[8],
    },
    ratingPill: {
      minWidth: 76,
      borderRadius: 20,
      paddingHorizontal: theme.spacing[12],
      paddingVertical: theme.spacing[10],
      alignItems: "center",
      justifyContent: "center",
    },
    ratingValue: {
      fontSize: 24,
      lineHeight: 26,
      fontWeight: "800",
      color: "#08111d",
    },
    ratingLabel: {
      fontSize: 10,
      lineHeight: 12,
      fontWeight: "800",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      color: "#08111d",
    },
    seasonBadge: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing[10],
      paddingVertical: theme.spacing[4],
      backgroundColor: seasonColor,
    },
    seasonBadgeText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      color: "#08111d",
    },
  });

  return (
    <Animated.View
      style={[
        styles.wrap,
        barStyle,
        headerHeightStyle,
        bottomPaddingStyle,
        { paddingTop: insets.top + STICKY_HEADER_TOP_PADDING },
      ]}
    >
      <View style={styles.navRow}>
        <Pressable onPress={onBack} style={styles.iconBtn}>
          <FontAwesome
            name="chevron-left"
            size={14}
            color={theme.colors.textPrimary}
          />
        </Pressable>

        <Animated.View style={[styles.compactCenter, compactStyle]} pointerEvents="none">
          <View style={styles.compactRow}>
            <Image
              source={{ uri: profile.player.headshot || FALLBACK_IMAGE_URI }}
              style={styles.compactAvatar}
            />
            <View style={styles.compactCopy}>
              <Text numberOfLines={1} style={styles.compactName}>
                {profile.player.fullName}
              </Text>
              <Text numberOfLines={1} style={styles.compactMeta}>
                {profile.player.team.abbreviation} #{profile.player.jersey || "-"} {profile.player.position || "-"}
              </Text>
            </View>
            <View style={[styles.compactRating, { backgroundColor: ratingColor }]}>
              <Text style={styles.compactRatingText}>{formatRating(currentRating)}</Text>
            </View>
          </View>
        </Animated.View>

        <View style={{ flexDirection: "row", gap: theme.spacing[8] }}>
          {onOpenGame ? (
            <Pressable onPress={onOpenGame} style={styles.iconBtn}>
              <FontAwesome
                name="play-circle-o"
                size={16}
                color={theme.colors.textPrimary}
              />
            </Pressable>
          ) : (
            <View style={styles.iconSpacer} />
          )}
          {onOpenTeam ? (
            <Pressable onPress={onOpenTeam} style={styles.iconBtn}>
              <FontAwesome
                name="shield"
                size={14}
                color={theme.colors.textPrimary}
              />
            </Pressable>
          ) : (
            <View style={styles.iconSpacer} />
          )}
        </View>
      </View>

      <Animated.View style={[styles.expanded, expandedStyle]}>
        <View style={styles.avatarWrap}>
          <Image
            source={{ uri: profile.player.headshot || FALLBACK_IMAGE_URI }}
            style={styles.heroAvatar}
          />
        </View>
        <View style={styles.copyWrap}>
          <Text numberOfLines={2} style={styles.name}>
            {profile.player.fullName}
          </Text>
          <View style={styles.metaLine}>
            <Text style={styles.metaText}>#{profile.player.jersey || "-"}</Text>
            <Text style={styles.metaText}>{profile.player.position || "-"}</Text>
            {profile.player.experience ? (
              <Text style={styles.metaText}>{profile.player.experience}</Text>
            ) : null}
            {profile.player.displayHeight ? (
              <Text style={styles.metaText}>{profile.player.displayHeight}</Text>
            ) : null}
          </View>
          <Pressable
            disabled={!onOpenTeam}
            onPress={onOpenTeam}
            style={styles.teamRow}
          >
            <Image
              source={{ uri: profile.player.team.logo || FALLBACK_IMAGE_URI }}
              style={styles.teamLogo}
            />
            <Text style={styles.teamText}>
              {profile.player.team.name}
              {profile.player.team.record ? ` • ${profile.player.team.record}` : ""}
            </Text>
          </Pressable>
          <Text numberOfLines={1} style={styles.quickSummary}>
            {quickSummary}
          </Text>
        </View>
        <View style={styles.ratingColumn}>
          <View style={[styles.ratingPill, { backgroundColor: ratingColor }]}>
            <Text style={styles.ratingLabel}>Rating</Text>
            <Text style={styles.ratingValue}>{formatRating(currentRating)}</Text>
          </View>
          <View style={styles.seasonBadge}>
            <Text style={styles.seasonBadgeText}>
              Avg {formatRating(seasonAverageRating)}
            </Text>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}
