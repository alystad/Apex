import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import type { BaseballBaseOccupancy } from "@/src/features/baseball/baseballTypes";
import { useAppTheme } from "@/src/theme/useAppTheme";

type BaseOccupancyDiamondProps = {
  bases?: BaseballBaseOccupancy | null;
  size?: number;
};

export default function BaseOccupancyDiamond({
  bases,
  size = 28,
}: BaseOccupancyDiamondProps) {
  const { tokens: theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
        },
        diamond: {
          width: size * 0.66,
          height: size * 0.66,
          transform: [{ rotate: "45deg" }],
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
        },
        base: {
          position: "absolute",
          width: Math.max(6, size * 0.22),
          height: Math.max(6, size * 0.22),
          borderRadius: 999,
          borderWidth: theme.borderWidth.normal,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.surfaceAlt,
        },
        active: {
          backgroundColor: theme.colors.accentStrong,
          borderColor: theme.colors.accentStrong,
        },
        first: {
          right: 0,
          top: "50%",
          marginTop: -(Math.max(6, size * 0.22) / 2),
        },
        second: {
          top: 0,
          left: "50%",
          marginLeft: -(Math.max(6, size * 0.22) / 2),
        },
        third: {
          left: 0,
          top: "50%",
          marginTop: -(Math.max(6, size * 0.22) / 2),
        },
      }),
    [size, theme],
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.diamond} />
      <View style={[styles.base, styles.first, bases?.first ? styles.active : null]} />
      <View style={[styles.base, styles.second, bases?.second ? styles.active : null]} />
      <View style={[styles.base, styles.third, bases?.third ? styles.active : null]} />
    </View>
  );
}
