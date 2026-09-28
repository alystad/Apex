import type { TextStyle } from "react-native";

/**
 * The Stock Market section's OWN design language — deliberately not the app's.
 *
 * Everywhere else Apex looks like a sports broadcast: glass pills, team-colored
 * rings, red/orange/yellow/green rating badges, fire glows. This section is a
 * trading app: pure black, almost no card chrome, one green and one red, and
 * price typography as the loudest thing on screen.
 *
 * That's why these are flat constants rather than `useAppTheme()` tokens — the
 * app's light/dark/team-color palettes must NOT leak in here, or a favorited
 * team's colors would repaint a screen whose whole point is that green means up
 * and red means down.
 */

export const marketColors = {
  /** Pure black page background — content sits directly on it. */
  bg: "#000000",
  /** Raised surfaces only where one is genuinely needed (trade sheet, modal). */
  sheet: "#141414",
  sheetElevated: "#1C1C1E",
  /** Hairline separators instead of card borders. */
  hairline: "rgba(255,255,255,0.09)",
  hairlineStrong: "rgba(255,255,255,0.16)",

  textPrimary: "#FFFFFF",
  textSecondary: "#A1A1AA",
  textMuted: "#6B7280",

  /** The only two semantic colors in this section. Gains up, losses down. */
  up: "#00C805",
  down: "#FF453A",
  /** Flat / unchanged / not-yet-priced. */
  flat: "#8E8E93",

  /** Neutral control fill (chips, secondary buttons). */
  control: "#1C1C1E",
  controlActive: "#FFFFFF",
  onControlActive: "#000000",
  /** Outline for the neutral "Sell" button. */
  outline: "rgba(255,255,255,0.32)",
  /** Disabled states. */
  disabled: "rgba(255,255,255,0.28)",
} as const;

export const marketSpacing = {
  2: 2,
  4: 4,
  6: 6,
  8: 8,
  10: 10,
  12: 12,
  16: 16,
  20: 20,
  24: 24,
  32: 32,
  40: 40,
  56: 56,
} as const;

export const marketRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * Tabular figures for EVERY numeric value in this section — prices, share
 * counts, dollar amounts, percentages — so digits line up vertically down a
 * list instead of jittering as values tick. Spread this into any numeric style.
 */
export const tabularNums: Pick<TextStyle, "fontVariant"> = {
  fontVariant: ["tabular-nums"],
};

export const marketType = {
  /** Player detail hero price. The dominant element on the screen. */
  heroPrice: {
    fontSize: 52,
    lineHeight: 60,
    fontWeight: "700" as const,
    letterSpacing: -1.2,
  },
  /** Portfolio total value. */
  bigValue: {
    fontSize: 44,
    lineHeight: 52,
    fontWeight: "700" as const,
    letterSpacing: -1,
  },
  /** Trade sheet running total. */
  mediumValue: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700" as const,
    letterSpacing: -0.6,
  },
  screenTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700" as const,
    letterSpacing: -0.4,
  },
  sectionTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700" as const,
    letterSpacing: -0.2,
  },
  rowPrimary: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "600" as const,
  },
  rowNumeric: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "600" as const,
  },
  rowSecondary: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "500" as const,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600" as const,
  },
  micro: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "600" as const,
  },
  button: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700" as const,
  },
} as const;

/** Below this magnitude a change reads as flat rather than green or red. */
const FLAT_EPSILON = 0.005;

/** The single up/down/flat color decision for the whole section. */
export function changeColor(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return marketColors.flat;
  }
  if (value > FLAT_EPSILON) {
    return marketColors.up;
  }
  if (value < -FLAT_EPSILON) {
    return marketColors.down;
  }
  return marketColors.flat;
}

export function isUp(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
