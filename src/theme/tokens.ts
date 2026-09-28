import { StyleSheet } from "react-native";

import { appThemeColors } from "@/src/theme/colors";

export type ResolvedThemeMode = "light" | "dark";

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  0: 0,
  2: 2,
  4: 4,
  6: 6,
  8: 8,
  10: 10,
  12: 12,
  14: 14,
  16: 16,
  18: 18,
  20: 20,
  24: 24,
  28: 28,
  32: 32,
  36: 36,
  40: 40,
  44: 44,
  48: 48,
} as const;

export const radii = {
  sm: 12,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

export const fontSizes = {
  micro: 11,
  meta: 12,
  body: 14,
  subtitle: 18,
  section: 24,
  title: 28,
  display: 38,
} as const;

export const borderWidth = {
  hairline: StyleSheet.hairlineWidth,
  normal: 1,
  heavy: 2,
} as const;

export const themePalettes = {
  dark: {
    bg: appThemeColors.dark.background,
    surface: appThemeColors.dark.surface,
    surfaceAlt: appThemeColors.dark.surfaceAlt,
    card: appThemeColors.dark.card,
    cardElevated: appThemeColors.dark.cardElevated,
    border: appThemeColors.dark.border,
    borderSoft: appThemeColors.dark.borderSoft,
    textPrimary: appThemeColors.dark.textPrimary,
    textSecondary: appThemeColors.dark.textSecondary,
    textMuted: appThemeColors.dark.textMuted,
    accent: appThemeColors.dark.accent,
    accentStrong: appThemeColors.dark.accentStrong,
    success: appThemeColors.dark.success,
    warning: appThemeColors.dark.warning,
    danger: appThemeColors.dark.danger,
    chip: appThemeColors.dark.chip,
    glass: appThemeColors.dark.glass,
    glassStrong: appThemeColors.dark.glassStrong,
    edgeHighlight: appThemeColors.dark.edgeHighlight,
    ambientTop: appThemeColors.dark.ambientTop,
    ambientBottom: appThemeColors.dark.ambientBottom,
  },
  light: {
    bg: appThemeColors.light.background,
    surface: appThemeColors.light.surface,
    surfaceAlt: appThemeColors.light.surfaceAlt,
    card: appThemeColors.light.card,
    cardElevated: appThemeColors.light.cardElevated,
    border: appThemeColors.light.border,
    borderSoft: appThemeColors.light.borderSoft,
    textPrimary: appThemeColors.light.textPrimary,
    textSecondary: appThemeColors.light.textSecondary,
    textMuted: appThemeColors.light.textMuted,
    accent: appThemeColors.light.accent,
    accentStrong: appThemeColors.light.accentStrong,
    success: appThemeColors.light.success,
    warning: appThemeColors.light.warning,
    danger: appThemeColors.light.danger,
    chip: appThemeColors.light.chip,
    glass: appThemeColors.light.glass,
    glassStrong: appThemeColors.light.glassStrong,
    edgeHighlight: appThemeColors.light.edgeHighlight,
    ambientTop: appThemeColors.light.ambientTop,
    ambientBottom: appThemeColors.light.ambientBottom,
  },
} as const;

export type ThemePalette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  card: string;
  cardElevated: string;
  border: string;
  borderSoft: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentStrong: string;
  success: string;
  warning: string;
  danger: string;
  chip: string;
  glass: string;
  glassStrong: string;
  edgeHighlight: string;
  ambientTop: string;
  ambientBottom: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.startsWith("#") ? raw : `#${raw}`;
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mix(hexA: string, hexB: string, amount: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const weight = clamp(amount, 0, 1);
  const toHex = (value: number) =>
    Math.round(value).toString(16).padStart(2, "0");
  const r = a.r + (b.r - a.r) * weight;
  const g = a.g + (b.g - a.g) * weight;
  const bValue = a.b + (b.b - a.b) * weight;
  return `#${toHex(r)}${toHex(g)}${toHex(bValue)}`;
}

function getBrightness(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

export function createTeamThemePalette(
  primaryColor?: string,
  secondaryColor?: string,
): ThemePalette | null {
  const primary = normalizeHexColor(primaryColor);
  const secondary = normalizeHexColor(secondaryColor) ?? primary;
  if (!primary || !secondary) {
    return null;
  }

  const isDarkPalette = (getBrightness(primary) + getBrightness(secondary)) / 2 < 150;
  const textPrimary = isDarkPalette ? "#F8FAFC" : "#0B1220";
  const textSecondary = isDarkPalette ? "rgba(248,250,252,0.78)" : "rgba(11,18,32,0.72)";
  const textMuted = isDarkPalette ? "rgba(248,250,252,0.56)" : "rgba(11,18,32,0.52)";
  const borderBase = isDarkPalette ? "#FFFFFF" : "#0B1220";

  return {
    bg: secondary,
    surface: mix(secondary, primary, 0.18),
    surfaceAlt: mix(secondary, primary, 0.28),
    card: primary,
    cardElevated: mix(primary, isDarkPalette ? "#FFFFFF" : "#000000", isDarkPalette ? 0.08 : 0.06),
    border: rgba(borderBase, isDarkPalette ? 0.14 : 0.12),
    borderSoft: rgba(borderBase, isDarkPalette ? 0.09 : 0.08),
    textPrimary,
    textSecondary,
    textMuted,
    accent: mix(primary, isDarkPalette ? "#FFFFFF" : "#000000", isDarkPalette ? 0.22 : 0.18),
    accentStrong: mix(secondary, isDarkPalette ? "#FFFFFF" : "#000000", isDarkPalette ? 0.18 : 0.12),
    success: isDarkPalette ? "#72E6A7" : "#118A4C",
    warning: isDarkPalette ? "#F4D06F" : "#A96C00",
    danger: isDarkPalette ? "#FF9A9A" : "#C43C4C",
    chip: mix(primary, secondary, 0.16),
    glass: rgba(primary, 0.24),
    glassStrong: rgba(primary, 0.34),
    edgeHighlight: rgba(borderBase, isDarkPalette ? 0.2 : 0.16),
    ambientTop: rgba(primary, 0.16),
    ambientBottom: rgba(secondary, 0.16),
  };
}

export function createThemeTokens(
  mode: ResolvedThemeMode,
  paletteOverride?: ThemePalette,
) {
  const colors = paletteOverride ?? themePalettes[mode];

  return {
    colors,
    spacing,
    radius: radii,
    radii,
    fontSizes,
    borderWidth,
    type: {
      display: {
        fontSize: fontSizes.display,
        lineHeight: 42,
        fontWeight: "800" as const,
      },
      title: {
        fontSize: fontSizes.title,
        lineHeight: 32,
        fontWeight: "800" as const,
      },
      subtitle: {
        fontSize: fontSizes.subtitle,
        lineHeight: 24,
        fontWeight: "700" as const,
      },
      body: {
        fontSize: fontSizes.body,
        lineHeight: 20,
        fontWeight: "600" as const,
      },
      caption: {
        fontSize: fontSizes.meta,
        lineHeight: 16,
        fontWeight: "600" as const,
      },
      micro: {
        fontSize: fontSizes.micro,
        lineHeight: 14,
        fontWeight: "700" as const,
      },
    },
    controlHeights: {
      xs: 30,
      sm: 36,
      md: 44,
      lg: 48,
      xl: 56,
      fab: 68,
    },
    iconSizes: {
      sm: 14,
      md: 18,
      lg: 20,
    },
    cardPadding: {
      sm: 12,
      md: 16,
      lg: 20,
    },
    blur: {
      subtle: 16,
      medium: 28,
      strong: 42,
      overlay: 56,
    },
    liquidGlass: {
      baseTint: mode === "dark" ? "rgba(18, 24, 33, 0.2)" : "rgba(255, 255, 255, 0.2)",
      strongTint: mode === "dark" ? "rgba(18, 24, 33, 0.26)" : "rgba(255, 255, 255, 0.24)",
      specular: mode === "dark" ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.9)",
      innerGlow: mode === "dark" ? "rgba(255, 255, 255, 0.07)" : "rgba(255, 255, 255, 0.62)",
      rim: mode === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(255, 255, 255, 0.82)",
      innerRim: mode === "dark" ? "rgba(255, 255, 255, 0.05)" : "rgba(255, 255, 255, 0.54)",
      shadow: mode === "dark" ? "rgba(0, 0, 0, 0.32)" : "rgba(32, 43, 61, 0.08)",
      lensLight: mode === "dark" ? "rgba(190, 222, 255, 0.05)" : "rgba(255, 255, 255, 0.22)",
      edgeShade: mode === "dark" ? "rgba(6, 9, 12, 0.1)" : "rgba(178, 191, 213, 0.06)",
      activeGlow: mode === "dark" ? "rgba(255, 255, 255, 0.06)" : "rgba(255, 255, 255, 0.18)",
    },
    shadows: {
      card: {
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
        elevation: 4,
      },
      floating: {
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
        elevation: 4,
      },
      glow: {
        shadowColor: colors.accentStrong,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: mode === "dark" ? 0.14 : 0.08,
        shadowRadius: 24,
        elevation: 0,
      },
    },
    opacity: {
      pressed: 0.9,
      disabled: 0.5,
    },
  } as const;
}

export const tokens = createThemeTokens("dark");

export type ThemeTokens = ReturnType<typeof createThemeTokens>;
