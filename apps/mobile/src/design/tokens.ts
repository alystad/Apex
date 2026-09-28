export const tokens = {
  radiusPill: 999,
  radiusButton: 22,
  minTap: 46,
  glassBg: "#000000",
  glassBorder: "rgba(255,255,255,0.2)",
  glassHighlight: "transparent",
  pressedScale: 0.985,
  buttonHeights: {
    sm: 38,
    md: 46,
    lg: 52,
  },
  buttonHPadding: {
    sm: 14,
    md: 16,
    lg: 18,
  },
  labelSize: 13,
  iconSize: 20,
  iconGap: 8,
} as const;

export type AppTokens = typeof tokens;
