import { Easing, Animated, useWindowDimensions } from "react-native";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  useGameCardOrigin,
  type GameCardFrame,
  type GameCardOriginSource,
} from "@/src/navigation/GameCardOriginContext";
import { useAppTheme } from "@/src/theme/useAppTheme";

const EXIT_PULL_DISTANCE = 220;
const EXIT_DISMISS_DISTANCE = 132;
const EXIT_DISMISS_VELOCITY = 1200;
const EXIT_FALLBACK_SCALE = 0.92;
const EXIT_BORDER_RADIUS = 22;

type InGameExitTransitionContextValue = {
  isExitGestureActive: boolean;
  beginExitPull: () => void;
  updateExitPull: (distance: number) => void;
  endExitPull: (distance: number, velocityY: number) => void;
  cancelExitPull: () => void;
  translateLayerStyle: any;
  cardLayerStyle: any;
};

const InGameExitTransitionContext =
  createContext<InGameExitTransitionContextValue | null>(null);

function getFallbackFrame(width: number, height: number): GameCardFrame {
  const horizontalInset = 12;
  const targetWidth = Math.max(280, width - horizontalInset * 2);
  const targetHeight = Math.min(236, Math.max(180, height * 0.28));

  return {
    x: (width - targetWidth) * 0.5,
    y: Math.max(86, height * 0.14),
    width: targetWidth,
    height: targetHeight,
  };
}

export function InGameExitTransitionProvider({
  children,
  gameId,
  originSource,
  onDismiss,
}: {
  children: React.ReactNode;
  gameId: string;
  originSource?: string;
  onDismiss: () => void;
}) {
  const { activeOrigin, clearActiveOrigin } = useGameCardOrigin();
  const { tokens: theme } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const pullDistanceRef = useRef(0);
  const [isExitGestureActive, setIsExitGestureActive] = useState(false);

  const targetFrame = useMemo(() => {
    if (
      originSource === "live-games-card" &&
      activeOrigin?.source === "live-games-card" &&
      activeOrigin.gameId === gameId
    ) {
      return activeOrigin.frame;
    }
    return getFallbackFrame(width, height);
  }, [activeOrigin, gameId, height, originSource, width]);

  const dismissToOrigin = useCallback(() => {
    clearActiveOrigin();
    progress.setValue(0);
    onDismiss();
  }, [clearActiveOrigin, onDismiss, progress]);

  const animateTo = useCallback(
    (toValue: number, finished?: () => void) => {
      Animated.timing(progress, {
        toValue,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished: didFinish }) => {
        if (didFinish) {
          finished?.();
        }
      });
    },
    [progress],
  );

  const beginExitPull = useCallback(() => {
    setIsExitGestureActive(true);
  }, []);

  const updateExitPull = useCallback(
    (distance: number) => {
      const clampedDistance = Math.max(0, distance);
      pullDistanceRef.current = clampedDistance;
      setIsExitGestureActive(true);
      progress.stopAnimation();
      progress.setValue(Math.min(1, clampedDistance / EXIT_PULL_DISTANCE));
    },
    [progress],
  );

  const cancelExitPull = useCallback(() => {
    pullDistanceRef.current = 0;
    Animated.spring(progress, {
      toValue: 0,
      damping: 22,
      stiffness: 260,
      mass: 0.8,
      useNativeDriver: true,
    }).start(() => {
      setIsExitGestureActive(false);
    });
  }, [progress]);

  const endExitPull = useCallback(
    (distance: number, velocityY: number) => {
      const shouldDismiss =
        distance > EXIT_DISMISS_DISTANCE || velocityY > EXIT_DISMISS_VELOCITY;

      if (!shouldDismiss) {
        cancelExitPull();
        return;
      }

      setIsExitGestureActive(false);
      animateTo(1, dismissToOrigin);
    },
    [animateTo, cancelExitPull, dismissToOrigin],
  );

  const screenCenterX = width * 0.5;
  const screenCenterY = height * 0.5;
  const targetCenterX = targetFrame.x + targetFrame.width * 0.5;
  const targetCenterY = targetFrame.y + targetFrame.height * 0.5;
  const targetScale =
    originSource === "live-games-card" && activeOrigin?.gameId === gameId
      ? Math.max(
          0.58,
          Math.min(targetFrame.width / Math.max(1, width), targetFrame.height / Math.max(1, height)),
        )
      : EXIT_FALLBACK_SCALE;

  const translateLayerStyle = useMemo(
    () => ({
      transform: [
        {
          translateX: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, targetCenterX - screenCenterX],
          }),
        },
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, targetCenterY - screenCenterY],
          }),
        },
      ],
    }),
    [progress, screenCenterX, screenCenterY, targetCenterX, targetCenterY],
  );

  const cardLayerStyle = useMemo(
    () => ({
      transform: [
        {
          scale: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [1, targetScale],
          }),
        },
      ],
      borderRadius: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, EXIT_BORDER_RADIUS],
      }),
      opacity: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0.96],
      }),
      backgroundColor: theme.colors.bg,
    }),
    [progress, targetScale, theme.colors.bg],
  );

  const value = useMemo(
    () => ({
      isExitGestureActive,
      beginExitPull,
      updateExitPull,
      endExitPull,
      cancelExitPull,
      translateLayerStyle,
      cardLayerStyle,
    }),
    [
      beginExitPull,
      cancelExitPull,
      cardLayerStyle,
      endExitPull,
      isExitGestureActive,
      translateLayerStyle,
      updateExitPull,
    ],
  );

  return (
    <InGameExitTransitionContext.Provider value={value}>
      {children}
    </InGameExitTransitionContext.Provider>
  );
}

export function useInGameExitTransition(): InGameExitTransitionContextValue {
  const context = useContext(InGameExitTransitionContext);
  if (!context) {
    throw new Error(
      "useInGameExitTransition must be used within InGameExitTransitionProvider",
    );
  }
  return context;
}
