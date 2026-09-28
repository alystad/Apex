import {
  createMaterialTopTabNavigator,
  MaterialTopTabBar,
  type MaterialTopTabNavigationEventMap,
  type MaterialTopTabNavigationOptions,
  type MaterialTopTabBarProps,
} from "@react-navigation/material-top-tabs";
import type { ParamListBase, TabNavigationState } from "@react-navigation/native";
import { router, useLocalSearchParams, usePathname, withLayoutContext } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated as RNAnimated, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import InGameCommentsPanel from "@/components/InGameCommentsPanel";
import InlineGameErrorBanner from "@/components/loading/InlineGameErrorBanner";
import PlayerModal from "@/components/PlayerModal";
import StickyScoreHeader from "@/components/ui/StickyScoreHeader";
import {
  IN_GAME_HEADER_COLLAPSE_DISTANCE,
  getStickyHeaderExpandedHeight,
  IN_GAME_HEADER_COLLAPSE_RANGE,
} from "@/components/ui/inGameHeaderMetrics";
import { useLiveGame } from "@/hooks/useLiveGame";
import { AiGameSummaryProvider } from "@/src/features/summary/aiGameSummary";
import { useSettingsState } from "@/src/settings/SettingsContext";
import { useAppTheme } from "@/src/theme/useAppTheme";
import {
  InGameTabNavigationProvider,
} from "@/src/ui/inGameTabNavigationContext";
import {
  BASE_IN_GAME_TAB_ITEMS,
  PREVIEW_TAB_ITEM,
  getActiveInGameTab,
  getVisibleInGameTabItems,
  type InGameTabItem,
} from "@/src/ui/inGameTabs";
import { getGameStoryPhase, getGameStoryTabLabel } from "@/src/ui/gameStoryTab";
import { InGameHeaderScrollProvider } from "@/src/ui/inGameHeaderScrollContext";
import { useInGameHeaderScroll } from "@/src/ui/inGameHeaderScrollContext";
import { subscribeToInGameCommentsOverlay } from "@/src/ui/inGameCommentsOverlayEvents";
import {
  InGamePlayerModalProvider,
  useInGamePlayerModal,
} from "@/src/ui/inGamePlayerModalContext";
import { InGameSectionRegistryProvider } from "@/src/ui/inGameSectionRegistryContext";
import {
  InGameExitTransitionProvider,
  useInGameExitTransition,
} from "@/src/ui/inGameExitTransitionContext";

const MaterialTopTabs = createMaterialTopTabNavigator();
type RuntimeInGameTabItem = Omit<InGameTabItem, "key"> & {
  key: InGameTabItem["key"] | "preview";
};
// Live game tab order: Plays | Court | Stats | Live | Odds. Plays leads (and
// is the live default landing tab — see `defaultTab` below) instead of the
// story tab, which drops to the 4th slot here. This is the one game state
// where the story tab does NOT lead — pregame and final both still prepend
// it via `withStoryTabFirst` below, so this order is built explicitly rather
// than through that helper. Keys, not labels: playbyplay=Plays, live=Court,
// team-stats=Stats, betting=Odds; the story tab is spliced in separately.
const LIVE_TAB_KEYS_AROUND_STORY_TAB = {
  before: ["playbyplay", "live", "team-stats"],
  after: ["betting"],
} as const;
// Final game: story tab (Recap) | Court | Stats | Plays | Odds, and nothing
// else. There's deliberately no Summary tab — that content already sits at
// the top of Plays.
const FINAL_TAB_ORDER = ["live", "team-stats", "playbyplay", "betting"] as const;
const COMMENTS_DEFAULT_FRACTION = 0.6;
const COMMENTS_EXPANDED_FRACTION = 1;

const ExpoRouterMaterialTopTabs = withLayoutContext<
  MaterialTopTabNavigationOptions,
  typeof MaterialTopTabs.Navigator,
  TabNavigationState<ParamListBase>,
  MaterialTopTabNavigationEventMap
>(MaterialTopTabs.Navigator);

function SharedInGameHeader() {
  const { data } = useLiveGame();
  const { sharedHeaderScrollY } = useInGameHeaderScroll();

  return <StickyScoreHeader data={data} scrollY={sharedHeaderScrollY} />;
}

function TabBarPropsCapture({
  props,
  onChange,
}: {
  props: MaterialTopTabBarProps;
  onChange: (props: MaterialTopTabBarProps) => void;
}) {
  const latestPropsRef = useRef(props);
  latestPropsRef.current = props;
  const signature = useMemo(
    () => [props.state.index, ...props.state.routes.map((route) => route.key)].join("|"),
    [props.state.index, props.state.routes],
  );

  useEffect(() => {
    onChange(latestPropsRef.current);
  }, [onChange, signature]);

  return null;
}

// expo-router (via withLayoutContext) auto-registers every file in this
// directory as a tab screen, even the ones we never list explicitly. That means
// the navigator's route list always contains ALL in-game screens, so the tab
// bar would show them all. Restrict + reorder the routes handed to the tab bar
// down to the tabs we actually want for the current game state (e.g. only
// Preview / Court / Odds before tip-off).
function useFilteredTabBarProps(
  props: MaterialTopTabBarProps,
  allowedKeys: readonly string[],
): MaterialTopTabBarProps {
  return useMemo(() => {
    const orderedRoutes = allowedKeys
      .map((key) => props.state.routes.find((route) => route.name === key))
      .filter((route): route is (typeof props.state.routes)[number] => Boolean(route));

    const isUnchanged =
      orderedRoutes.length === props.state.routes.length &&
      orderedRoutes.every((route, index) => route === props.state.routes[index]);
    if (isUnchanged) {
      return props;
    }

    const activeRoute = props.state.routes[props.state.index];
    const nextIndex = Math.max(
      0,
      orderedRoutes.findIndex((route) => route.key === activeRoute?.key),
    );

    return {
      ...props,
      state: {
        ...props.state,
        routes: orderedRoutes,
        routeNames: orderedRoutes.map((route) => route.name),
        index: nextIndex,
      },
    };
  }, [allowedKeys, props]);
}

function FloatingCollapsingTabBar({
  tabBarTop,
  props,
  allowedKeys,
}: {
  tabBarTop: number;
  props: MaterialTopTabBarProps;
  allowedKeys: readonly string[];
}) {
  const { sharedHeaderScrollY } = useInGameHeaderScroll();
  const filteredProps = useFilteredTabBarProps(props, allowedKeys);
  const animatedTabBarStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      sharedHeaderScrollY.value,
      IN_GAME_HEADER_COLLAPSE_RANGE,
      [0, -IN_GAME_HEADER_COLLAPSE_DISTANCE],
      Extrapolation.CLAMP,
    );

    return {
      transform: [{ translateY }],
    };
  }, [sharedHeaderScrollY]);

  return (
    <Animated.View style={[styles.tabBarOverlay, { top: tabBarTop }, animatedTabBarStyle]}>
      <MaterialTopTabBar {...filteredProps} />
    </Animated.View>
  );
}

function HiddenMaterialTopTabBar({
  tabBarTop,
  ...props
}: MaterialTopTabBarProps & { tabBarTop: number }) {
  return <View pointerEvents="none" style={styles.hiddenTabBarMount} />;
}

function InGameCommentsBottomSheet({
  enabled,
  sheetFraction,
  screenHeight,
  onCollapse,
  onExpand,
}: {
  enabled: boolean;
  sheetFraction: SharedValue<number>;
  screenHeight: number;
  onCollapse: () => void;
  onExpand: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  const panStartFraction = useSharedValue(COMMENTS_DEFAULT_FRACTION);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          panStartFraction.value = sheetFraction.value;
        })
        .onUpdate((event) => {
          const nextFraction =
            panStartFraction.value - event.translationY / Math.max(1, screenHeight);
          sheetFraction.value = Math.min(
            COMMENTS_EXPANDED_FRACTION,
            Math.max(COMMENTS_DEFAULT_FRACTION, nextFraction),
          );
        })
        .onEnd((event) => {
          const shouldExpand =
            sheetFraction.value > 0.78 || event.velocityY < -700;
          sheetFraction.value = withTiming(
            shouldExpand ? COMMENTS_EXPANDED_FRACTION : COMMENTS_DEFAULT_FRACTION,
            { duration: 180 },
          );
        }),
    [panStartFraction, screenHeight, sheetFraction],
  );

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    height: screenHeight * sheetFraction.value,
  }));

  return (
    <Animated.View
      style={[
        styles.commentsDock,
        {
          backgroundColor: theme.colors.cardElevated,
          borderColor: theme.colors.borderSoft,
        },
        sheetAnimatedStyle,
      ]}
    >
      <GestureDetector gesture={panGesture}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Collapse comments"
          onPress={onCollapse}
          style={styles.commentsDragArea}
        >
          <View
            style={[
              styles.commentsDragHandle,
              { backgroundColor: theme.colors.textMuted },
            ]}
          />
        </Pressable>
      </GestureDetector>
      {enabled ? (
        <InGameCommentsPanel
          enabled={enabled}
          onPullPastTop={onCollapse}
          onScrollAwayFromTop={onExpand}
          onScrollTowardTopAtTop={onCollapse}
        />
      ) : null}
    </Animated.View>
  );
}

function InGameContentShell({
  sheetFraction,
  screenHeight,
  children,
}: {
  sheetFraction: SharedValue<number>;
  screenHeight: number;
  children: ReactNode;
}) {
  const gamePaneAnimatedStyle = useAnimatedStyle(() => ({
    height: screenHeight * Math.max(0, 1 - sheetFraction.value),
  }));

  return (
    <Animated.View style={[styles.gameResizePane, gamePaneAnimatedStyle]}>
      {children}
    </Animated.View>
  );
}

function InGameCommentsSheetHost({
  visible,
  sheetFraction,
  screenHeight,
  onCollapse,
  onExpand,
}: {
  visible: boolean;
  sheetFraction: SharedValue<number>;
  screenHeight: number;
  onCollapse: () => void;
  onExpand: () => void;
}) {
  return (
    <InGameCommentsBottomSheet
      enabled={visible}
      sheetFraction={sheetFraction}
      screenHeight={screenHeight}
      onCollapse={onCollapse}
      onExpand={onExpand}
    />
  );
}

export default function InGameTabsLayout() {
  const params = useLocalSearchParams<{
    gameId?: string | string[];
    origin?: string | string[];
  }>();
  const routeGameId = Array.isArray(params.gameId) ? params.gameId[0] : params.gameId;
  const originSource = Array.isArray(params.origin) ? params.origin[0] : params.origin;

  return (
    <InGameHeaderScrollProvider>
      <InGamePlayerModalProvider>
        <InGameSectionRegistryProvider>
          <InGameExitTransitionProvider
            gameId={routeGameId ?? ""}
            originSource={originSource}
            onDismiss={() => {
              router.back();
            }}
          >
            <AiGameSummaryProvider>
              <InGameTabsLayoutContent />
            </AiGameSummaryProvider>
          </InGameExitTransitionProvider>
        </InGameSectionRegistryProvider>
      </InGamePlayerModalProvider>
    </InGameHeaderScrollProvider>
  );
}

function InGameTabsLayoutContent() {
  const { state } = useSettingsState();
  const { tokens: theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const { mode, data, error, gameId, refresh } = useLiveGame();
  const pathname = usePathname();
  const navigatorRef = useRef<{ navigate: (name: string) => void } | null>(null);
  // Which gameId we've already reset to the story tab for, so the reset fires
  // once per game opened rather than on every render or status change.
  const storyTabResetGameIdRef = useRef<string | null>(null);
  const { translateLayerStyle, cardLayerStyle } = useInGameExitTransition();
  // Single shared PlayerModal instance for every in-game tab — see its JSX
  // usage below for why this replaced one instance per tab.
  const { selectedPlayer, isPlayerModalOpen, initialChartMode, closePlayerModal } =
    useInGamePlayerModal();
  const [capturedTabBarProps, setCapturedTabBarProps] = useState<MaterialTopTabBarProps | null>(null);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const commentsSheetFraction = useSharedValue(0);
  const tabBarHeight = theme.controlHeights.md + theme.spacing[12];
  const tabBarTop = getStickyHeaderExpandedHeight(insets.top) - tabBarHeight;
  const gameState = (data?.status?.state ?? "").toLowerCase();
  // Derived from the SAME phase helper the story tab's screen uses, so the
  // tab set/label and the content that tab renders always agree — including
  // for the feed's alternate spellings ("final"/"complete", "live").
  const storyPhase = getGameStoryPhase(gameState);
  const isLiveGame = storyPhase === "live";
  const isPreGame = storyPhase === "preview";
  const isFinalGame = storyPhase === "recap";
  // The story tab: one persistent tab in the FIRST position across every game
  // state, relabelled Preview → Live → Recap as the game progresses. It owns
  // the `preview` route key (see src/ui/gameStoryTab.ts for why that key is
  // kept), and app/(tabs)/preview.tsx swaps its own content off the same
  // phase helper, so label and content can't disagree.
  const storyTab = useMemo<RuntimeInGameTabItem>(
    () => ({ ...PREVIEW_TAB_ITEM, label: getGameStoryTabLabel(gameState) }),
    [gameState],
  );
  const visibleTabs = useMemo<RuntimeInGameTabItem[]>(() => {
    const findTabs = (keys: readonly string[]): RuntimeInGameTabItem[] =>
      keys
        .map((key) => BASE_IN_GAME_TAB_ITEMS.find((entry) => entry.key === key))
        .filter((item): item is RuntimeInGameTabItem => Boolean(item));

    const withStoryTabFirst = (keys: readonly string[]): RuntimeInGameTabItem[] => [
      storyTab,
      ...findTabs(keys),
    ];

    // Final game: Recap | Court | Stats | Plays | Odds.
    if (isFinalGame) {
      return withStoryTabFirst(FINAL_TAB_ORDER);
    }

    // Live game: Plays | Court | Stats | Live | Odds. The one game state
    // where the story tab does NOT lead — it's spliced in as the 4th tab
    // instead, so this can't go through withStoryTabFirst.
    if (isLiveGame) {
      return [
        ...findTabs(LIVE_TAB_KEYS_AROUND_STORY_TAB.before),
        storyTab,
        ...findTabs(LIVE_TAB_KEYS_AROUND_STORY_TAB.after),
      ];
    }

    // Before tip-off: Preview | Court | Odds.
    if (isPreGame) {
      return withStoryTabFirst(["live", "betting"]);
    }

    // Unknown state (no status yet): user's configured layout, with the story
    // tab still pinned first so the landing tab is consistent everywhere.
    const baseTabs = getVisibleInGameTabItems(state, mode).filter(
      (item) => item.key !== PREVIEW_TAB_ITEM.key,
    );
    return [storyTab, ...baseTabs];
  }, [isFinalGame, isLiveGame, isPreGame, mode, state, storyTab]);
  const visibleTabKeys = useMemo(
    () => visibleTabs.map((tab) => tab.key),
    [visibleTabs],
  );
  // Opening a game ALWAYS lands on the leading tab for its current state
  // (Preview/Recap via the story tab; Plays for a live game, since Plays
  // leads the live tab order above) — see the reset effect below. The saved
  // default-tab setting no longer selects the landing tab; it still drives
  // tab ordering for the unknown-state fallback above.
  const defaultTab = isLiveGame ? visibleTabs[0] ?? storyTab : storyTab;
  const [swipeEnabled, setSwipeEnabled] = useState(true);
  const [contentScrollEnabled, setContentScrollEnabled] = useState(true);
  const [activeTabKey, setActiveTabKey] = useState<RuntimeInGameTabItem["key"] | null>(
    defaultTab.key,
  );
  const legacyTabRedirect = useMemo(() => {
    return null;
  }, [pathname]);

  const collapseCommentsSheet = useCallback(() => {
    commentsSheetFraction.value = withTiming(COMMENTS_DEFAULT_FRACTION, { duration: 180 });
  }, [commentsSheetFraction]);

  const expandCommentsSheet = useCallback(() => {
    commentsSheetFraction.value = withTiming(COMMENTS_EXPANDED_FRACTION, { duration: 180 });
  }, [commentsSheetFraction]);

  const openCommentsSheet = useCallback(() => {
    commentsSheetFraction.value = 0;
    setIsCommentsOpen(true);
    commentsSheetFraction.value = withTiming(COMMENTS_DEFAULT_FRACTION, { duration: 220 });
  }, [commentsSheetFraction]);

  useEffect(() => {
    return subscribeToInGameCommentsOverlay(openCommentsSheet);
  }, [openCommentsSheet]);

  useEffect(() => {
    if (legacyTabRedirect) {
      router.replace(legacyTabRedirect as never);
      return;
    }
    const activeTab = getActiveInGameTab(pathname, [
      ...BASE_IN_GAME_TAB_ITEMS,
      PREVIEW_TAB_ITEM,
    ] as InGameTabItem[]);
    if (!visibleTabs.some((item) => item.key === activeTab)) {
      router.replace((visibleTabs[0]?.route ?? defaultTab.route) as never);
    }
  }, [defaultTab.route, legacyTabRedirect, pathname, visibleTabs]);

  useEffect(() => {
    const activeTab = getActiveInGameTab(pathname, visibleTabs as InGameTabItem[]);
    if (activeTabKey !== activeTab) {
      setActiveTabKey(activeTab);
    }
  }, [activeTabKey, pathname, visibleTabs]);

  const navigateToTabKey = useCallback(
    (tabKey: RuntimeInGameTabItem["key"]) => {
      // `navigatorRef` (a ref on the Navigator component) never resolves to
      // anything usable — React Navigation navigators aren't forwardRef'd,
      // so it's always null. The tab bar itself switches tabs fine because
      // it calls .navigate on the real navigation object handed to it via
      // props; that same object is captured below whenever the tab bar
      // renders, so reuse it here instead.
      const navigation = capturedTabBarProps?.navigation;
      if (!navigation) {
        return false;
      }
      if (!visibleTabs.some((item) => item.key === tabKey)) {
        return false;
      }
      setActiveTabKey(tabKey);
      navigation.navigate(tabKey);
      return true;
    },
    [capturedTabBarProps, visibleTabs],
  );

  const tabNavigationValue = useMemo(
    () => ({
      goToTab: navigateToTabKey,
      activeTabKey,
      setSwipeEnabled,
      contentScrollEnabled,
      setContentScrollEnabled,
    }),
    [activeTabKey, contentScrollEnabled, navigateToTabKey],
  );

  // Opening a game always lands on that state's leading tab (the story tab
  // for pregame/final, Plays for live — see `defaultTab` above), even if the
  // previous visit to this same game ended on Stats/Plays/etc., AND
  // regardless of which route the entry point (e.g. the Home Screen's game
  // card, which pushes a settings-driven route with no knowledge of this
  // game's live status) happened to push initially. Keyed by gameId and
  // fired once per game (not per status change) — so it does NOT yank the
  // user back to the leading tab mid-session when the game transitions
  // pre → in → post while they're reading another tab.
  //
  // Goes through `navigateToTabKey` (the tab bar's own real navigation
  // object), NOT `router.replace` — `router.replace` to a sibling tab route
  // within this same MaterialTopTabNavigator doesn't reliably win against
  // the entry point's own `router.push` that's still settling, so it was
  // silently leaving the user on whatever tab the entry point happened to
  // push (Court, by default). `navigateToTabKey` is the exact mechanism the
  // tab bar itself and the Highlights/Biggest-Moments "jump to Plays" deep
  // links already use successfully. It also depends on the tab bar having
  // rendered at least once (`capturedTabBarProps`), which may not have
  // happened yet on the very first effect pass — so this deliberately does
  // NOT lock `storyTabResetGameIdRef` until the navigation actually
  // succeeds, letting it retry on the next render instead of silently
  // giving up.
  useEffect(() => {
    if (!gameId || storyTabResetGameIdRef.current === gameId) {
      return;
    }
    if (navigateToTabKey(defaultTab.key)) {
      storyTabResetGameIdRef.current = gameId;
    }
  }, [defaultTab.key, gameId, navigateToTabKey]);

  const isOnLeftmostTab = activeTabKey === visibleTabs[0]?.key;

  // Minimal, single-purpose: on the leftmost tab, a swipe in the "reveal a
  // previous tab" direction (the same direction as an edge swipe-back) calls
  // the EXACT same router.back() the working edge-swipe-back gesture
  // resolves to (see InGameExitTransitionProvider's onDismiss below). No
  // swipeEnabled toggling, no second direction handled here, no animation —
  // those were all present in earlier attempts and are exactly what caused
  // this to either freeze or crash. The native pager (screenOptions.
  // swipeEnabled, untouched below) keeps handling every other swipe,
  // including leftward swipes on this same tab, on its own.
  const leftmostTabSwipeBackGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isOnLeftmostTab)
        .activeOffsetX([-1000, 20])
        .failOffsetY([-15, 15])
        .onEnd((event) => {
          if (event.translationX > 60 || event.velocityX > 700) {
            runOnJS(router.back)();
          }
        }),
    [isOnLeftmostTab],
  );

  return (
    <InGameTabNavigationProvider value={tabNavigationValue as never}>
      <View style={styles.screen}>
        <InGameContentShell
          sheetFraction={commentsSheetFraction}
          screenHeight={screenHeight}
        >
          <RNAnimated.View style={[styles.exitTranslateLayer, translateLayerStyle]}>
            <RNAnimated.View style={[styles.exitCardLayer, cardLayerStyle]}>
              <GestureDetector gesture={leftmostTabSwipeBackGesture}>
              <View style={styles.tabPagerGestureWrap}>
              <ExpoRouterMaterialTopTabs
                ref={navigatorRef}
                initialRouteName={defaultTab.key}
                tabBar={(props) => (
                  <>
                    <TabBarPropsCapture props={props} onChange={setCapturedTabBarProps} />
                    <HiddenMaterialTopTabBar {...props} tabBarTop={tabBarTop} />
                  </>
                )}
                screenOptions={{
                  lazy: true,
                  lazyPreloadDistance: 1,
                  swipeEnabled,
                  animationEnabled: false,
                  tabBarScrollEnabled: true,
                  tabBarStyle: {
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    elevation: 1000,
                    zIndex: 1000,
                    backgroundColor: "transparent",
                    height: tabBarHeight,
                    shadowOpacity: 0,
                    borderBottomWidth: 0,
                    overflow: "visible",
                  },
                  tabBarContentContainerStyle: {
                    paddingHorizontal: theme.spacing[6],
                    paddingVertical: theme.spacing[6],
                  },
                  tabBarGap: theme.spacing[6],
                  tabBarIndicatorStyle: {
                    backgroundColor: theme.colors.textPrimary,
                  },
                  tabBarPressColor: "transparent",
                  tabBarPressOpacity: 1,
                  tabBarAndroidRipple: {
                    borderless: false,
                    color: "transparent",
                  },
                  tabBarItemStyle: {
                    width: "auto",
                    minHeight: theme.controlHeights.md,
                    paddingHorizontal: theme.spacing[14],
                  },
                  tabBarLabelStyle: {
                    fontSize: 14,
                    fontWeight: "700",
                    textTransform: "none",
                  },
                  tabBarActiveTintColor: "#FFFFFF",
                  tabBarInactiveTintColor: "rgba(255,255,255,0.6)",
                }}
                screenListeners={({ route, navigation }) => ({
                  focus: () => {
                    setActiveTabKey(route.name as RuntimeInGameTabItem["key"]);
                  },
                  // expo-router's withLayoutContext auto-registers every file
                  // in app/(tabs)/ as a route on this navigator regardless of
                  // which <Screen> children we render below — so even though
                  // the JSX only lists visibleTabs, the underlying pager's
                  // own route/index state still includes every other in-game
                  // file (h2h, leaders, summary, etc.), and swiping past the
                  // last VISIBLE tab lands on one of those instead of
                  // stopping. Confirmed by hand: from a pregame game (tab bar
                  // showing only Preview/Court/Odds), five leftward swipes
                  // walked straight through into h2h -> leaders -> summary.
                  // The `pathname`-driven useEffect below already redirects
                  // away from a hidden route, but it only fires after the
                  // URL has caught up, letting the wrong screen flash first.
                  // This listener fires synchronously off react-navigation's
                  // OWN state change (not a URL round-trip), so it can bounce
                  // back before that screen is ever visibly settled on.
                  state: (event) => {
                    const state = event.data.state;
                    const routeName = state.routes?.[state.index ?? 0]?.name;
                    if (!routeName) {
                      return;
                    }
                    if (!visibleTabKeys.includes(routeName as RuntimeInGameTabItem["key"])) {
                      const fallbackKey = visibleTabs[0]?.key ?? defaultTab.key;
                      navigation.navigate(fallbackKey);
                      return;
                    }
                    setActiveTabKey(routeName as RuntimeInGameTabItem["key"]);
                  },
                })}
              >
                {visibleTabs.map((item) => (
                  <ExpoRouterMaterialTopTabs.Screen
                    key={item.key}
                    name={item.key}
                    options={{
                      title: item.label,
                      tabBarLabel: ({ color }) => (
                        <Text
                          style={{
                            color,
                            fontSize: 14,
                            fontWeight: "700",
                            textTransform: "none",
                            backgroundColor: "transparent",
                            opacity: 1,
                          }}
                        >
                          {item.label}
                        </Text>
                      ),
                    }}
                  />
                ))}
              </ExpoRouterMaterialTopTabs>
              </View>
              </GestureDetector>
              {capturedTabBarProps ? (
                <FloatingCollapsingTabBar
                  props={capturedTabBarProps}
                  tabBarTop={tabBarTop}
                  allowedKeys={visibleTabKeys}
                />
              ) : null}
              <SharedInGameHeader />
              {/* No more full-screen blocking loader here — the header/tab
                  bar/tab screens above already render instantly regardless
                  of data readiness (see the individual tabs' own skeleton
                  states). This banner ONLY appears for the true failure
                  case — a fetch error with no data at all to fall back on —
                  and it's a small, non-blocking strip below the header
                  rather than a full-screen overlay. */}
              {error && !data ? (
                <InlineGameErrorBanner
                  message={error}
                  top={getStickyHeaderExpandedHeight(insets.top)}
                  onRetry={() => {
                    void refresh();
                  }}
                />
              ) : null}
            </RNAnimated.View>
          </RNAnimated.View>
        </InGameContentShell>
        <InGameCommentsSheetHost
          visible={isCommentsOpen}
          sheetFraction={commentsSheetFraction}
          screenHeight={screenHeight}
          onCollapse={collapseCommentsSheet}
          onExpand={expandCommentsSheet}
        />
        {/* Single shared instance for every in-game tab — previously each tab's
            own GameTabScreenScaffold (Court/Stats/Odds/Comments/Preview) and
            playbyplay.tsx separately rendered their own PlayerModal, all
            wired to this same context. Because lazyPreloadDistance={1} keeps
            the active tab's neighbors mounted too, tapping a player could
            have 2-3 of those instances simultaneously reacting to the same
            open-state change — each running its own mount/layout effects and
            starting its own sheet animation, competing for the UI thread at
            the exact moment the user expects an instant response. Measured
            directly (dev timing logs): "starting open animation" fired 3
            times within 5ms of the same tap. One instance here, shared via
            context, removes that duplication entirely. */}
        <PlayerModal
          visible={isPlayerModalOpen && !!selectedPlayer?.id}
          player={selectedPlayer}
          onClose={closePlayerModal}
          initialChartMode={initialChartMode}
        />
      </View>
    </InGameTabNavigationProvider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    flexDirection: "column",
    backgroundColor: "transparent",
  },
  exitTranslateLayer: {
    flex: 1,
  },
  exitCardLayer: {
    flex: 1,
    overflow: "hidden",
  },
  tabPagerGestureWrap: {
    flex: 1,
  },
  tabBarOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    zIndex: 1000,
    elevation: 1000,
  },
  hiddenTabBarMount: {
    height: 0,
    opacity: 0,
  },
  gameResizePane: {
    position: "relative",
    overflow: "hidden",
  },
  commentsDock: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  commentsDragArea: {
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  commentsDragHandle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    opacity: 0.65,
  },
});
