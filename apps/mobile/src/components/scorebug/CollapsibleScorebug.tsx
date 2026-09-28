import { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "@/theme/colors";

const FALLBACK_IMAGE_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

export type CollapsibleScorebugGameData = {
  away: {
    label: string;
    compactLabel: string;
    logoUri?: string;
  };
  home: {
    label: string;
    compactLabel: string;
    logoUri?: string;
  };
  awayScore: string;
  homeScore: string;
  metaText?: string;
  statusText: string;
};

type CollapsibleScorebugProps = {
  mode: "full" | "compact";
  game: CollapsibleScorebugGameData;
  scrollY: SharedValue<number>;
  onPress?: () => void;
  collapseStart?: number;
  collapseEnd?: number;
  compactHeight?: number;
  onAnchorMeasured?: (measurement: CollapsibleScorebugAnchorMeasurement) => void;
  anchorTransform?: CollapsibleScorebugAnchorTransform;
};

type ScorebugMode = CollapsibleScorebugProps["mode"];

export type CollapsibleScorebugAnchorFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CollapsibleScorebugAnchorMeasurement = {
  mode: ScorebugMode;
  frame: CollapsibleScorebugAnchorFrame;
};

export type CollapsibleScorebugAnchorTransform = {
  deltaX: number;
  deltaY: number;
  scaleRatio: number;
};

export default function CollapsibleScorebug({
  mode,
  game,
  scrollY,
  onPress,
  collapseStart = 20,
  collapseEnd = 140,
  compactHeight = 56,
  onAnchorMeasured,
  anchorTransform,
}: CollapsibleScorebugProps) {
  const insets = useSafeAreaInsets();
  const overlayHeight = compactHeight + insets.top;
  const compactStatusText = game.statusText?.trim() || game.metaText?.trim() || "-";
  const anchorRef = useRef<View>(null);
  const [fullCardHeight, setFullCardHeight] = useState(0);
  const translateXTarget = anchorTransform?.deltaX ?? 0;
  const translateYTarget = anchorTransform?.deltaY ?? -12;
  const scaleTarget = anchorTransform?.scaleRatio ?? 0.84;

  const collapseProgress = useDerivedValue(() => {
    const y = Math.max(0, scrollY.value);
    return interpolate(
      y,
      [collapseStart, collapseEnd],
      [0, 1],
      Extrapolation.CLAMP,
    );
  });

  const measureAnchor = useCallback(() => {
    if (!onAnchorMeasured) {
      return;
    }
    const node = anchorRef.current;
    if (!node || typeof node.measureInWindow !== "function") {
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) {
        return;
      }
      onAnchorMeasured({
        mode,
        frame: { x, y, width, height },
      });
    });
  }, [mode, onAnchorMeasured]);

  const handleAnchorLayout = useCallback(() => {
    requestAnimationFrame(() => {
      measureAnchor();
    });
  }, [measureAnchor]);

  useEffect(() => {
    if (!onAnchorMeasured) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      measureAnchor();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [game, measureAnchor, onAnchorMeasured]);

  const handleFullCardLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    setFullCardHeight((prevHeight) =>
      Math.abs(prevHeight - nextHeight) < 0.5 ? prevHeight : nextHeight,
    );
  }, []);

  const fullClipStyle = useAnimatedStyle(() => {
    const progress = collapseProgress.value;
    if (fullCardHeight <= 0) {
      return {};
    }
    return {
      height: Math.max(0, fullCardHeight * (1 - progress)),
    };
  }, [fullCardHeight]);

  const fullAnimatedStyle = useAnimatedStyle(() => {
    const progress = collapseProgress.value;
    return {
      transform: [
        { translateX: translateXTarget * progress },
        { translateY: translateYTarget * progress },
        {
          scale: interpolate(
            progress,
            [0, 1],
            [1, scaleTarget],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  }, [scaleTarget, translateXTarget, translateYTarget]);

  const compactAnimatedStyle = useAnimatedStyle(() => {
    const progress = collapseProgress.value;
    return {
      transform: [
        {
          translateY: interpolate(
            progress,
            [0, 1],
            [-overlayHeight, 0],
            Extrapolation.CLAMP,
          ),
        },
        {
          scale: interpolate(progress, [0, 1], [0.97, 1], Extrapolation.CLAMP),
        },
      ],
    };
  });

  if (mode === "compact") {
    return (
      <View
        pointerEvents="box-none"
        style={[styles.compactOverlayWrap, { height: overlayHeight }]}
      >
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.compactOuter,
            compactAnimatedStyle,
            { height: overlayHeight },
          ]}
        >
          <View
            pointerEvents="box-none"
            style={[
              styles.compactSurface,
              { height: overlayHeight, paddingTop: insets.top },
            ]}
          >
            <Pressable
              pointerEvents="auto"
              onPress={onPress}
              style={[styles.compactCard, { height: compactHeight }]}
            >
              <View style={styles.compactScoreRow}>
                <Text style={styles.compactSide} numberOfLines={1}>
                  {game.away.compactLabel} {game.awayScore}
                </Text>
                <View
                  ref={anchorRef}
                  onLayout={handleAnchorLayout}
                  style={styles.compactScoreCenterWrap}
                >
                  <Text style={styles.compactScoreCenter} numberOfLines={1}>
                    {game.awayScore} - {game.homeScore}
                  </Text>
                </View>
                <Text style={styles.compactSideRight} numberOfLines={1}>
                  {game.home.compactLabel}
                </Text>
              </View>
              <View style={styles.compactStatusRow}>
                <Text style={styles.compactStatusText} numberOfLines={1}>
                  {compactStatusText}
                </Text>
              </View>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.fullClip, fullClipStyle]}>
      <Animated.View style={[styles.fullCard, fullAnimatedStyle]} onLayout={handleFullCardLayout}>
        <View style={styles.scoreRow}>
          <View style={styles.teamWrap}>
            <Image
              source={{ uri: game.away.logoUri || FALLBACK_IMAGE_URI }}
              style={styles.teamLogo}
            />
            <Text style={styles.teamName} numberOfLines={2}>
              {game.away.label}
            </Text>
          </View>

          <View ref={anchorRef} onLayout={handleAnchorLayout} style={styles.scoreCenter}>
            <Text style={styles.scoreText}>
              {game.awayScore} - {game.homeScore}
            </Text>
            {game.metaText ? <Text style={styles.metaText}>{game.metaText}</Text> : null}
            <Text style={styles.statusText}>{game.statusText}</Text>
          </View>

          <View style={styles.teamWrap}>
            <Image
              source={{ uri: game.home.logoUri || FALLBACK_IMAGE_URI }}
              style={styles.teamLogo}
            />
            <Text style={styles.teamName} numberOfLines={2}>
              {game.home.label}
            </Text>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fullClip: {
    overflow: "hidden",
  },
  fullCard: {
    backgroundColor: "#18243c",
    width: "50%",
    alignSelf: "center",
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#223253",
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  teamWrap: {
    width: "32%",
    alignItems: "center",
    gap: 4,
  },
  teamLogo: {
    width: 42,
    height: 42,
  },
  teamName: {
    color: "#f4f8ff",
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "800",
    textAlign: "center",
    width: "100%",
  },
  scoreCenter: {
    width: "34%",
    alignItems: "center",
  },
  scoreText: {
    color: "#f4f8ff",
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "900",
  },
  metaText: {
    marginTop: 2,
    color: "#9fb0cf",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  statusText: {
    marginTop: 2,
    color: "#9fb0cf",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  compactOverlayWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 9999,
    overflow: "hidden",
  },
  compactOuter: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
  },
  compactSurface: {
    justifyContent: "center",
    backgroundColor: "#10243d",
    borderBottomWidth: 1,
    borderBottomColor: "#29456f",
  },
  compactCard: {
    paddingHorizontal: 12,
    justifyContent: "center",
    gap: 2,
  },
  compactScoreRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  compactSide: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  compactScoreCenterWrap: {
    minWidth: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  compactScoreCenter: {
    textAlign: "center",
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  compactSideRight: {
    flex: 1,
    textAlign: "right",
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  compactStatusRow: {
    alignItems: "center",
    justifyContent: "center",
  },
  compactStatusText: {
    color: "#b8c7e1",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
});
