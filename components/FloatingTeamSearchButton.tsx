import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { GlassView } from "expo-glass-effect";
import { router } from "expo-router";
import { useMemo } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import GlassPillButton from "@/components/GlassPillButton";
import { useLiveGame } from "@/hooks/useLiveGame";
import { getProBasketballLeagueConfig } from "@/src/features/nba/proBasketballLeague";
import { useGameModeActions } from "@/src/mode/GameModeContext";
import type { GameMode } from "@/src/mode/gameModeTypes";
import { useAppTheme } from "@/src/theme/useAppTheme";

type FloatingTeamSearchButtonProps = {
  onPress: () => void;
  bottomOffset?: number;
  rightOffset?: number;
  activeMode?: GameMode | null;
  favoritesSelected?: boolean;
  showCompanion?: boolean;
  primaryIcon?: "search" | "comments";
  accessibilityLabel?: string;
};

export default function FloatingTeamSearchButton({
  onPress,
  bottomOffset,
  rightOffset,
  activeMode = null,
  favoritesSelected = false,
  showCompanion = true,
  primaryIcon = "search",
  accessibilityLabel = primaryIcon === "comments" ? "Open comments" : "Search teams",
}: FloatingTeamSearchButtonProps) {
  const { tokens: theme } = useAppTheme();
  const { setMode } = useGameModeActions();
  const { proLeague } = useLiveGame();
  const searchButtonSize = 60;
  const companionPillHeight = 60;
  const companionGap = theme.spacing[10];
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          ...StyleSheet.absoluteFillObject,
          zIndex: 20,
          elevation: 20,
        },
        companionPill: {
          position: "absolute",
          zIndex: 20,
          height: companionPillHeight,
          borderRadius: 999,
          shadowColor: "#000000",
          shadowOpacity: 0.16,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 7 },
          elevation: 12,
        },
        glassMask: {
          ...StyleSheet.absoluteFillObject,
          borderRadius: 999,
          overflow: "hidden",
        },
        glass: {
          ...StyleSheet.absoluteFillObject,
          borderRadius: 999,
          overflow: "hidden",
        },
        fallbackGlass: {
          ...StyleSheet.absoluteFillObject,
          borderRadius: 999,
          backgroundColor: "rgba(255,255,255,0.14)",
          borderWidth: theme.borderWidth.normal,
          borderColor: "rgba(255,255,255,0.12)",
        },
        iconRow: {
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: theme.spacing[8],
        },
        iconSlot: {
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: theme.spacing[4],
        },
        iconButton: {
          width: 32,
          height: 28,
          alignItems: "center",
          justifyContent: "center",
        },
        iconLabel: {
          fontSize: 10,
          lineHeight: 12,
          fontWeight: "600",
          color: "#FFFFFF",
          textAlign: "center",
        },
        button: {
          position: "absolute",
          zIndex: 21,
          shadowColor: "#000000",
          shadowOpacity: 0.28,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
          elevation: 24,
        },
      }),
    [companionPillHeight, theme],
  );
  const resolvedBottomOffset = bottomOffset ?? theme.spacing[12];
  const resolvedRightOffset = rightOffset ?? theme.spacing[24];
  const companionBottomOffset =
    resolvedBottomOffset + (searchButtonSize - companionPillHeight) / 2;
  const companionIcons = [
    { icon: "football", label: "Football", mode: "college" as const, solid: false },
    { icon: "basketball", label: getProBasketballLeagueConfig(proLeague).label, mode: "nba" as const, solid: false },
    { icon: "baseball", label: "Baseball", mode: "baseball" as const, solid: false },
    { icon: "star", label: "Favorites", mode: null, solid: true },
  ] as const;
  const iconColors = {
    college: "#8B4A2F",
    nba: "#F28C28",
    baseball: "#E14B4B",
    favorites: "#F5C542",
    default: "#FFFFFF",
  } as const;

  const openLiveGamesSport = (nextMode: GameMode) => {
    setMode(nextMode);
    router.replace({
      pathname: "/live-games",
      params: {
        mode: nextMode,
        favorites: "0",
        navToken: String(Date.now()),
      },
    });
  };

  const openLiveGamesFavorites = () => {
    router.replace({
      pathname: "/live-games",
      params: {
        favorites: "1",
        navToken: String(Date.now()),
      },
    });
  };

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      {showCompanion ? (
        <View
          style={[
            styles.companionPill,
            {
              left: theme.spacing[16],
              right: resolvedRightOffset + searchButtonSize + companionGap,
              bottom: companionBottomOffset,
            },
          ]}
        >
          {Platform.OS === "ios" ? (
            <View pointerEvents="none" style={styles.glassMask}>
              <GlassView
                glassEffectStyle="regular"
                colorScheme="dark"
                isInteractive
                style={styles.glass}
              />
            </View>
          ) : (
            <View pointerEvents="none" style={styles.fallbackGlass} />
          )}
          <View style={styles.iconRow}>
            {companionIcons.map(({ icon, label, mode, solid }) => {
              const isSelected = mode
                ? !favoritesSelected && activeMode === mode
                : favoritesSelected;
              const iconColor = mode
                ? isSelected
                  ? iconColors[mode]
                  : iconColors.default
                : isSelected
                  ? iconColors.favorites
                  : iconColors.default;

              return (
                <View key={icon} style={styles.iconSlot}>
                  <Pressable
                    onPress={() => {
                      if (mode) {
                        openLiveGamesSport(mode);
                        return;
                      }
                      openLiveGamesFavorites();
                    }}
                    style={styles.iconButton}
                  >
                    <FontAwesome6
                      name={icon}
                      size={22}
                      color={iconColor}
                      solid={solid}
                    />
                  </Pressable>
                  <Text style={styles.iconLabel}>{label}</Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
      <GlassPillButton
        icon={primaryIcon === "search" ? "search" : undefined}
        shape="circle"
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={[
          styles.button,
          {
            bottom: resolvedBottomOffset,
            right: resolvedRightOffset,
          },
        ]}
      >
        {primaryIcon === "comments" ? (
          <FontAwesome6 name="comment-dots" size={25} color={theme.colors.textPrimary} />
        ) : null}
      </GlassPillButton>
    </View>
  );
}
