import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import CollapsingScoreHeader from "@/apps/mobile/src/components/game/CollapsingScoreHeader";
import { useCollapsingHeader } from "@/apps/mobile/src/hooks/useCollapsingHeader";
import { colors } from "@/theme/colors";

export default function CollapsingHeaderPreview() {
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const { headerContainerStyle, spacerStyle, expandedStyle, compactStyle } = useCollapsingHeader({
    scrollY,
    compactHeight: insets.top + 56,
    expandedHeight: insets.top + 132,
  });

  const rows = useMemo(
    () => Array.from({ length: 36 }, (_, idx) => `Preview Row ${idx + 1}`),
    [],
  );

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = Math.max(0, event.contentOffset.y);
    },
  });

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.screen}>
      <CollapsingScoreHeader
        homeTeam={{ name: "Kansas", logoUrl: undefined, score: 68 }}
        awayTeam={{ name: "Cincinnati", logoUrl: undefined, score: 65 }}
        statusText="Q2 04:12"
        animatedContainerStyle={headerContainerStyle}
        expandedContentStyle={expandedStyle}
        compactContentStyle={compactStyle}
      />
      <Animated.ScrollView style={styles.body} contentContainerStyle={styles.content} onScroll={onScroll} scrollEventThrottle={16}>
        <Animated.View style={spacerStyle} />
        {rows.map((row) => (
          <View key={row} style={styles.row}>
            <Text style={styles.rowText}>{row}</Text>
          </View>
        ))}
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 12,
    paddingBottom: 20,
    gap: 8,
  },
  row: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardSoft,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowText: {
    color: colors.text,
    fontWeight: "700",
  },
});
