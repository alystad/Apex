import { Pressable, StyleSheet, Text, View } from "react-native";

import MarketChart from "@/components/stockmarket/MarketChart";
import {
  changeColor,
  isUp,
  marketColors,
  marketSpacing,
  marketType,
  tabularNums,
} from "@/src/features/stockmarket/marketTheme";
import {
  formatMoney,
  formatShares,
  formatSignedPercent,
} from "@/src/features/stockmarket/pricing";
import { sparklineSeries } from "@/src/features/stockmarket/priceHistory";
import type { StockPlayer, StockQuote } from "@/src/features/stockmarket/types";

type MarketRowProps = {
  player: StockPlayer;
  quote: StockQuote;
  onPress: (player: StockPlayer) => void;
  sharesOwned?: number;
};

const SPARK_WIDTH = 68;
const SPARK_HEIGHT = 30;

/**
 * A watchlist row: ticker-style name on the left, sparkline in the middle,
 * price and percent change right-aligned in tabular figures.
 *
 * Deliberately carries none of the app's in-game row language — no team-colored
 * photo ring, no colored Impact Rating badge, no fire glow. The only color is
 * the up/down green or red on the change.
 */
export default function MarketRow({
  player,
  quote,
  onPress,
  sharesOwned,
}: MarketRowProps) {
  const tint = changeColor(quote.changeAbs);
  const trendUp = isUp(quote.changeAbs);
  const spark = sparklineSeries(quote);
  const isLive = quote.game?.state === "in";

  const subtitle = sharesOwned
    ? `${formatShares(sharesOwned)} ${sharesOwned === 1 ? "share" : "shares"}`
    : `${player.teamAbbreviation}${player.position ? ` · ${player.position}` : ""}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${player.name}, ${formatMoney(quote.price)}`}
      onPress={() => onPress(player)}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.identity}>
        <View style={styles.nameRow}>
          {isLive ? <View style={styles.liveDot} /> : null}
          <Text numberOfLines={1} style={styles.name}>
            {player.name}
          </Text>
        </View>
        <Text numberOfLines={1} style={styles.subtitle}>
          {subtitle}
        </Text>
      </View>

      <View style={styles.spark}>
        {spark.length >= 2 ? (
          <MarketChart
            points={spark}
            width={SPARK_WIDTH}
            height={SPARK_HEIGHT}
            up={trendUp}
            variant="spark"
          />
        ) : null}
      </View>

      <View style={styles.values}>
        <Text style={styles.price}>
          {quote.price === null ? "—" : formatMoney(quote.price)}
        </Text>
        <Text style={[styles.change, { color: tint }]}>
          {quote.changePct === null
            ? quote.hasSeasonPrice
              ? "0.00%"
              : "—"
            : formatSignedPercent(quote.changePct)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: marketSpacing[12],
    paddingVertical: marketSpacing[12],
    minHeight: 64,
  },
  rowPressed: {
    opacity: 0.55,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    gap: marketSpacing[2],
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: marketSpacing[6],
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: marketColors.up,
  },
  name: {
    ...marketType.rowPrimary,
    flexShrink: 1,
    color: marketColors.textPrimary,
  },
  subtitle: {
    ...marketType.rowSecondary,
    ...tabularNums,
    color: marketColors.textMuted,
  },
  spark: {
    width: SPARK_WIDTH,
    height: SPARK_HEIGHT,
    justifyContent: "center",
  },
  values: {
    minWidth: 92,
    alignItems: "flex-end",
    gap: marketSpacing[2],
  },
  price: {
    ...marketType.rowNumeric,
    ...tabularNums,
    color: marketColors.textPrimary,
  },
  change: {
    ...marketType.rowSecondary,
    ...tabularNums,
    fontWeight: "600",
  },
});
