import { Pressable, StyleSheet, Text, View } from "react-native";

import { tokens } from "@/apps/mobile/src/design/tokens";

export type SegmentedPillOption<T extends string> = {
  value: T;
  label: string;
};

type SegmentedPillProps<T extends string> = {
  value: T;
  options: SegmentedPillOption<T>[];
  onChange: (value: T) => void;
};

export default function SegmentedPill<T extends string>({
  value,
  options,
  onChange,
}: SegmentedPillProps<T>) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              hitSlop={8}
              style={({ pressed }) => [
                styles.segment,
                {
                  transform: [{ scale: pressed ? tokens.pressedScale : 1 }],
                  backgroundColor: "transparent",
                },
              ]}
            >
              <Text
                style={[
                  styles.segmentLabel,
                  { color: selected ? "#FFFFFF" : "rgba(255,255,255,0.6)" },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: tokens.minTap,
    borderRadius: tokens.radiusPill,
    borderWidth: 0,
    borderColor: "transparent",
    overflow: "visible",
    backgroundColor: "transparent",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: tokens.minTap,
    padding: 2,
  },
  segment: {
    flex: 1,
    minHeight: tokens.minTap,
    borderRadius: tokens.radiusPill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  segmentLabel: {
    fontSize: tokens.labelSize,
    fontWeight: "700",
  },
});
