import { useIsFocused } from "@react-navigation/native";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import {
  RefreshControl,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

import {
  getInGameContentStartOffset,
  getStickyHeaderExpandedHeight,
  IN_GAME_HEADER_COLLAPSE_RANGE,
} from "@/components/ui/inGameHeaderMetrics";
import { useAppTheme } from "@/src/theme/useAppTheme";
import { useInGameHeaderScroll } from "@/src/ui/inGameHeaderScrollContext";
import { useInGameTabNavigation } from "@/src/ui/inGameTabNavigationContext";

type GameTabScreenScaffoldProps = {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshing?: boolean;
  onRefresh?: () => void;
};

export default function GameTabScreenScaffold({
  children,
  contentContainerStyle,
  refreshing = false,
  onRefresh,
}: GameTabScreenScaffoldProps) {
  const { tokens: theme } = useAppTheme();
  const { sharedHeaderScrollY } = useInGameHeaderScroll();
  const { contentScrollEnabled } = useInGameTabNavigation();
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  // UI-thread mirror of isFocused, read inside the onScroll worklet below —
  // a plain React state/ref isn't accessible from a worklet. See the
  // identical pattern in app/(tabs)/playbyplay.tsx and app/(tabs)/comments.tsx,
  // which this scaffold's scroll handling now matches.
  const isFocusedShared = useSharedValue(isFocused ? 1 : 0);
  const insets = useSafeAreaInsets();
  const scrollNodeRef = useRef<Animated.ScrollView | null>(null);
  // Single source of truth for this tab's own scroll offset, on the UI
  // thread — replaces the previous `contentOffsetY` React state, which
  // forced a full re-render on every scroll frame and drove the content's
  // compensating transform out of sync with the header under fast scrolling
  // (see contentMotionStyle below). Readable directly from JS-thread code
  // too (syncCollapsedOffset, the focus layout effect) — Reanimated shared
  // values support imperative .value reads/writes from JS, no separate ref
  // needed to mirror it.
  const localScrollY = useSharedValue(0);
  const headerSpace = getStickyHeaderExpandedHeight(insets.top);
  const setScrollRef = useCallback((node: Animated.ScrollView | null) => {
    scrollNodeRef.current = node;
  }, []);
  const styles = useMemo(
    () =>
      StyleSheet.create({
        screen: {
          flex: 1,
          backgroundColor: "transparent",
        },
        scroll: {
          flex: 1,
          backgroundColor: "transparent",
        },
        content: {
          paddingHorizontal: theme.spacing[8],
          paddingTop: headerSpace,
          paddingBottom: theme.spacing[40] + theme.controlHeights.fab,
          gap: theme.spacing[12],
        },
        contentMotionWrap: {
          gap: theme.spacing[12],
        },
      }),
    [headerSpace, theme],
  );

  // Worklet-based: runs on the UI thread, so this tab's scroll offset and
  // (when focused) the shared header offset update the same frame the
  // native scroll event fires — no JS-thread round trip, no React
  // re-render, and nothing for a fast/rapid scroll to outrun. Was
  // previously a plain onScroll callback that also called setState on every
  // frame; under fast scrolling that JS-thread work could fall behind the
  // native scroll events, causing sharedHeaderScrollY (and the header/content
  // motion derived from it) to update in stale, bursty jumps instead of
  // smoothly. Matches the already-correct pattern in playbyplay.tsx/comments.tsx.
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      const offsetY = Math.max(0, event.contentOffset.y);
      localScrollY.value = offsetY;
      if (isFocusedShared.value === 1) {
        sharedHeaderScrollY.value = offsetY;
      }
    },
  });

  useEffect(() => {
    isFocusedRef.current = isFocused;
    isFocusedShared.value = isFocused ? 1 : 0;
  }, [isFocused, isFocusedShared]);

  // Reconciles THIS tab against the shared header offset the moment it
  // changes — not just when this tab becomes focused. Previously, a
  // background tab only ever picked up the header having expanded (or
  // re-collapsed) at the instant it was switched to, via the useLayoutEffect
  // below; scrolling the header open on the CURRENTLY active tab did nothing
  // to any other, already-mounted tab until a later tab switch. Since
  // sharedHeaderScrollY starts updating the moment the active tab's scroll
  // moves even one pixel away from fully collapsed (see onScroll above),
  // this reaction now fires that same instant, so a background tab snaps to
  // match live rather than on a delay. Guarded to skip the currently-focused
  // tab (its own onScroll is already the source of truth and is mid-gesture)
  // and applies with scrollTo(..., animated: false) — an instant snap, not
  // an animation racing the source tab's own gesture.
  const syncCollapsedOffset = useCallback(
    (sourceOffset: number) => {
      if (isFocusedRef.current) {
        return;
      }
      const targetOffset = Math.min(
        Math.max(sourceOffset, 0),
        IN_GAME_HEADER_COLLAPSE_RANGE[1],
      );
      if (Math.abs(localScrollY.value - targetOffset) < 1) {
        return;
      }
      localScrollY.value = targetOffset;
      scrollNodeRef.current?.scrollTo({ x: 0, y: targetOffset, animated: false });
    },
    [localScrollY],
  );

  useAnimatedReaction(
    () => sharedHeaderScrollY.value,
    (value) => {
      runOnJS(syncCollapsedOffset)(value);
    },
    [sharedHeaderScrollY, syncCollapsedOffset],
  );

  useLayoutEffect(() => {
    if (!isFocused) {
      return;
    }
    // Fallback reconciliation specifically for the focus-change moment
    // itself (e.g. a tab that wasn't mounted yet — lazy tabs aren't
    // subscribed to the reaction above until they exist — picking up
    // whatever the shared state already settled on by the time it mounts).
    // Reconciles in both directions: a newly-focused tab must pick up a
    // collapse that happened elsewhere (local 0 -> shared > 0) AND must snap
    // back to the top when another tab expanded the header while this tab
    // was left scrolled down (local > 0 -> shared 0).
    const targetOffset = Math.min(
      Math.max(sharedHeaderScrollY.value, 0),
      IN_GAME_HEADER_COLLAPSE_RANGE[1],
    );
    if (Math.abs(localScrollY.value - targetOffset) < 1) {
      return;
    }
    localScrollY.value = targetOffset;
    scrollNodeRef.current?.scrollTo({ x: 0, y: targetOffset, animated: false });
  }, [isFocused, localScrollY, sharedHeaderScrollY]);

  // Worklet-derived (was a JS-thread useMemo keyed off contentOffsetY React
  // state) — same exact formula (getInGameContentStartOffset is already
  // marked "worklet"), just computed on the UI thread so the content's
  // compensating transform can never drift out of sync with the header's
  // own scrollY-derived motion under fast scrolling; both now read the
  // same live value on the same thread every frame.
  const contentMotionStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: getInGameContentStartOffset(localScrollY.value, insets.top) - headerSpace,
      },
    ],
  }));

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.screen}>
      <Animated.ScrollView
        ref={setScrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={16}
        scrollEnabled={contentScrollEnabled}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent}
            />
          ) : undefined
        }
      >
        <Animated.View
          style={[styles.contentMotionWrap, contentMotionStyle, contentContainerStyle]}
        >
          {children}
        </Animated.View>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}
