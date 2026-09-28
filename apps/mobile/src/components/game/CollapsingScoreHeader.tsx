import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Image, StyleSheet, Text, View } from "react-native";
import Animated, { type AnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { appTheme } from "@/apps/mobile/src/design/theme";
import { tokens } from "@/apps/mobile/src/design/tokens";
import GlassIconButton from "@/apps/mobile/src/ui/GlassIconButton";
import { colors } from "@/theme/colors";

type TeamHeaderData = {
  name: string;
  logoUrl?: string | null;
  score?: string | number | null;
};

type CollapsingScoreHeaderProps = {
  homeTeam: TeamHeaderData;
  awayTeam: TeamHeaderData;
  statusText: string;
  onBackPress?: () => void;
  onMenuPress?: () => void;
  animatedContainerStyle: AnimatedStyle<any>;
  expandedContentStyle: AnimatedStyle<any>;
  compactContentStyle: AnimatedStyle<any>;
};

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function asScore(value: string | number | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${Math.round(value)}`;
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return "-";
}

export default function CollapsingScoreHeader({
  homeTeam,
  awayTeam,
  statusText,
  onBackPress,
  onMenuPress,
  animatedContainerStyle,
  expandedContentStyle,
  compactContentStyle,
}: CollapsingScoreHeaderProps) {
  const insets = useSafeAreaInsets();
  const compactHeight = insets.top + 56;
  const expandedHeight = insets.top + 132;

  return (
    <Animated.View style={[styles.wrap, animatedContainerStyle]} pointerEvents="box-none">
      <View style={styles.bg} />
      <View style={[styles.controlsRow, { top: insets.top + 6 }]}>
        {onBackPress ? (
          <GlassIconButton
            accessibilityLabel="Back"
            onPress={onBackPress}
            icon={<FontAwesome name="chevron-left" size={14} color={appTheme.textPrimary} />}
          />
        ) : (
          <View style={styles.controlSpacer} />
        )}
        {onMenuPress ? (
          <GlassIconButton
            accessibilityLabel="Menu"
            onPress={onMenuPress}
            icon={<FontAwesome name="ellipsis-h" size={14} color={appTheme.textPrimary} />}
          />
        ) : (
          <View style={styles.controlSpacer} />
        )}
      </View>

      <Animated.View style={[styles.expandedContent, { height: expandedHeight }, expandedContentStyle]} pointerEvents="none">
        <View style={styles.expandedRow}>
          <View style={styles.teamCol}>
            <Image source={{ uri: awayTeam.logoUrl || FALLBACK_IMAGE_URI }} style={styles.logoExpanded} />
            <Text style={styles.teamName} numberOfLines={1}>{awayTeam.name}</Text>
          </View>
          <View style={styles.centerCol}>
            <Text style={styles.bigScore}>{asScore(awayTeam.score)} - {asScore(homeTeam.score)}</Text>
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
          <View style={styles.teamCol}>
            <Image source={{ uri: homeTeam.logoUrl || FALLBACK_IMAGE_URI }} style={styles.logoExpanded} />
            <Text style={styles.teamName} numberOfLines={1}>{homeTeam.name}</Text>
          </View>
        </View>
      </Animated.View>

      <Animated.View style={[styles.compactContent, { height: compactHeight }, compactContentStyle]} pointerEvents="none">
        <View style={styles.compactRow}>
          <Image source={{ uri: awayTeam.logoUrl || FALLBACK_IMAGE_URI }} style={styles.logoCompact} />
          <Text style={styles.compactScore}>{asScore(awayTeam.score)} - {asScore(homeTeam.score)}</Text>
          <Image source={{ uri: homeTeam.logoUrl || FALLBACK_IMAGE_URI }} style={styles.logoCompact} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    zIndex: 40,
    elevation: 40,
    overflow: "hidden",
  },
  bg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
  },
  controlsRow: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  controlSpacer: {
    width: tokens.minTap,
    height: tokens.minTap,
  },
  expandedContent: {
    justifyContent: "flex-end",
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  expandedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  teamCol: {
    width: "28%",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  centerCol: {
    width: "44%",
    alignItems: "center",
    justifyContent: "center",
  },
  logoExpanded: {
    width: 32,
    height: 32,
    borderRadius: 999,
  },
  teamName: {
    color: appTheme.textMuted,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  bigScore: {
    color: appTheme.textPrimary,
    fontSize: 24,
    fontWeight: "700",
  },
  statusText: {
    marginTop: 2,
    color: appTheme.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  compactContent: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    justifyContent: "flex-end",
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  compactRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  logoCompact: {
    width: 20,
    height: 20,
    borderRadius: 999,
  },
  compactScore: {
    color: appTheme.textPrimary,
    fontSize: 18,
    fontWeight: "700",
  },
});
