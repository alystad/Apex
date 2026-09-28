import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import MarketRow from "@/components/stockmarket/MarketRow";
import {
  VirtualCurrencyIntroModal,
  VirtualCurrencyLabel,
} from "@/components/stockmarket/VirtualCurrencyNotice";
import { buildLeaderboard } from "@/src/features/stockmarket/leaderboard";
import {
  changeColor,
  marketColors,
  marketRadius,
  marketSpacing,
  marketType,
  tabularNums,
} from "@/src/features/stockmarket/marketTheme";
import {
  formatMoney,
  formatShares,
  formatSignedMoney,
  formatSignedPercent,
  STARTING_CASH,
} from "@/src/features/stockmarket/pricing";
import { useStockMarketData } from "@/src/features/stockmarket/StockMarketDataContext";
import { useStockPortfolio } from "@/src/features/stockmarket/StockPortfolioContext";
import type {
  StockLeaderboardEntry,
  StockPlayer,
  StockPosition,
  StockQuote,
  StockTransaction,
} from "@/src/features/stockmarket/types";
import { useProfile } from "@/src/profile/ProfileContext";

type StockTab = "market" | "portfolio" | "history" | "leaderboard";
type MarketSort = "gainers" | "losers" | "price" | "live";

const TABS: Array<{ key: StockTab; label: string }> = [
  { key: "market", label: "Market" },
  { key: "portfolio", label: "Portfolio" },
  { key: "history", label: "History" },
  { key: "leaderboard", label: "Leaderboard" },
];

const SORTS: Array<{ key: MarketSort; label: string }> = [
  { key: "gainers", label: "Gainers" },
  { key: "losers", label: "Losers" },
  { key: "price", label: "Price" },
  { key: "live", label: "Live" },
];

type MarketListRow = { player: StockPlayer; quote: StockQuote };

function sortRows(rows: MarketListRow[], sort: MarketSort): MarketListRow[] {
  const priced = rows.filter((row) => row.quote.price !== null);
  const unpriced = rows.filter((row) => row.quote.price === null);

  const sorted = [...priced].sort((left, right) => {
    if (sort === "price") {
      return (right.quote.price ?? 0) - (left.quote.price ?? 0);
    }
    if (sort === "gainers") {
      return (right.quote.changePct ?? 0) - (left.quote.changePct ?? 0);
    }
    if (sort === "losers") {
      return (left.quote.changePct ?? 0) - (right.quote.changePct ?? 0);
    }
    const leftLive = left.quote.game?.state === "in" ? 1 : 0;
    const rightLive = right.quote.game?.state === "in" ? 1 : 0;
    if (leftLive !== rightLive) {
      return rightLive - leftLive;
    }
    return (right.quote.changePct ?? 0) - (left.quote.changePct ?? 0);
  });

  // Players with no resolved price sink to the bottom rather than filling the
  // top of a "Losers" sort with zeroes.
  return [...sorted, ...unpriced];
}

export default function StockMarketScreen() {
  const router = useRouter();
  const { state: profileState } = useProfile();
  const {
    players,
    quotes,
    loading,
    hydrating,
    hydratedCount,
    error,
    refresh,
    refreshing,
  } = useStockMarketData();
  const { state: portfolio, valuation, isHydrated, dismissDisclaimer } =
    useStockPortfolio();

  const [tab, setTab] = useState<StockTab>("market");
  const [sort, setSort] = useState<MarketSort>("gainers");
  const [showIntro, setShowIntro] = useState(false);

  useEffect(() => {
    if (isHydrated && !portfolio.hasSeenDisclaimer) {
      setShowIntro(true);
    }
  }, [isHydrated, portfolio.hasSeenDisclaimer]);

  const rows = useMemo(() => {
    const joined = players
      .map((player) => {
        const quote = quotes.get(player.playerId);
        return quote ? { player, quote } : null;
      })
      .filter((row): row is MarketListRow => row !== null);
    return sortRows(joined, sort);
  }, [players, quotes, sort]);

  const sharesByPlayerId = useMemo(() => {
    const map = new Map<string, number>();
    portfolio.holdings.forEach((holding) => {
      map.set(holding.playerId, (map.get(holding.playerId) ?? 0) + holding.shares);
    });
    return map;
  }, [portfolio.holdings]);

  const leaderboard = useMemo(
    () => buildLeaderboard(valuation.totalValue, profileState.profile.displayName),
    [profileState.profile.displayName, valuation.totalValue],
  );

  const openPlayer = useCallback(
    (player: StockPlayer) => {
      router.push(`/stock-market/${player.playerId}`);
    },
    [router],
  );

  const netGain = valuation.totalValue - STARTING_CASH;
  const netGainPct = (netGain / STARTING_CASH) * 100;
  const netTint = changeColor(netGain);

  const header = (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Feather name="chevron-left" size={24} color={marketColors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>Stock Market</Text>
      </View>
      <VirtualCurrencyLabel />

      <View style={styles.valueBlock}>
        <Text style={styles.valueLabel}>Portfolio value</Text>
        <Text style={styles.value}>{formatMoney(valuation.totalValue)}</Text>
        <Text style={[styles.valueChange, { color: netTint }]}>
          {formatSignedMoney(netGain)} ({formatSignedPercent(netGainPct)}) all time
        </Text>
      </View>

      <View style={styles.tabRow}>
        {TABS.map((item) => {
          const isActive = tab === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              hitSlop={8}
              onPress={() => setTab(item.key)}
              style={styles.tabItem}
            >
              <Text style={[styles.tabLabel, isActive ? styles.tabLabelActive : null]}>
                {item.label}
              </Text>
              <View
                style={[styles.tabRule, isActive ? styles.tabRuleActive : null]}
              />
            </Pressable>
          );
        })}
      </View>

      {tab === "market" ? (
        <>
          <View style={styles.sortRow}>
            {SORTS.map((option) => {
              const isActive = sort === option.key;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  onPress={() => setSort(option.key)}
                  style={[styles.sortChip, isActive ? styles.sortChipActive : null]}
                >
                  <Text
                    style={[
                      styles.sortChipText,
                      isActive ? styles.sortChipTextActive : null,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {hydrating ? (
            <Text style={styles.status}>
              Pricing players… {hydratedCount}/{players.length}
            </Text>
          ) : null}
        </>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => {
        void refresh();
      }}
      tintColor={marketColors.textSecondary}
    />
  );

  const intro = (
    <VirtualCurrencyIntroModal
      visible={showIntro}
      onDismiss={() => {
        setShowIntro(false);
        dismissDisclaimer();
      }}
    />
  );

  if (tab === "market") {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
        <FlatList
          data={loading ? [] : rows}
          keyExtractor={(item) => item.player.playerId}
          ListHeaderComponent={header}
          contentContainerStyle={styles.listContent}
          refreshControl={refreshControl}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <MarketRow
              player={item.player}
              quote={item.quote}
              sharesOwned={sharesByPlayerId.get(item.player.playerId)}
              onPress={openPlayer}
            />
          )}
          ListEmptyComponent={
            loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={marketColors.textSecondary} />
                <Text style={styles.status}>Loading WNBA rosters…</Text>
              </View>
            ) : (
              <Text style={styles.status}>No players available right now.</Text>
            )
          }
        />
        {intro}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.listContent} refreshControl={refreshControl}>
        {header}
        {tab === "portfolio" ? (
          <PortfolioTab
            positions={valuation.positions}
            cash={valuation.cash}
            holdingsValue={valuation.holdingsValue}
            totalUnrealizedGain={valuation.totalUnrealizedGain}
            totalRealizedGain={valuation.totalRealizedGain}
            onPressPlayer={(playerId) => router.push(`/stock-market/${playerId}`)}
          />
        ) : null}
        {tab === "history" ? <HistoryTab transactions={portfolio.transactions} /> : null}
        {tab === "leaderboard" ? <LeaderboardTab entries={leaderboard} /> : null}
      </ScrollView>
      {intro}
    </SafeAreaView>
  );
}

function StatRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : null]}>
        {value}
      </Text>
    </View>
  );
}

function PortfolioTab({
  positions,
  cash,
  holdingsValue,
  totalUnrealizedGain,
  totalRealizedGain,
  onPressPlayer,
}: {
  positions: StockPosition[];
  cash: number;
  holdingsValue: number;
  totalUnrealizedGain: number;
  totalRealizedGain: number;
  onPressPlayer: (playerId: string) => void;
}) {
  return (
    <View style={styles.tabBody}>
      <View style={styles.statGroup}>
        <StatRow label="Buying power" value={formatMoney(cash)} />
        <StatRow label="Holdings value" value={formatMoney(holdingsValue)} />
        <StatRow
          label="Unrealized"
          value={formatSignedMoney(totalUnrealizedGain)}
          valueColor={changeColor(totalUnrealizedGain)}
        />
        <StatRow
          label="Realized"
          value={formatSignedMoney(totalRealizedGain)}
          valueColor={changeColor(totalRealizedGain)}
        />
      </View>

      <Text style={styles.sectionTitle}>Holdings</Text>
      {positions.length === 0 ? (
        <Text style={styles.status}>
          No positions yet. Open Market and buy a player to get started.
        </Text>
      ) : (
        positions.map((position) => {
          const tint = changeColor(position.unrealizedGain);
          return (
            <Pressable
              key={position.holding.id}
              accessibilityRole="button"
              onPress={() => onPressPlayer(position.holding.playerId)}
              style={({ pressed }) => [
                styles.positionRow,
                pressed ? styles.rowPressed : null,
              ]}
            >
              <View style={styles.positionIdentity}>
                <Text numberOfLines={1} style={styles.positionName}>
                  {position.holding.playerName}
                </Text>
                <Text numberOfLines={1} style={styles.positionMeta}>
                  {formatShares(position.holding.shares)}{" "}
                  {position.holding.shares === 1 ? "share" : "shares"} ·{" "}
                  {position.holding.kind === "game" ? "Game" : "Season"} · Avg{" "}
                  {formatMoney(position.holding.averageBuyPrice)}
                </Text>
              </View>
              <View style={styles.positionValues}>
                <Text style={styles.positionValue}>
                  {formatMoney(position.marketValue)}
                </Text>
                <Text style={[styles.positionChange, { color: tint }]}>
                  {formatSignedMoney(position.unrealizedGain)} (
                  {formatSignedPercent(position.unrealizedGainPct)})
                </Text>
              </View>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

function HistoryTab({ transactions }: { transactions: StockTransaction[] }) {
  if (transactions.length === 0) {
    return (
      <View style={styles.tabBody}>
        <Text style={styles.status}>No trades yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.tabBody}>
      {transactions.map((entry) => {
        const isSell = entry.type === "sell";
        return (
          <View key={entry.id} style={styles.txRow}>
            <View style={styles.txIdentity}>
              <Text numberOfLines={1} style={styles.txName}>
                {isSell ? "Sold" : "Bought"} {entry.playerName}
              </Text>
              <Text numberOfLines={1} style={styles.txMeta}>
                {formatShares(entry.shares)}{" "}
                {entry.shares === 1 ? "share" : "shares"} at {formatMoney(entry.price)} ·{" "}
                {entry.kind === "game" ? "Game" : "Season"}
                {entry.autoClosed ? " · Closed at buzzer" : ""}
              </Text>
              <Text style={styles.txMeta}>
                {new Date(entry.createdAt).toLocaleString()}
              </Text>
            </View>
            <View style={styles.txValues}>
              <Text style={styles.txAmount}>
                {isSell ? "+" : "−"}
                {formatMoney(entry.amount)}
              </Text>
              {entry.realizedGain !== null ? (
                <Text
                  style={[styles.txGain, { color: changeColor(entry.realizedGain) }]}
                >
                  {formatSignedMoney(entry.realizedGain)} (
                  {formatSignedPercent(entry.realizedGainPct)})
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function LeaderboardTab({ entries }: { entries: StockLeaderboardEntry[] }) {
  return (
    <View style={styles.tabBody}>
      <Text style={styles.status}>
        Ranked by total practice portfolio value. Rivals are simulated traders.
      </Text>
      {entries.map((entry, index) => (
        <View
          key={entry.id}
          style={[styles.lbRow, entry.isCurrentUser ? styles.lbRowSelf : null]}
        >
          <Text style={styles.lbRank}>{index + 1}</Text>
          <Text numberOfLines={1} style={styles.lbName}>
            {entry.name}
            {entry.isCurrentUser ? " · You" : ""}
          </Text>
          <View style={styles.lbValues}>
            <Text style={styles.lbValue}>{formatMoney(entry.totalValue)}</Text>
            <Text style={[styles.lbChange, { color: changeColor(entry.netGain) }]}>
              {formatSignedPercent(entry.netGainPct)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: marketColors.bg,
  },
  listContent: {
    paddingHorizontal: marketSpacing[20],
    paddingBottom: marketSpacing[40],
  },
  header: {
    paddingTop: marketSpacing[8],
    gap: marketSpacing[6],
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: marketSpacing[6],
    marginLeft: -marketSpacing[8],
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...marketType.screenTitle,
    color: marketColors.textPrimary,
  },
  valueBlock: {
    paddingTop: marketSpacing[20],
    gap: marketSpacing[2],
  },
  valueLabel: {
    ...marketType.label,
    color: marketColors.textMuted,
  },
  value: {
    ...marketType.bigValue,
    ...tabularNums,
    color: marketColors.textPrimary,
  },
  valueChange: {
    ...marketType.rowSecondary,
    ...tabularNums,
    fontWeight: "600",
  },
  tabRow: {
    flexDirection: "row",
    gap: marketSpacing[20],
    marginTop: marketSpacing[20],
  },
  tabItem: {
    gap: marketSpacing[8],
  },
  tabLabel: {
    ...marketType.rowSecondary,
    fontWeight: "700",
    color: marketColors.textMuted,
  },
  tabLabelActive: {
    color: marketColors.textPrimary,
  },
  tabRule: {
    height: 2,
    borderRadius: 1,
    backgroundColor: "transparent",
  },
  tabRuleActive: {
    backgroundColor: marketColors.textPrimary,
  },
  sortRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: marketSpacing[6],
    marginTop: marketSpacing[16],
  },
  sortChip: {
    paddingHorizontal: marketSpacing[16],
    paddingVertical: marketSpacing[8],
    borderRadius: marketRadius.pill,
    backgroundColor: marketColors.control,
  },
  sortChipActive: {
    backgroundColor: marketColors.controlActive,
  },
  sortChipText: {
    ...marketType.label,
    fontWeight: "700",
    color: marketColors.textSecondary,
  },
  sortChipTextActive: {
    color: marketColors.onControlActive,
  },
  status: {
    ...marketType.rowSecondary,
    color: marketColors.textMuted,
    paddingVertical: marketSpacing[8],
  },
  error: {
    ...marketType.rowSecondary,
    color: marketColors.down,
    paddingVertical: marketSpacing[8],
  },
  loading: {
    paddingVertical: marketSpacing[40],
    alignItems: "center",
    gap: marketSpacing[12],
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: marketColors.hairline,
  },
  tabBody: {
    paddingTop: marketSpacing[16],
  },
  sectionTitle: {
    ...marketType.sectionTitle,
    color: marketColors.textPrimary,
    marginTop: marketSpacing[24],
    marginBottom: marketSpacing[4],
  },
  statGroup: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: marketColors.hairline,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: marketSpacing[12],
    paddingVertical: marketSpacing[12],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: marketColors.hairline,
  },
  statLabel: {
    ...marketType.rowSecondary,
    color: marketColors.textSecondary,
  },
  statValue: {
    ...marketType.rowNumeric,
    ...tabularNums,
    color: marketColors.textPrimary,
  },
  rowPressed: {
    opacity: 0.55,
  },
  positionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: marketSpacing[12],
    paddingVertical: marketSpacing[12],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: marketColors.hairline,
  },
  positionIdentity: {
    flex: 1,
    minWidth: 0,
    gap: marketSpacing[2],
  },
  positionName: {
    ...marketType.rowPrimary,
    color: marketColors.textPrimary,
  },
  positionMeta: {
    ...marketType.rowSecondary,
    ...tabularNums,
    color: marketColors.textMuted,
  },
  positionValues: {
    alignItems: "flex-end",
    gap: marketSpacing[2],
  },
  positionValue: {
    ...marketType.rowNumeric,
    ...tabularNums,
    color: marketColors.textPrimary,
  },
  positionChange: {
    ...marketType.rowSecondary,
    ...tabularNums,
    fontWeight: "600",
  },
  txRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: marketSpacing[12],
    paddingVertical: marketSpacing[12],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: marketColors.hairline,
  },
  txIdentity: {
    flex: 1,
    minWidth: 0,
    gap: marketSpacing[2],
  },
  txName: {
    ...marketType.rowPrimary,
    fontSize: 15,
    color: marketColors.textPrimary,
  },
  txMeta: {
    ...marketType.micro,
    ...tabularNums,
    color: marketColors.textMuted,
  },
  txValues: {
    alignItems: "flex-end",
    gap: marketSpacing[2],
  },
  txAmount: {
    ...marketType.rowNumeric,
    ...tabularNums,
    fontSize: 15,
    color: marketColors.textPrimary,
  },
  txGain: {
    ...marketType.micro,
    ...tabularNums,
    fontWeight: "600",
  },
  lbRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: marketSpacing[12],
    paddingVertical: marketSpacing[12],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: marketColors.hairline,
  },
  lbRowSelf: {
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  lbRank: {
    ...marketType.rowSecondary,
    ...tabularNums,
    minWidth: 22,
    color: marketColors.textMuted,
  },
  lbName: {
    ...marketType.rowPrimary,
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    color: marketColors.textPrimary,
  },
  lbValues: {
    alignItems: "flex-end",
    gap: marketSpacing[2],
  },
  lbValue: {
    ...marketType.rowNumeric,
    ...tabularNums,
    fontSize: 15,
    color: marketColors.textPrimary,
  },
  lbChange: {
    ...marketType.micro,
    ...tabularNums,
    fontWeight: "600",
  },
});
