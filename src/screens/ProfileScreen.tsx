import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import AllTimeRecordCard from "@/components/profile/AllTimeRecordCard";
import PredictionHistoryItem from "@/components/profile/PredictionHistoryItem";
import ProfileHeaderCard from "@/components/profile/ProfileHeaderCard";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import TabBar, { type TabItem } from "@/components/ui/TabBar";
import { useProfile } from "@/src/profile/ProfileContext";
import { refreshPredictionSnapshots } from "@/src/profile/profileSync";
import {
  calculatePredictionInsights,
  calculatePredictionStats,
  sortPredictionsNewestFirst,
} from "@/src/profile/predictionStats";
import type { GamePrediction } from "@/src/profile/profileTypes";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { AppScreen } from "@/src/ui/components";

type HistoryFilter = "all" | "correct" | "incorrect" | "pending";

function makeStyles(theme: ReturnType<typeof useAppTheme>["tokens"]) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.bg,
    },
    content: {
      paddingHorizontal: theme.spacing[12],
      paddingTop: theme.spacing[8],
      paddingBottom: theme.spacing[24],
      gap: theme.spacing[10],
    },
    headerActions: {
      flexDirection: "row",
      gap: theme.spacing[8],
    },
    iconBtn: {
      width: 34,
      height: 34,
      borderRadius: theme.radius.pill,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    insightsGrid: {
      marginTop: theme.spacing[8],
      flexDirection: "row",
      gap: theme.spacing[8],
    },
    insightTile: {
      flex: 1,
      borderRadius: theme.radius.lg,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[12],
      paddingVertical: theme.spacing[12],
      gap: theme.spacing[4],
    },
    insightLabel: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
      letterSpacing: 0.2,
      textTransform: "uppercase",
      color: theme.colors.textMuted,
    },
    insightValue: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    accountCard: {
      gap: theme.spacing[8],
    },
    accountRow: {
      minHeight: 52,
      borderRadius: theme.radius.lg,
      borderWidth: theme.borderWidth.normal,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      paddingHorizontal: theme.spacing[12],
      paddingVertical: theme.spacing[10],
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[10],
    },
    accountCopy: {
      flex: 1,
      gap: theme.spacing[2],
    },
    accountLabel: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "800",
      color: theme.colors.textPrimary,
    },
    accountDetail: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
      color: theme.colors.textSecondary,
    },
    favoriteTeamLogo: {
      width: 34,
      height: 34,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surface,
    },
    historyHeader: {
      paddingTop: theme.spacing[2],
      gap: theme.spacing[10],
    },
    emptyText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      color: theme.colors.textSecondary,
    },
    historyListContent: {
      paddingBottom: theme.spacing[24],
      gap: theme.spacing[10],
    },
    spacer: {
      height: theme.spacing[10],
    },
  });
}

function filterPredictions(
  predictions: GamePrediction[],
  filter: HistoryFilter,
): GamePrediction[] {
  if (filter === "all") {
    return predictions;
  }
  return predictions.filter((prediction) => prediction.result === filter);
}

export default function ProfileScreen() {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
const styles = useMemo(() => makeStyles(theme), [theme]);
  const {
    state,
    setDisplayName,
    syncPredictionsFromSnapshots,
  } = useProfile();
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [syncing, setSyncing] = useState(false);

  const sortedPredictions = useMemo(
    () => sortPredictionsNewestFirst(state.predictions),
    [state.predictions],
  );
  const filteredPredictions = useMemo(
    () => filterPredictions(sortedPredictions, historyFilter),
    [historyFilter, sortedPredictions],
  );
  const predictionStats = useMemo(
    () => calculatePredictionStats(state.predictions),
    [state.predictions],
  );
  const predictionInsights = useMemo(
    () => calculatePredictionInsights(state.predictions),
    [state.predictions],
  );
  const favoriteTeam = state.profile.favoriteTeamTheme;

  const syncTargets = useMemo(
    () =>
      state.predictions.filter(
        (prediction) =>
          prediction.gameStatus !== "final" || prediction.result === "pending",
      ),
    [state.predictions],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const refreshResults = async () => {
        if (syncTargets.length === 0) {
          return;
        }
        setSyncing(true);
        try {
          const snapshots = await refreshPredictionSnapshots(syncTargets);
          if (active && snapshots.length > 0) {
            syncPredictionsFromSnapshots(snapshots);
          }
        } finally {
          if (active) {
            setSyncing(false);
          }
        }
      };

      void refreshResults();

      return () => {
        active = false;
      };
    }, [syncPredictionsFromSnapshots, syncTargets]),
  );

  const historyFilterItems = useMemo<TabItem[]>(
    () => [
      { key: "all", label: "All", onPress: () => setHistoryFilter("all") },
      {
        key: "correct",
        label: "Correct",
        onPress: () => setHistoryFilter("correct"),
      },
      {
        key: "incorrect",
        label: "Incorrect",
        onPress: () => setHistoryFilter("incorrect"),
      },
      {
        key: "pending",
        label: "Pending",
        onPress: () => setHistoryFilter("pending"),
      },
    ],
    [],
  );

  const header = (
    <View style={styles.content}>
      <SectionHeader
        title="Profile"
        subtitle="Track your picks, record, and app profile."
        right={
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push("/settings")}
              style={styles.iconBtn}
            >
              <FontAwesome
                name="gear"
                size={15}
                color={theme.colors.textSecondary}
              />
            </Pressable>
            <Pressable onPress={() => router.back()} style={styles.iconBtn}>
              <FontAwesome
                name="close"
                size={16}
                color={theme.colors.textSecondary}
              />
            </Pressable>
          </View>
        }
      />

      <ProfileHeaderCard
        profile={state.profile}
        onChangeDisplayName={setDisplayName}
      />

      <AllTimeRecordCard stats={predictionStats} />

      {(predictionInsights.mostPickedConference ||
        predictionInsights.mostPickedTeamName) && (
        <Card>
          <SectionHeader
            title="Insights"
            subtitle="A quick read on how you tend to pick."
          />
          <View style={styles.insightsGrid}>
            <View style={styles.insightTile}>
              <Text style={styles.insightLabel}>Most Picked Team</Text>
              <Text style={styles.insightValue}>
                {predictionInsights.mostPickedTeamName ?? "No picks yet"}
              </Text>
            </View>
            <View style={styles.insightTile}>
              <Text style={styles.insightLabel}>Most Picked Conference</Text>
              <Text style={styles.insightValue}>
                {predictionInsights.mostPickedConference ?? "No picks yet"}
              </Text>
            </View>
          </View>
        </Card>
      )}

      <Card>
        <SectionHeader
          title="Account & App"
          subtitle="Shortcuts and profile-level app actions."
        />
        <View style={styles.accountCard}>
          <Pressable
            style={styles.accountRow}
            onPress={() => router.push("/settings")}
          >
            <View style={styles.accountCopy}>
              <Text style={styles.accountLabel}>Appearance & Settings</Text>
              <Text style={styles.accountDetail}>
                Theme, court style, and in-game layout preferences.
              </Text>
            </View>
            <FontAwesome
              name="chevron-right"
              size={14}
              color={theme.colors.textMuted}
            />
          </Pressable>

          <View style={styles.accountRow}>
            <View style={styles.accountCopy}>
              <Text style={styles.accountLabel}>Favorite Team</Text>
              <Text style={styles.accountDetail}>
                {favoriteTeam?.name
                  ? `Pinned to ${favoriteTeam.name}`
                  : "No favorite team selected yet."}
              </Text>
            </View>
            {favoriteTeam?.logo ? (
              <Image source={{ uri: favoriteTeam.logo }} style={styles.favoriteTeamLogo} />
            ) : null}
          </View>

          <View style={styles.accountRow}>
            <View style={styles.accountCopy}>
              <Text style={styles.accountLabel}>Help & Feedback</Text>
              <Text style={styles.accountDetail}>
                Local-first profile. Picks are stored on this device today.
              </Text>
            </View>
          </View>

          <View style={styles.accountRow}>
            <View style={styles.accountCopy}>
              <Text style={styles.accountLabel}>About</Text>
              <Text style={styles.accountDetail}>
                Prediction tracking is built in for pre-game matchups and updates when final scores land.
              </Text>
            </View>
          </View>
        </View>
      </Card>

      <View style={styles.historyHeader}>
        <SectionHeader
          title="Prediction History"
          subtitle={
            syncing
              ? "Refreshing recent game results..."
              : "Review every pick, result, and pending lock."
          }
        />
        <TabBar
          items={historyFilterItems}
          activeKey={historyFilter}
          variant="flat"
        />
      </View>
    </View>
  );

  return (
    <AppScreen padded={false} scroll={false} style={styles.screen}>
      <FlatList
        data={filteredPredictions}
        keyExtractor={(item) => `${item.gameId}-${item.createdAt}`}
        renderItem={({ item }) => <PredictionHistoryItem prediction={item} />}
        ListHeaderComponent={header}
        contentContainerStyle={styles.historyListContent}
        ItemSeparatorComponent={() => <View style={styles.spacer} />}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={async () => {
              setSyncing(true);
              try {
                const snapshots = await refreshPredictionSnapshots(syncTargets);
                syncPredictionsFromSnapshots(snapshots);
              } finally {
                setSyncing(false);
              }
            }}
            tintColor={theme.colors.accent}
          />
        }
        ListEmptyComponent={
          <View style={styles.content}>
            <Card>
              <Text style={styles.emptyText}>
                {historyFilter === "all"
                  ? "No predictions yet. Open a future game and make your first pick."
                  : `No ${historyFilter} picks yet.`}
              </Text>
            </Card>
          </View>
        }
      />
    </AppScreen>
  );
}
