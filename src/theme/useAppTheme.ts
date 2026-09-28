import { DarkTheme, DefaultTheme, type Theme } from "@react-navigation/native";
import { useMemo } from "react";

import { useColorScheme } from "@/components/useColorScheme";
import { useProfileState } from "@/src/profile/ProfileContext";
import { useSettingsState } from "@/src/settings/SettingsContext";
import type { ThemeMode } from "@/src/settings/settingsTypes";
import {
  createTeamThemePalette,
  createThemeTokens,
  type ResolvedThemeMode,
  type ThemePalette,
  themePalettes,
} from "@/src/theme/tokens";

export function resolveThemeMode(
  mode: ThemeMode,
  systemColorScheme: ReturnType<typeof useColorScheme>,
): ResolvedThemeMode {
  if (mode === "light" || mode === "dark") {
    return mode;
  }
  return systemColorScheme === "light" ? "light" : "dark";
}

function buildNavigationTheme(
  resolvedMode: ResolvedThemeMode,
  colors: ThemePalette,
): Theme {
  const baseTheme = resolvedMode === "dark" ? DarkTheme : DefaultTheme;

  return {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: colors.bg,
      card: colors.card,
      text: colors.textPrimary,
      border: colors.border,
      primary: colors.accentStrong,
      notification: colors.danger,
    },
  };
}

export function useAppTheme() {
  const { state } = useSettingsState();
  const { state: profileState } = useProfileState();
  const systemColorScheme = useColorScheme();
  const resolvedThemeMode = resolveThemeMode(state.themeMode, systemColorScheme);

  return useMemo(() => {
    const teamPalette =
      state.themeMode === "team"
        ? createTeamThemePalette(
            profileState.profile.favoriteTeamTheme?.primaryColor,
            profileState.profile.favoriteTeamTheme?.secondaryColor,
          )
        : null;
    const palette = teamPalette ?? themePalettes[resolvedThemeMode];
    const effectiveResolvedMode =
      state.themeMode === "team"
        ? ((palette.textPrimary === "#F8FAFC" ? "dark" : "light") as ResolvedThemeMode)
        : resolvedThemeMode;
    const themeTokens = createThemeTokens(effectiveResolvedMode, palette);

    return {
      themeMode: state.themeMode,
      resolvedThemeMode: effectiveResolvedMode,
      isDark: effectiveResolvedMode === "dark",
      colors: palette,
      tokens: themeTokens,
      navigationTheme: buildNavigationTheme(
        effectiveResolvedMode,
        palette,
      ),
    };
  }, [
    profileState.profile.favoriteTeamTheme?.primaryColor,
    profileState.profile.favoriteTeamTheme?.secondaryColor,
    resolvedThemeMode,
    state.themeMode,
  ]);
}
