export const darkTheme = {
  background: "#000000",
  surface: "#121212",
  surfaceAlt: "#121212",
  card: "#1D1D1D",
  cardElevated: "#1A1A1A",
  textPrimary: "#F5F5F5",
  textSecondary: "#A3A3A3",
  textMuted: "#6B7280",
  border: "rgba(255, 255, 255, 0.05)",
  borderSoft: "rgba(255, 255, 255, 0.05)",
  accent: "#3B82F6",
  accentStrong: "#3B82F6",
  success: "#67E3A2",
  warning: "#E1C57A",
  danger: "#FF8E98",
  chip: "#000000",
  glass: "#000000",
  glassStrong: "#000000",
  edgeHighlight: "rgba(255, 255, 255, 0.16)",
  ambientTop: "rgba(88, 180, 255, 0.12)",
  ambientBottom: "rgba(72, 212, 158, 0.08)",
} as const;

export const lightTheme = {
  background: "#000000",
  surface: "#121212",
  surfaceAlt: "#121212",
  card: "#1D1D1D",
  cardElevated: "#1A1A1A",
  textPrimary: "#F5F5F5",
  textSecondary: "#A3A3A3",
  textMuted: "#6B7280",
  border: "rgba(255, 255, 255, 0.05)",
  borderSoft: "rgba(255, 255, 255, 0.05)",
  accent: "#3B82F6",
  accentStrong: "#3B82F6",
  success: "#179C5D",
  warning: "#C1861B",
  danger: "#D94D5F",
  chip: "#000000",
  glass: "#000000",
  glassStrong: "#000000",
  edgeHighlight: "rgba(255, 255, 255, 0.9)",
  ambientTop: "rgba(66, 153, 225, 0.08)",
  ambientBottom: "rgba(39, 185, 122, 0.06)",
} as const;

export const appThemeColors = {
  dark: darkTheme,
  light: lightTheme,
} as const;

export type AppThemePalette = typeof darkTheme;
