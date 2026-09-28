import FontAwesome from "@expo/vector-icons/FontAwesome";
import { ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { Stack, useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import FloatingTeamSearchButton from "@/components/FloatingTeamSearchButton";
import AppLoader from "@/components/loading/AppLoader";
import TeamSearchModal from "@/components/TeamSearchModal";
import { LiveGameProvider } from "@/hooks/useLiveGame";
import { GameCardOriginProvider } from "@/src/navigation/GameCardOriginContext";
import {
  ConferenceFilterProvider,
  useConferenceFilterState,
} from "@/src/conferences/ConferenceFilterContext";
import { LoadingProvider } from "@/src/loading/LoadingContext";
import { GameModeProvider, useGameModeState } from "@/src/mode/GameModeContext";
import { MultiViewProvider, useMultiViewState } from "@/src/multiview/MultiViewContext";
import { ProfileProvider, useProfileState } from "@/src/profile/ProfileContext";
import { SettingsProvider, useSettingsState } from "@/src/settings/SettingsContext";
import { useAppTheme } from "@/src/theme/useAppTheme";
// import { openInGameCommentsOverlay } from "@/src/ui/inGameCommentsOverlayEvents"; // restore with comment button

export {
  ErrorBoundary,
} from "expo-router";

export const unstable_settings = {
  initialRouteName: "live-games",
};

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <LoadingProvider>
        <SettingsProvider>
          <GameModeProvider>
            <ConferenceFilterProvider>
              <ProfileProvider>
                <MultiViewProvider>
                  <GameCardOriginProvider>
                    <LiveGameProvider>
                      <RootLayoutNav />
                    </LiveGameProvider>
                  </GameCardOriginProvider>
                </MultiViewProvider>
              </ProfileProvider>
            </ConferenceFilterProvider>
          </GameModeProvider>
        </SettingsProvider>
      </LoadingProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutNav() {
  const { isHydrated } = useSettingsState();
  const { mode, isHydrated: isGameModeHydrated } = useGameModeState();
  const { isHydrated: isConferenceFilterHydrated } = useConferenceFilterState();
  const { isHydrated: isProfileHydrated } = useProfileState();
  const { isHydrated: isMultiViewHydrated } = useMultiViewState();
  const { navigationTheme, tokens: theme } = useAppTheme();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ favorites?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const [isTeamSearchOpen, setIsTeamSearchOpen] = useState(false);
  const ready =
    isHydrated &&
    isGameModeHydrated &&
    isConferenceFilterHydrated &&
    isProfileHydrated &&
    isMultiViewHydrated;

  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync();
    }
  }, [ready]);

  const favoritesParam = Array.isArray(params.favorites)
    ? params.favorites[0]
    : params.favorites;
  const isInGameRoute =
    pathname === "/betting" ||
    pathname === "/live" ||
    pathname === "/team-stats" ||
    pathname === "/comments" ||
    pathname === "/playbyplay" ||
    pathname === "/preview";
  const showFloatingButton = pathname === "/live-games" || isInGameRoute;

  if (!ready) {
    return <AppLoader title="Starting up" subtitle="Restoring your app state." />;
  }

  return (
    <ThemeProvider value={navigationTheme}>
      <View style={styles.flex}>
        <Stack>
          <Stack.Screen
            name="live-games"
            // Root/Home screen — initialRouteName above, and nothing is ever
            // pushed BEFORE it in this stack (every navigation that targets
            // "/live-games" uses router.replace or <Redirect>, both
            // replace-semantics — see app/index.tsx, app/multiview.tsx,
            // components/FloatingTeamSearchButton.tsx). Edge-swipe-back
            // has no screen underneath it to reveal, so it should never be
            // enabled here; without this it was inheriting the native
            // stack's default (true on iOS).
            options={{ headerShown: false, animation: "none", gestureEnabled: false }}
          />
          <Stack.Screen
            name="multiview"
            options={{ headerShown: false, animation: "slide_from_right" }}
          />
          <Stack.Screen
            name="(tabs)"
            options={{ headerShown: false, animation: "slide_from_right" }}
          />
          <Stack.Screen
            name="settings"
            options={{ headerShown: false, animation: "slide_from_right" }}
          />
          <Stack.Screen
            name="in-game-edit"
            options={{ headerShown: false, animation: "slide_from_right" }}
          />
          <Stack.Screen
            name="profile"
            options={{ headerShown: false, animation: "slide_from_right" }}
          />
          <Stack.Screen
            name="stock-market"
            options={{ headerShown: false, animation: "slide_from_right" }}
          />
          <Stack.Screen
            name="player/[playerId]"
            options={{ headerShown: false, animation: "slide_from_right" }}
          />
          <Stack.Screen name="match/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: "modal" }} />
        </Stack>
        {showFloatingButton && !isInGameRoute ? (
          <View pointerEvents="box-none" style={styles.globalFloatingLayer}>
            <FloatingTeamSearchButton
              onPress={() => {
                setIsTeamSearchOpen(true);
              }}
              activeMode={mode}
              favoritesSelected={favoritesParam === "1"}
              showCompanion={false}
              primaryIcon="search"
              accessibilityLabel="Search teams"
              bottomOffset={Math.max(insets.bottom - theme.spacing[18], -theme.spacing[14])}
            />
          </View>
        ) : null}
        {/* In-game floating comment button temporarily removed:
        {showFloatingButton && isInGameRoute ? (
          <View pointerEvents="box-none" style={styles.globalFloatingLayer}>
            <FloatingTeamSearchButton
              onPress={() => { openInGameCommentsOverlay(); }}
              activeMode={mode}
              favoritesSelected={false}
              showCompanion={false}
              primaryIcon="comments"
              accessibilityLabel="Open comments"
              bottomOffset={Math.max(insets.bottom - theme.spacing[18], -theme.spacing[14])}
            />
          </View>
        ) : null}
        */}
        <TeamSearchModal
          visible={isTeamSearchOpen}
          onClose={() => setIsTeamSearchOpen(false)}
        />
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  globalFloatingLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    elevation: 100,
  },
});
