import { addDays, format, startOfDay } from "date-fns";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors } from "@/theme/colors";

type DateScrollWheelProps = {
  valueKey: string;
  onChangeKey: (key: string) => void;
  windowPast?: number;
  windowFuture?: number;
};

const DAY_CHIP_ESTIMATED_WIDTH = 82;

function DateScrollWheelComponent({
  valueKey,
  onChangeKey,
  windowPast = 30,
  windowFuture = 30,
}: DateScrollWheelProps) {
  const scrollRef = useRef<ScrollView | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const days = useMemo(() => {
    const today = startOfDay(new Date());
    const items: Array<{ key: string; top: string; bottom: string }> = [];
    for (let offset = -windowPast; offset <= windowFuture; offset += 1) {
      const date = addDays(today, offset);
      items.push({
        key: format(date, "yyyy-MM-dd"),
        top: format(date, "EEE"),
        bottom: format(date, "MMM d"),
      });
    }
    return items;
  }, [windowFuture, windowPast]);

  useEffect(() => {
    const idx = days.findIndex((day) => day.key === valueKey);
    if (idx < 0 || !scrollRef.current || containerWidth <= 0) {
      return;
    }

    const centerX = idx * DAY_CHIP_ESTIMATED_WIDTH + DAY_CHIP_ESTIMATED_WIDTH / 2;
    const targetX = Math.max(0, centerX - containerWidth / 2);
    const raf = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: targetX, animated: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [containerWidth, days, valueKey]);

  return (
    <View style={styles.wrap} onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {days.map((day) => {
          const active = day.key === valueKey;
          return (
            <Pressable
              key={day.key}
              style={[styles.dayChip, active && styles.dayChipActive]}
              onPress={() => onChangeKey(day.key)}
            >
              <Text style={[styles.dayTop, active && styles.dayTextActive]}>{day.top}</Text>
              <Text style={[styles.dayBottom, active && styles.dayTextActive]}>{day.bottom}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    backgroundColor: colors.background,
    paddingVertical: 8,
  },
  row: {
    paddingHorizontal: 10,
    gap: 8,
  },
  dayChip: {
    minWidth: 74,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardSoft,
    backgroundColor: colors.card,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  dayChipActive: {
    borderColor: colors.cardSoft,
  },
  dayTop: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  dayBottom: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  dayTextActive: {
    color: "#FFFFFF",
  },
});

const DateScrollWheel = memo(DateScrollWheelComponent);

export default DateScrollWheel;
