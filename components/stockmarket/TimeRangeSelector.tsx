import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  marketColors,
  marketRadius,
  marketSpacing,
  marketType,
} from "@/src/features/stockmarket/marketTheme";
import {
  MARKET_RANGES,
  type MarketRange,
} from "@/src/features/stockmarket/priceHistory";

type TimeRangeSelectorProps = {
  value: MarketRange;
  onChange: (range: MarketRange) => void;
  /** Tints the active pill with the up/down color, like a real trading app. */
  accentColor: string;
};

/**
 * The horizontal range row that sits directly under the chart. Inactive ranges
 * are bare grey text with no chrome at all; only the selected one gets a pill,
 * tinted to match the line above it.
 */
export default function TimeRangeSelector({
  value,
  onChange,
  accentColor,
}: TimeRangeSelectorProps) {
  return (
    <View style={styles.row}>
      {MARKET_RANGES.map((range) => {
        const isActive = range.key === value;
        return (
          <Pressable
            key={range.key}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`Show ${range.label} price range`}
            hitSlop={6}
            onPress={() => onChange(range.key)}
            style={[
              styles.pill,
              isActive ? { backgroundColor: `${accentColor}26` } : null,
            ]}
          >
            <Text
              style={[
                styles.label,
                { color: isActive ? accentColor : marketColors.textMuted },
              ]}
            >
              {range.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: marketSpacing[4],
  },
  pill: {
    paddingHorizontal: marketSpacing[12],
    paddingVertical: marketSpacing[6],
    borderRadius: marketRadius.pill,
  },
  label: {
    ...marketType.label,
    fontWeight: "700",
  },
});
