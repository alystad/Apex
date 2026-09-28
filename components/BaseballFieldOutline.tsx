import { useMemo } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import { FIELD_SPOTS } from "@/src/features/baseball/fieldLayout";
import { useAppTheme } from "@/src/theme/useAppTheme";

type BaseballFieldOutlineVariant = "default" | "game";

type BaseballFieldOutlineProps = {
  style?: StyleProp<ViewStyle>;
  variant?: BaseballFieldOutlineVariant;
};

export default function BaseballFieldOutline({
  style,
  variant = "default",
}: BaseballFieldOutlineProps) {
  const { tokens: theme, isDark } = useAppTheme();
  const isGameVariant = variant === "game";
  const styles = useMemo(
    () =>
      StyleSheet.create({
        shell: {
          width: "100%",
          aspectRatio: isGameVariant ? 1 : 1.28,
          borderRadius: theme.radius.xl,
          overflow: "hidden",
          backgroundColor: isGameVariant
            ? isDark
              ? "#285f2d"
              : "#3f8f43"
            : isDark
              ? "rgba(8, 14, 24, 0.92)"
              : "rgba(241, 246, 251, 0.94)",
        },
      }),
    [isDark, isGameVariant, theme],
  );

  if (isGameVariant) {
    const grass = isDark ? "#3b8340" : "#469545";
    const dirt = isDark ? "#b88755" : "#ca995f";
    const line = "#f3f6f8";
    const outline = isDark ? "rgba(6, 10, 7, 0.86)" : "rgba(14, 24, 15, 0.88)";
    const viewSize = 1000;
    const toCoord = (pct: number) => (pct / 100) * viewSize;
    const homeX = toCoord(FIELD_SPOTS.BATTER.xPct);
    const homeY = toCoord((FIELD_SPOTS.BATTER.yPct + FIELD_SPOTS.C.yPct) / 2);
    const catcherX = toCoord(FIELD_SPOTS.C.xPct);
    const catcherY = toCoord(FIELD_SPOTS.C.yPct);
    const pitcherX = toCoord(FIELD_SPOTS.P.xPct);
    const pitcherY = toCoord(FIELD_SPOTS.P.yPct);
    const firstX = toCoord(FIELD_SPOTS.BASE1.xPct);
    const firstY = toCoord(FIELD_SPOTS.BASE1.yPct);
    const secondX = toCoord(FIELD_SPOTS.BASE2.xPct);
    const secondY = toCoord(FIELD_SPOTS.BASE2.yPct);
    const thirdX = toCoord(FIELD_SPOTS.BASE3.xPct);
    const thirdY = toCoord(FIELD_SPOTS.BASE3.yPct);

    const foulExtend = 2;
    const foulLeftX = homeX + (thirdX - homeX) * foulExtend;
    const foulLeftY = homeY + (thirdY - homeY) * foulExtend;
    const foulRightX = homeX + (firstX - homeX) * foulExtend;
    const foulRightY = homeY + (firstY - homeY) * foulExtend;

    const centerFieldY = toCoord(FIELD_SPOTS.CF.yPct);
    const halfChord = Math.abs(foulRightX - foulLeftX) / 2;
    const foulMidY = (foulLeftY + foulRightY) / 2;
    // Keep the fence arc visually above LF/CF/RF markers.
    const desiredFenceTopY = Math.max(500, Math.min(centerFieldY - 48, foulMidY - 160));
    const sagitta = Math.max(80, foulMidY - desiredFenceTopY);
    const fenceRadius = (halfChord * halfChord + sagitta * sagitta) / (2 * sagitta);

    const infieldRadius = Math.hypot(secondX - homeX, secondY - homeY) + 34;
    const baseSize = 26;

    return (
      <View style={[styles.shell, style]}>
        <Svg width="100%" height="100%" viewBox="0 0 1000 1000">
          <Path
            d={`M ${homeX} ${homeY} L ${foulLeftX} ${foulLeftY} A ${fenceRadius} ${fenceRadius} 0 0 1 ${foulRightX} ${foulRightY} Z`}
            fill={grass}
            stroke={outline}
            strokeWidth="8"
          />

          <Path
            d={`M ${homeX} ${homeY} L ${thirdX} ${thirdY} A ${infieldRadius} ${infieldRadius} 0 0 1 ${firstX} ${firstY} Z`}
            fill={dirt}
          />

          <Path
            d={`M ${homeX} ${homeY} L ${thirdX} ${thirdY} L ${secondX} ${secondY} L ${firstX} ${firstY} Z`}
            fill="none"
            stroke={dirt}
            strokeWidth="96"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <Path
            d={`M ${homeX} ${homeY} L ${thirdX} ${thirdY} L ${secondX} ${secondY} L ${firstX} ${firstY} Z`}
            fill={grass}
          />
          <Path
            d={`M ${homeX} ${homeY} L ${thirdX} ${thirdY} L ${secondX} ${secondY} L ${firstX} ${firstY} Z`}
            fill="none"
            stroke={line}
            strokeWidth="7"
            strokeLinejoin="round"
          />

          <Line x1={homeX} y1={homeY} x2={foulLeftX} y2={foulLeftY} stroke={line} strokeWidth="6" />
          <Line x1={homeX} y1={homeY} x2={foulRightX} y2={foulRightY} stroke={line} strokeWidth="6" />
          <Path d={`M ${foulLeftX} ${foulLeftY} A ${fenceRadius} ${fenceRadius} 0 0 1 ${foulRightX} ${foulRightY}`} fill="none" stroke={line} strokeWidth="4" />

          <Rect
            x={thirdX - baseSize / 2}
            y={thirdY - baseSize / 2}
            width={baseSize}
            height={baseSize}
            fill={line}
            transform={`rotate(45 ${thirdX} ${thirdY})`}
          />
          <Rect
            x={secondX - baseSize / 2}
            y={secondY - baseSize / 2}
            width={baseSize}
            height={baseSize}
            fill={line}
            transform={`rotate(45 ${secondX} ${secondY})`}
          />
          <Rect
            x={firstX - baseSize / 2}
            y={firstY - baseSize / 2}
            width={baseSize}
            height={baseSize}
            fill={line}
            transform={`rotate(45 ${firstX} ${firstY})`}
          />

          <Path
            d={`M ${homeX} ${homeY - 22} L ${homeX + 20} ${homeY - 2} L ${homeX + 10} ${homeY + 26} L ${homeX - 10} ${homeY + 26} L ${homeX - 20} ${homeY - 2} Z`}
            fill={line}
          />

          <Circle cx={pitcherX} cy={pitcherY} r="48" fill={dirt} />
          <Rect x={pitcherX - 14} y={pitcherY - 6} width="28" height="12" rx="2" fill={line} />

          <Rect
            x={homeX - 62}
            y={homeY - 58}
            width="26"
            height="84"
            fill="none"
            stroke={line}
            strokeWidth="4"
          />
          <Rect
            x={homeX + 36}
            y={homeY - 58}
            width="26"
            height="84"
            fill="none"
            stroke={line}
            strokeWidth="4"
          />
          <Rect x={homeX - 13} y={homeY + 24} width="26" height="44" fill="none" stroke={line} strokeWidth="4" />

          <Circle cx={homeX - 222} cy={homeY + 20} r="22" fill={dirt} stroke={outline} strokeWidth="4" />
          <Circle cx={homeX + 222} cy={homeY + 20} r="22" fill={dirt} stroke={outline} strokeWidth="4" />

          <Circle cx={catcherX} cy={catcherY} r="9" fill={line} opacity={0.8} />
        </Svg>
      </View>
    );
  }

  const stroke = isDark ? "rgba(210,224,244,0.3)" : "rgba(48,82,124,0.18)";
  const fill = isDark ? "rgba(70,118,82,0.14)" : "rgba(123,181,126,0.12)";
  const dirt = isDark ? "rgba(180,126,84,0.18)" : "rgba(188,132,84,0.16)";

  return (
    <View style={[styles.shell, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 320 250">
        <Rect x="0" y="0" width="320" height="250" fill="transparent" />
        <Path
          d="M160 212 L62 114 A138 138 0 0 1 258 114 Z"
          fill={fill}
          stroke={stroke}
          strokeWidth="2"
        />
        <Path
          d="M160 212 L112 164 L160 116 L208 164 Z"
          fill={dirt}
          stroke={stroke}
          strokeWidth="2"
        />
        <Path d="M160 212 L42 94" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
        <Path d="M160 212 L278 94" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
        <Circle cx="160" cy="164" r="11" fill="transparent" stroke={stroke} strokeWidth="2" />
        <Rect x="106" y="158" width="12" height="12" transform="rotate(45 112 164)" fill={fill} stroke={stroke} strokeWidth="1.8" />
        <Rect x="154" y="110" width="12" height="12" transform="rotate(45 160 116)" fill={fill} stroke={stroke} strokeWidth="1.8" />
        <Rect x="202" y="158" width="12" height="12" transform="rotate(45 208 164)" fill={fill} stroke={stroke} strokeWidth="1.8" />
        <Path
          d="M152 212 L160 204 L168 212 L168 220 L152 220 Z"
          fill={dirt}
          stroke={stroke}
          strokeWidth="1.8"
        />
        <Path
          d="M70 112 A126 126 0 0 1 250 112"
          fill="transparent"
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}
