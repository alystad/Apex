import Feather from "@expo/vector-icons/Feather";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import MarketChart from "@/components/stockmarket/MarketChart";
import TimeRangeSelector from "@/components/stockmarket/TimeRangeSelector";
import TradeSheet, { type TradeSide } from "@/components/stockmarket/TradeSheet";
import { VirtualCurrencyLabel } from "@/components/stockmarket/VirtualCurrencyNotice";
import {
  changeColor,
  marketColors,
  marketRadius,
  marketSpacing,
  marketType,
  tabularNums,
} from "@/src/features/stockmarket/marketTheme";
import { findHolding } from "@/src/features/stockmarket/portfolioMath";
import {
  formatMoney,
  formatShares,
  formatSignedMoney,
  formatSignedPercent,
} from "@/src/features/stockmarket/pricing";
import {
  defaultRangeFor,
  rangeChangeLabel,
  selectRangeSeries,
  type MarketRange,
} from "@/src/features/stockmarket/priceHistory";
import { useStockMarketData } from "@/src/features/stockmarket/StockMarketDataContext";
import { useStockPortfolio } from "@/src/features/stockmarket/StockPortfolioContext";
import type { StockHoldingKind } from "@/src/features/stockmarket/types";

const CHART_HEIGHT = 210;

export default function StockPlayerDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const params = useLocalSearchParams<{ playerId?: string | string[] }>();
  const playerId = Array.isArray(params.playerId) ? params.playerId[0] : params.playerId;

  const { getPlayer, getQuote } = useStockMarketData();
  const { valuation, buy, sell, state: portfolio } = useStockPortfolio();

  const [mode, setMode] = useState<StockHoldingKind>("game");
  const [range, setRange] = useState<MarketRange | null>(null);
  const [tradeSide, setTradeSide] = useState<TradeSide | null>(null);

  const player = playerId ? getPlayer(playerId) : null;
  const quote = playerId ? getQuote(playerId) : null;

  // Open on the intraday line when there's a live game worth watching,
  // otherwise the season line. Only until the user picks a range themselves.
  const hasLiveHistory = (quote?.liveHistory.length ?? 0) >= 2;
  useEffect(() => {
    setRange((current) => current ?? (quote ? defaultRangeFor(quote) : null));
  }, [hasLiveHistory, quote]);

  const activeRange: MarketRange = range ?? "SEASON";
  const series = useMemo(
    () => (quote ? selectRangeSeries(quote, activeRange) : null),
    [activeRange, quote],
  );

  if (!player || !quote || !series) {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
        <View style={styles.body}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={12}
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Feather name="chevron-left" size={24} color={marketColors.textPrimary} />
          </Pressable>
          <Text style={styles.emptyText}>
            This player isn&apos;t in the market list right now.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const game = quote.game;
  const isGameMode = mode === "game";
  const tradePrice = isGameMode ? quote.price : quote.seasonPrice;
  const holding = findHolding(portfolio, mode, player.playerId, game?.gameId);

  const tint = changeColor(series.changeAbs);
  const chartUp = (series.changeAbs ?? 0) >= 0;

  const canBuy =
    tradePrice !== null && (!isGameMode || (Boolean(game) && game!.state !== "post"));
  const canSell = Boolean(holding) && tradePrice !== null;

  const buyBlockedReason = !isGameMode
    ? null
    : !game
      ? "No WNBA game for this player today — switch to Season to trade."
      : game.state === "post"
        ? "This game is final. Single-game positions close at the buzzer."
        : tradePrice === null
          ? "Waiting on a price for this player."
          : null;

  const submitTrade = (side: TradeSide, shares: number) => {
    if (tradePrice === null) {
      return { ok: false as const, reason: "No price available yet." };
    }
    const order = {
      kind: mode,
      playerId: player.playerId,
      playerName: player.name,
      playerHeadshot: player.headshot,
      teamAbbreviation: player.teamAbbreviation,
      gameId: isGameMode ? game?.gameId : undefined,
      gameLabel: isGameMode ? game?.label : undefined,
      shares,
      price: tradePrice,
    };
    return side === "buy" ? buy(order) : sell(order);
  };

  const chartWidth = windowWidth - marketSpacing[20] * 2;
  const impactRating = isGameMode
    ? quote.liveRating ?? quote.seasonRating
    : quote.seasonRating;

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: marketSpacing[40] + 96 + insets.bottom },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Feather name="chevron-left" size={24} color={marketColors.textPrimary} />
        </Pressable>

        <Text style={styles.playerName}>{player.name}</Text>
        <Text style={styles.playerMeta}>
          {player.teamName}
          {player.jersey && player.jersey !== "-" ? ` · #${player.jersey}` : ""}
          {player.position ? ` · ${player.position}` : ""}
        </Text>

        <Text style={styles.heroPrice}>
          {tradePrice === null ? "—" : formatMoney(tradePrice)}
        </Text>
        <Text style={[styles.heroChange, { color: tint }]}>
          {series.changeAbs === null
            ? "No change data in this range"
            : `${formatSignedMoney(series.changeAbs)} (${formatSignedPercent(
                series.changePct,
              )}) ${rangeChangeLabel(activeRange)}`}
        </Text>

        <View style={styles.chartWrap}>
          <MarketChart
            points={series.points}
            width={chartWidth}
            height={CHART_HEIGHT}
            up={chartUp}
            emptyLabel={series.emptyReason ?? "No price history in this range."}
          />
        </View>

        <TimeRangeSelector
          value={activeRange}
          onChange={setRange}
          accentColor={series.isEmpty ? marketColors.textSecondary : tint}
        />

        <View style={styles.modeRow}>
          {(["game", "season"] as const).map((option) => {
            const isActive = mode === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                onPress={() => {
                  setMode(option);
                  // An intraday line under a season price is incoherent — a
                  // season position doesn't move within a game.
                  if (option === "season" && activeRange === "1D") {
                    setRange("SEASON");
                  }
                }}
                style={[styles.modeChip, isActive ? styles.modeChipActive : null]}
              >
                <Text
                  style={[
                    styles.modeChipText,
                    isActive ? styles.modeChipTextActive : null,
                  ]}
                >
                  {option === "game" ? "This game" : "Season"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {holding ? (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>Your position</Text>
            <DetailRow label="Shares" value={formatShares(holding.shares)} />
            <DetailRow label="Average cost" value={formatMoney(holding.averageBuyPrice)} />
            <DetailRow
              label="Market value"
              value={
                tradePrice === null ? "—" : formatMoney(holding.shares * tradePrice)
              }
            />
            <DetailRow
              label="Total return"
              value={
                tradePrice === null
                  ? "—"
                  : `${formatSignedMoney(
                      (tradePrice - holding.averageBuyPrice) * holding.shares,
                    )} (${formatSignedPercent(
                      ((tradePrice - holding.averageBuyPrice) / holding.averageBuyPrice) *
                        100,
                    )})`
              }
              valueColor={
                tradePrice === null
                  ? undefined
                  : changeColor(tradePrice - holding.averageBuyPrice)
              }
            />
          </View>
        ) : null}

        <View style={styles.group}>
          <Text style={styles.groupTitle}>About</Text>
          <DetailRow
            label="Impact Rating"
            value={impactRating === null ? "—" : impactRating.toFixed(1)}
          />
          <DetailRow
            label="Season average price"
            value={quote.seasonPrice === null ? "—" : formatMoney(quote.seasonPrice)}
          />
          <DetailRow label="Today" value={game ? game.statusText : "No game"} />
          <DetailRow label="Matchup" value={game ? game.label : "—"} />
          <DetailRow label="Buying power" value={formatMoney(valuation.cash)} />
        </View>

        <Text style={styles.explainer}>
          {isGameMode
            ? "Single-game price follows this player's live Impact Rating and closes automatically at the final buzzer."
            : "Season price follows this player's rolling season-average Impact Rating. Sell whenever you choose."}
        </Text>

        {buyBlockedReason ? (
          <Text style={styles.blockedText}>{buyBlockedReason}</Text>
        ) : null}

        <View style={styles.disclaimerWrap}>
          <VirtualCurrencyLabel />
        </View>
      </ScrollView>

      {/* Fixed trade bar — the primary action stays reachable no matter how far
          the page is scrolled. */}
      <View style={[styles.tradeBar, { paddingBottom: marketSpacing[12] + insets.bottom }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canBuy }}
          disabled={!canBuy}
          onPress={() => setTradeSide("buy")}
          style={({ pressed }) => [
            styles.buyButton,
            !canBuy ? styles.buttonDisabled : null,
            pressed && canBuy ? styles.buttonPressed : null,
          ]}
        >
          <Text style={styles.buyButtonText}>Buy</Text>
        </Pressable>

        {holding ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSell }}
            disabled={!canSell}
            onPress={() => setTradeSide("sell")}
            style={({ pressed }) => [
              styles.sellButton,
              !canSell ? styles.buttonDisabled : null,
              pressed && canSell ? styles.buttonPressed : null,
            ]}
          >
            <Text style={styles.sellButtonText}>Sell</Text>
          </Pressable>
        ) : null}
      </View>

      <TradeSheet
        visible={tradeSide !== null}
        side={tradeSide ?? "buy"}
        playerName={player.name}
        kind={mode}
        price={tradePrice}
        cash={valuation.cash}
        holding={holding}
        onClose={() => setTradeSide(null)}
        onSubmit={submitTrade}
      />
    </SafeAreaView>
  );
}

function DetailRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        numberOfLines={1}
        style={[styles.detailValue, valueColor ? { color: valueColor } : null]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: marketColors.bg,
  },
  body: {
    paddingHorizontal: marketSpacing[20],
    paddingTop: marketSpacing[8],
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -marketSpacing[8],
    marginBottom: marketSpacing[16],
  },
  playerName: {
    ...marketType.sectionTitle,
    fontSize: 18,
    color: marketColors.textSecondary,
  },
  playerMeta: {
    ...marketType.micro,
    color: marketColors.textMuted,
    marginTop: marketSpacing[2],
  },
  heroPrice: {
    ...marketType.heroPrice,
    ...tabularNums,
    color: marketColors.textPrimary,
    marginTop: marketSpacing[12],
  },
  heroChange: {
    ...marketType.rowSecondary,
    ...tabularNums,
    fontSize: 14,
    fontWeight: "600",
    marginTop: marketSpacing[4],
  },
  chartWrap: {
    marginTop: marketSpacing[20],
    marginBottom: marketSpacing[12],
  },
  modeRow: {
    flexDirection: "row",
    gap: marketSpacing[6],
    marginTop: marketSpacing[24],
  },
  modeChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: marketSpacing[10],
    borderRadius: marketRadius.pill,
    backgroundColor: marketColors.control,
  },
  modeChipActive: {
    backgroundColor: marketColors.controlActive,
  },
  modeChipText: {
    ...marketType.label,
    fontWeight: "700",
    color: marketColors.textSecondary,
  },
  modeChipTextActive: {
    color: marketColors.onControlActive,
  },
  group: {
    marginTop: marketSpacing[32],
  },
  groupTitle: {
    ...marketType.sectionTitle,
    color: marketColors.textPrimary,
    marginBottom: marketSpacing[4],
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: marketSpacing[16],
    paddingVertical: marketSpacing[12],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: marketColors.hairline,
  },
  detailLabel: {
    ...marketType.rowSecondary,
    color: marketColors.textSecondary,
  },
  detailValue: {
    ...marketType.rowNumeric,
    ...tabularNums,
    flexShrink: 1,
    textAlign: "right",
    color: marketColors.textPrimary,
  },
  explainer: {
    ...marketType.micro,
    color: marketColors.textMuted,
    marginTop: marketSpacing[24],
    lineHeight: 17,
  },
  blockedText: {
    ...marketType.micro,
    color: marketColors.textSecondary,
    marginTop: marketSpacing[8],
  },
  disclaimerWrap: {
    marginTop: marketSpacing[24],
  },
  emptyText: {
    ...marketType.rowSecondary,
    color: marketColors.textSecondary,
  },
  tradeBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: marketSpacing[20],
    paddingTop: marketSpacing[12],
    gap: marketSpacing[8],
    backgroundColor: marketColors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: marketColors.hairline,
  },
  buyButton: {
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: marketRadius.pill,
    backgroundColor: marketColors.up,
  },
  buyButtonText: {
    ...marketType.button,
    color: "#000000",
  },
  sellButton: {
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: marketRadius.pill,
    borderWidth: 1.5,
    borderColor: marketColors.outline,
    backgroundColor: "transparent",
  },
  sellButtonText: {
    ...marketType.button,
    color: marketColors.textPrimary,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonPressed: {
    opacity: 0.75,
  },
});
