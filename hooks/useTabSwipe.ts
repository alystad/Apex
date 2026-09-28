import { useMemo } from "react";
import { PanResponder, type GestureResponderHandlers, type ViewStyle } from "react-native";
import { Gesture } from "react-native-gesture-handler";

type UseTabSwipeOptions = {
  onRightEdgeSwipe?: () => void;
};

export function useTabSwipe(options?: UseTabSwipeOptions): {
  panHandlers: GestureResponderHandlers;
  gesture: ReturnType<typeof Gesture.Pan>;
  swipeStyle: ViewStyle;
} {
  const onRightEdgeSwipe = options?.onRightEdgeSwipe;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 12 && Math.abs(gs.dx) > Math.abs(gs.dy),
        onPanResponderRelease: (_, gs) => {
          if (gs.dx > 70) {
            onRightEdgeSwipe?.();
          }
        },
      }),
    [onRightEdgeSwipe],
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan().onEnd((event) => {
        if (event.translationX > 70) {
          onRightEdgeSwipe?.();
        }
      }),
    [onRightEdgeSwipe],
  );

  return {
    panHandlers: panResponder.panHandlers,
    gesture,
    swipeStyle: {},
  };
}
