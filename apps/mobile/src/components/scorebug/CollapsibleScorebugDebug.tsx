import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { runOnJS, useAnimatedReaction, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type CollapsibleScorebugDebugProps = {
  scrollY: SharedValue<number>;
};

export default function CollapsibleScorebugDebug({
  scrollY,
}: CollapsibleScorebugDebugProps) {
  const insets = useSafeAreaInsets();
  const [displayY, setDisplayY] = useState(0);

  useAnimatedReaction(
    () => Math.round(scrollY.value),
    (next, prev) => {
      if (next !== prev) {
        runOnJS(setDisplayY)(next);
      }
    },
    [scrollY],
  );

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <Pressable
        pointerEvents="auto"
        style={[styles.bar, { top: insets.top }]}
      >
        <Text style={styles.text}>
          COMPACT SCOREBUG DEBUG - scrollY: {displayY}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 44,
    backgroundColor: "#d60000",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  text: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
  },
});
