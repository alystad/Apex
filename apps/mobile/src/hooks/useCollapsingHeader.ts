import { Extrapolation, interpolate, useAnimatedStyle, useDerivedValue, type SharedValue } from "react-native-reanimated";

type UseCollapsingHeaderParams = {
  scrollY: SharedValue<number>;
  compactHeight: number;
  expandedHeight: number;
};

export function useCollapsingHeader({
  scrollY,
  compactHeight,
  expandedHeight,
}: UseCollapsingHeaderParams) {
  const collapseDistance = Math.max(1, expandedHeight - compactHeight);
  const collapseThreshold = 60;

  const headerHeight = useDerivedValue(() =>
    interpolate(
      scrollY.value,
      [0, collapseThreshold],
      [expandedHeight, compactHeight],
      Extrapolation.CLAMP,
    ),
  );

  const progress = useDerivedValue(() =>
    interpolate(scrollY.value, [0, collapseThreshold], [0, 1], Extrapolation.CLAMP),
  );

  const expandedStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateY: -progress.value * 12 }],
  }));

  const compactStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -8 }],
  }));

  const headerContainerStyle = useAnimatedStyle(() => ({
    height: headerHeight.value,
  }));

  const spacerStyle = useAnimatedStyle(() => ({
    height: headerHeight.value,
  }));

  return {
    collapseDistance,
    collapseThreshold,
    headerHeight,
    headerContainerStyle,
    spacerStyle,
    expandedStyle,
    compactStyle,
  };
}
