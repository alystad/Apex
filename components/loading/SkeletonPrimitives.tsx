import { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import Card from "@/components/ui/Card";
import { useAppTheme } from "@/src/theme/useAppTheme";

function usePulse() {
  const opacity = useRef(new Animated.Value(0.52)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.86,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.52,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();

    return () => animation.stop();
  }, [opacity]);

  return opacity;
}

function makeStyles() {
  return StyleSheet.create({
    textBlock: {
      borderRadius: 999,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    rowTextWrap: {
      flex: 1,
      gap: 8,
    },
    cardInner: {
      gap: 10,
    },
  });
}

const AnimatedBlock = Animated.createAnimatedComponent(View);

export function SkeletonText({
  width = "100%",
  height = 12,
  style,
}: {
  width?: number | string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(), []);
  const opacity = usePulse();

  return (
    <AnimatedBlock
      style={[
        styles.textBlock,
        {
          width,
          height,
          backgroundColor: theme.colors.surfaceAlt,
          opacity,
        } as any,
        style,
      ]}
    />
  );
}

export function SkeletonRow({
  withAvatar = false,
  lines = 2,
}: {
  withAvatar?: boolean;
  lines?: number;
}) {
  const styles = useMemo(() => makeStyles(), []);

  return (
    <View style={styles.row}>
      {withAvatar ? <SkeletonText width={36} height={36} style={styles.avatar} /> : null}
      <View style={styles.rowTextWrap}>
        <SkeletonText width="58%" height={13} />
        {Array.from({ length: Math.max(1, lines - 1) }).map((_, index) => (
          <SkeletonText
            key={index}
            width={index === lines - 2 ? "72%" : "88%"}
            height={11}
          />
        ))}
      </View>
    </View>
  );
}

export function SkeletonCard({
  rows = 3,
  style,
}: {
  rows?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useMemo(() => makeStyles(), []);

  return (
    <Card style={style}>
      <View style={styles.cardInner}>
        <SkeletonText width="42%" height={15} />
        {Array.from({ length: rows }).map((_, index) => (
          <SkeletonRow key={index} withAvatar={index === 0} />
        ))}
      </View>
    </Card>
  );
}
