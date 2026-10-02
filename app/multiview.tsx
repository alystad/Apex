import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useMemo } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import MultiViewGrid from "@/components/multiview/MultiViewGrid";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import TabBar from "@/components/ui/TabBar";
import { useLiveGame } from "@/hooks/useLiveGame";
import { useGameMode } from "@/src/mode/GameModeContext";
import { MULTI_VIEW_LAYOUT } from "@/src/multiview/layoutConstants";
import { useMultiView, MAX_MULTI_VIEW_GAMES } from "@/src/multiview/MultiViewContext";
import { buildSportsSectionTabItems } from "@/src/multiview/sportSectionTabs";
import { useMultiViewLiveGames } from "@/src/multiview/useMultiViewLiveGames";
import type { ThemeTokens } from "@/src/theme/tokens";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { AppScreen } from "@/src/ui/components";

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    screen: {
      flex: 1,
    },
    content: {
      flex: 1,
      minHeight: 0,
      paddingHorizontal: MULTI_VIEW_LAYOUT.screenPadding,
    },
    headerArea: {
      paddingTop: theme.spacing[6],
      gap: theme.spacing[8],
    },
    iconRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[8],
    },
    iconBtn: {
      width: 32,
      height: 32,
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    summaryBadge: {
      minWidth: 60,
      height: 30,
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.accentStrong,
      backgroundColor: theme.colors.chip,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spacing[8],
    },
    summaryBadgeText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "800",
      color: theme.colors.accentStrong,
    },
    body: {
      flex: 1,
      minHeight: 0,
      gap: theme.spacing[10],
    },
    emptyCard: {
      gap: theme.spacing[10],
      alignItems: "flex-start",
      borderRadius: MULTI_VIEW_LAYOUT.tileRadius,
    },
    emptyTitle: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    emptyText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textMuted,
    },
    emptyButton: {
      minHeight: 36,
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spacing[12],
    },
    emptyButtonText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
    gridWrap: {
      flex: 1,
      minHeight: 0,
    },
  });
}

export default function MultiViewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setMode } = useGameMode();
  const { proLeague, setGameId } = useLiveGame();
  const multiviewInGameRoute = "/(tabs)/live" as const;
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const {
    games,
    removeGameFromMultiView,
    setLastEntrySource,
  } = useMultiView();
  const { entries } = useMultiViewLiveGames(games);

  const modeTabItems = useMemo(
    () =>
      buildSportsSectionTabItems({
        proLeague,
        onSelectMode: (nextMode) => {
          setMode(nextMode);
          setLastEntrySource("normal");
          router.replace("/live-games");
        },
        onOpenMultiView: () => {},
      }),
    [proLeague, router, setLastEntrySource, setMode],
  );

  const orderedGames = useMemo(
    () =>
      games
        .map((selection) => entries[selection.key])
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    [entries, games],
  );

  return (
    <AppScreen
      style={styles.screen}
      edges={["top", "left", "right", "bottom"]}
      scroll={false}
      padded={false}
    >
      <View
        style={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, MULTI_VIEW_LAYOUT.screenPadding) },
        ]}
      >
        <View style={styles.headerArea}>
          <SectionHeader
            title="MultiView"
            subtitle="Track up to four games side-by-side."
            right={
              <View style={styles.iconRow}>
                <View style={styles.summaryBadge}>
                  <Text style={styles.summaryBadgeText}>
                    {games.length}/{MAX_MULTI_VIEW_GAMES}
                  </Text>
                </View>
                <Pressable
                  style={styles.iconBtn}
                  onPress={() => router.push("/settings")}
                >
                  <FontAwesome
                    name="gear"
                    size={16}
                    color={theme.colors.textSecondary}
                  />
                </Pressable>
              </View>
            }
          />

          <TabBar items={modeTabItems} activeKey="multiview" variant="flat" />
        </View>

        <View style={styles.body}>
          {games.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No games in MultiView yet</Text>
              <Text style={styles.emptyText}>
                Open any game and use the top-right menu to add it.
              </Text>
              <Pressable
                style={styles.emptyButton}
                onPress={() => {
                  setLastEntrySource("normal");
                  router.replace("/live-games");
                }}
              >
                <Text style={styles.emptyButtonText}>Browse Games</Text>
              </Pressable>
            </Card>
          ) : null}

          {games.length > 0 && orderedGames.length > 0 ? (
            <View style={styles.gridWrap}>
              <MultiViewGrid
                games={orderedGames}
                onOpenGame={(entry) => {
                  setLastEntrySource("multiview");
                  setMode(entry.data.mode);
                  setGameId(entry.data.gameId, entry.data.mode);
                  router.push({
                    pathname: multiviewInGameRoute,
                    params: {
                      gameId: entry.data.gameId,
                      mode: entry.data.mode,
                      from: "multiview",
                    },
                  } as never);
                }}
                onRemoveGame={(entry) => {
                  Alert.alert(
                    "Remove from MultiView?",
                    "This game will be removed from your MultiView grid.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Remove",
                        style: "destructive",
                        onPress: () => {
                          removeGameFromMultiView(entry.data.gameId, entry.data.mode);
                        },
                      },
                    ],
                  );
                }}
              />
            </View>
          ) : null}
        </View>
      </View>
    </AppScreen>
  );
}
