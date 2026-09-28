import { useMemo } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import BaseballFieldOutline from "@/components/BaseballFieldOutline";
import type { MultiViewDensity } from "@/src/multiview/layoutConstants";
import type { ThemeTokens } from "@/src/theme/tokens";
import { useAppTheme } from "@/src/theme/useAppTheme";

type MiniCourtViewProps = {
  sport: "basketball" | "baseball";
  density: MultiViewDensity;
  style?: StyleProp<ViewStyle>;
};

function makeStyles(theme: ThemeTokens, isDark: boolean) {
  return StyleSheet.create({
    shell: {
      width: "100%",
      aspectRatio: 1.76,
      borderRadius: theme.radius.lg,
      overflow: "hidden",
      backgroundColor: isDark ? "rgba(8, 14, 24, 0.84)" : "rgba(242, 246, 251, 0.96)",
    },
    basketballShell: {
      flex: 1,
      backgroundColor: isDark ? "rgba(36, 30, 21, 0.94)" : "rgba(214, 179, 122, 0.94)",
    },
  });
}

export default function MiniCourtView({ sport, density, style }: MiniCourtViewProps) {
  const { tokens: theme, isDark } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme, isDark), [isDark, theme]);
  const stroke =
    density === "compact"
      ? isDark
        ? "rgba(236, 240, 245, 0.28)"
        : "rgba(28, 28, 28, 0.34)"
      : isDark
        ? "rgba(236, 240, 245, 0.34)"
        : "rgba(28, 28, 28, 0.46)";
  const centerFill =
    density === "compact"
      ? isDark
        ? "rgba(255,255,255,0.05)"
        : "rgba(255,255,255,0.14)"
      : isDark
        ? "rgba(255,255,255,0.08)"
        : "rgba(255,255,255,0.22)";

  if (sport === "baseball") {
    if (density === "compact") {
      return (
        <View style={[styles.shell, style]}>
          <Svg width="100%" height="100%" viewBox="0 0 320 182">
            <Rect x="1.5" y="1.5" width="317" height="179" rx="12" fill="transparent" stroke={stroke} strokeWidth="2" />
            <Path d="M160 148 L120 108 L160 68 L200 108 Z" fill="transparent" stroke={stroke} strokeWidth="2" />
            <Circle cx="160" cy="108" r="8" fill="transparent" stroke={stroke} strokeWidth="2" />
            <Path d="M160 148 L72 60" stroke={stroke} strokeWidth="2" />
            <Path d="M160 148 L248 60" stroke={stroke} strokeWidth="2" />
          </Svg>
        </View>
      );
    }
    return (
      <View style={[styles.shell, style]}>
        <BaseballFieldOutline style={{ flex: 1, borderRadius: 0 }} />
      </View>
    );
  }

  return (
    <View style={[styles.shell, styles.basketballShell, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 320 182">
        <Rect x="1.5" y="1.5" width="317" height="179" rx="10" fill="transparent" stroke={stroke} strokeWidth="2" />
        <Lineup stroke={stroke} centerFill={centerFill} compact={density === "compact"} />
      </Svg>
    </View>
  );
}

function Lineup({
  stroke,
  centerFill,
  compact,
}: {
  stroke: string;
  centerFill: string;
  compact: boolean;
}) {
  return (
    <>
      <Path d="M160 2 L160 180" stroke={stroke} strokeWidth="2" />
      <Circle cx="160" cy="91" r="22" stroke={stroke} strokeWidth="2" fill={centerFill} />

      <Rect x="1.5" y="58" width="52" height="66" stroke={stroke} strokeWidth={compact ? "1.5" : "2"} fill="transparent" />
      <Rect x="266.5" y="58" width="52" height="66" stroke={stroke} strokeWidth={compact ? "1.5" : "2"} fill="transparent" />

      {!compact ? (
        <>
          <Path d="M54 73 A26 26 0 0 0 54 109" stroke={stroke} strokeWidth="2" fill="transparent" />
          <Path d="M266 73 A26 26 0 0 1 266 109" stroke={stroke} strokeWidth="2" fill="transparent" />

          <Circle cx="47" cy="91" r="5" stroke={stroke} strokeWidth="2" fill="transparent" />
          <Circle cx="273" cy="91" r="5" stroke={stroke} strokeWidth="2" fill="transparent" />
        </>
      ) : null}
    </>
  );
}
