import FontAwesome from "@expo/vector-icons/FontAwesome";
import { memo, useMemo } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { SkeletonText } from "@/components/loading/SkeletonPrimitives";
import MiniCourtView from "@/components/multiview/MiniCourtView";
import BaseballLiveStatePill from "@/components/ui/BaseballLiveStatePill";
import {
  MULTI_VIEW_LAYOUT,
  type MultiViewDensity,
  type MultiViewTileRect,
} from "@/src/multiview/layoutConstants";
import type { MultiViewLiveGameState } from "@/src/multiview/useMultiViewLiveGames";
import { effects } from "@/src/theme/effects";
import type { ThemeTokens } from "@/src/theme/tokens";
import { useAppTheme } from "@/src/theme/useAppTheme";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

type MultiViewTileProps = {
  gameId: string;
  game: MultiViewLiveGameState;
  rect: MultiViewTileRect;
  density: MultiViewDensity;
  onOpen: () => void;
  onRemove: () => void;
};

function toTeamAbbreviation(value: string | undefined): string {
  const cleaned = (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!cleaned) {
    return "TEAM";
  }
  return cleaned.slice(0, 4);
}

function toStatusLine(game: MultiViewLiveGameState["data"]): string {
  const status = game.statusText.trim();
  const state = status.toLowerCase();
  if (state.includes("final")) {
    return "FINAL";
  }
  if (status.length > 0 && status.length <= 14) {
    return status.toUpperCase();
  }
  const clock = game.clock.trim();
  if (clock.length > 0 && game.period > 0) {
    return `${clock} P${game.period}`.toUpperCase();
  }
  if (clock.length > 0) {
    return clock.toUpperCase();
  }
  return status.length > 0 ? status.toUpperCase() : "LIVE";
}

function makeStyles(theme: ThemeTokens, density: MultiViewDensity) {
  const logoSize = density === "full" ? 22 : density === "medium" ? 20 : 18;
  const scoreSize = density === "full" ? 20 : density === "medium" ? 18 : 16;
  const teamTextSize = density === "compact" ? 11 : 12;
  const statusSize = density === "compact" ? 10 : 11;
  const headerHorizontalPadding = density === "compact" ? 8 : 10;
  const statusBottomOffset = density === "compact" ? 4 : 8;

  return StyleSheet.create({
    tileWrap: {
      position: "absolute",
      borderRadius: MULTI_VIEW_LAYOUT.tileRadius,
      borderWidth: MULTI_VIEW_LAYOUT.tileBorderWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      overflow: "hidden",
      ...effects.card,
    },
    pressable: {
      flex: 1,
    },
    pressed: {
      opacity: 0.95,
      transform: [{ scale: 0.996 }],
    },
    header: {
      height: MULTI_VIEW_LAYOUT.tileHeaderHeight,
      borderBottomWidth: theme.borderWidth.hairline,
      borderBottomColor: theme.colors.borderSoft,
      paddingLeft: headerHorizontalPadding,
      paddingRight: headerHorizontalPadding + 34,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 6,
    },
    side: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      width: "36%",
      minWidth: 0,
    },
    sideRight: {
      justifyContent: "flex-end",
    },
    logo: {
      width: logoSize,
      height: logoSize,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
    },
    teamCode: {
      fontSize: teamTextSize,
      lineHeight: teamTextSize + 2,
      fontWeight: "800",
      color: theme.colors.textSecondary,
      minWidth: 20,
      textAlign: "center",
    },
    score: {
      fontSize: scoreSize,
      lineHeight: scoreSize + 2,
      fontWeight: "900",
      color: theme.colors.textPrimary,
      minWidth: 16,
      textAlign: "center",
    },
    statusWrap: {
      flex: 1,
      minWidth: 0,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 2,
    },
    status: {
      fontSize: statusSize,
      lineHeight: statusSize + 2,
      fontWeight: "800",
      color: theme.colors.textMuted,
      letterSpacing: 0.2,
      textAlign: "center",
    },
    removeButton: {
      position: "absolute",
      top: 4,
      right: 4,
      width: 36,
      height: 36,
      borderRadius: theme.radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    courtRegion: {
      flex: 1,
      minHeight: 0,
      justifyContent: "center",
      alignItems: "center",
      padding: density === "compact" ? 6 : 8,
    },
    courtFill: {
      width: "100%",
      height: "100%",
    },
    baseballState: {
      position: "absolute",
      left: 8,
      right: 8,
      bottom: statusBottomOffset,
    },
    courtSkeleton: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: "center",
      alignItems: "center",
      gap: 8,
      backgroundColor: "rgba(8, 14, 24, 0.08)",
      paddingHorizontal: 12,
    },
    loadingText: {
      fontSize: 10,
      lineHeight: 12,
      fontWeight: "700",
      color: theme.colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.2,
    },
    errorBadge: {
      position: "absolute",
      bottom: 6,
      right: 8,
      maxWidth: "62%",
      borderRadius: 999,
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: theme.borderWidth.hairline,
      borderColor: theme.colors.borderSoft,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    errorText: {
      fontSize: 9,
      lineHeight: 11,
      fontWeight: "700",
      color: theme.colors.danger,
    },
    skeletonLine: {
      borderRadius: 999,
    },
    skeletonLineWide: {
      borderRadius: 999,
    },
  });
}

function MultiViewTileImpl({
  gameId,
  game,
  rect,
  density,
  onOpen,
  onRemove,
}: MultiViewTileProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () => makeStyles(theme, density),
    [density, theme],
  );
  const skeletonHeight = Math.max(10, Math.min(16, Math.floor(rect.height * 0.05)));
  const { data } = game;
  const isBaseball = data.sport === "baseball";
  const awayCode = toTeamAbbreviation(data.away.abbreviation || data.away.name);
  const homeCode = toTeamAbbreviation(data.home.abbreviation || data.home.name);
  const statusLine = toStatusLine(data);

  return (
    <View
      testID={`multiview-tile-${gameId}`}
      style={[
        styles.tileWrap,
        {
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
        },
      ]}
    >
      <Pressable
        style={({ pressed }) => [styles.pressable, pressed ? styles.pressed : null]}
        onPress={onOpen}
      >
        <View style={styles.header}>
          <View style={styles.side}>
            <Image source={{ uri: data.away.logo || FALLBACK_IMAGE_URI }} style={styles.logo} />
            <Text style={styles.teamCode} numberOfLines={1}>
              {awayCode}
            </Text>
            <Text style={styles.score} numberOfLines={1}>
              {data.away.score}
            </Text>
          </View>

          <View style={styles.statusWrap}>
            <Text style={styles.status} numberOfLines={1}>
              {statusLine}
            </Text>
          </View>

          <View style={[styles.side, styles.sideRight]}>
            <Text style={styles.score} numberOfLines={1}>
              {data.home.score}
            </Text>
            <Text style={styles.teamCode} numberOfLines={1}>
              {homeCode}
            </Text>
            <Image source={{ uri: data.home.logo || FALLBACK_IMAGE_URI }} style={styles.logo} />
          </View>

          <Pressable
            style={styles.removeButton}
            hitSlop={4}
            onPress={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            <FontAwesome name="close" size={12} color={theme.colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.courtRegion}>
          <MiniCourtView sport={data.sport} density={density} style={styles.courtFill} />

          {isBaseball && density !== "compact" && data.baseballState ? (
            <View pointerEvents="none" style={styles.baseballState}>
              <BaseballLiveStatePill situation={data.baseballState} compact />
            </View>
          ) : null}

          {game.isLoading ? (
            <View pointerEvents="none" style={styles.courtSkeleton}>
              <SkeletonText width="64%" height={skeletonHeight} style={styles.skeletonLine} />
              <SkeletonText width="84%" height={skeletonHeight} style={styles.skeletonLineWide} />
              <Text style={styles.loadingText}>Loading</Text>
            </View>
          ) : null}

          {game.error ? (
            <View pointerEvents="none" style={styles.errorBadge}>
              <Text style={styles.errorText} numberOfLines={1}>
                Live delay
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const MultiViewTile = memo(MultiViewTileImpl);

export default MultiViewTile;
