import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const DOT = 8;
const HALO = 18;

type LiveStatusDotProps = {
  // True when live games are active — only then does the dot light up + pulse.
  active: boolean;
  activeColor?: string;
  idleColor: string;
};

// The small status dot inside the Live pill. When live games are active it
// turns on (colored) and emits a soft, slow pulse halo; otherwise it's a quiet
// idle dot. Deliberately self-contained so the pill background stays a neutral
// glass state and only this indicator reflects live status.
export default function LiveStatusDot({
  active,
  activeColor = "#22C55E",
  idleColor,
}: LiveStatusDotProps) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (active) {
      pulse.value = withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
    return () => cancelAnimation(pulse);
  }, [active, pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: (1 - pulse.value) * 0.45,
    transform: [{ scale: 0.5 + pulse.value * 1.2 }],
  }));

  return (
    <View style={styles.wrap}>
      {active ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.halo, { backgroundColor: activeColor }, haloStyle]}
        />
      ) : null}
      <View
        style={[
          styles.dot,
          { backgroundColor: active ? activeColor : idleColor },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: DOT,
    height: DOT,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
  halo: {
    position: "absolute",
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
    left: (DOT - HALO) / 2,
    top: (DOT - HALO) / 2,
  },
});
